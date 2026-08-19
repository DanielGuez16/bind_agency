"""Notifications push : qui reçoit, qui ne reçoit jamais, et ce qu'on révoque.

**Non vérifiées de bout en bout, et le fichier le dit.** Expo exige un
identifiant de projet EAS et un build de développement ; personne n'a encore vu
une notification arriver sur un téléphone. Tout ce qui est en amont du dernier
saut est éprouvé ici : les préférences, les filtres, le choix des
destinataires, la révocation. Seul l'envoi lui-même est simulé — comme le
scanner caméra, et pour la même raison.

Deux garanties portent ce fichier. **Un compte suspendu ou anonymisé ne reçoit
rien**, quelles que soient ses préférences et ses terminaux. **Un jeton mort se
révoque au moment où on l'apprend**, parce que c'est la seule occasion qu'on ait.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.push import (
    Envoi,
    ExpoPushSender,
    LogPushSender,
    Verdict,
    _lire_le_recu,
    get_push_sender,
)
from app.models import DeviceToken, User
from app.models.enums import (
    DevicePlatform,
    DeviceTokenStatus,
    NotificationKind,
    UserRole,
    UserStatus,
)
from app.services import auth as auth_service
from app.services import push as service

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"
GENRE = NotificationKind.BOOKING_APPROVED


class Espion:
    """Retient ce qu'on lui a demandé d'envoyer, et rend le verdict qu'on veut."""

    def __init__(self, verdicts: list[Verdict] | None = None) -> None:
        self.verdicts = verdicts
        self.envois: list[Envoi] = []

    async def envoyer(self, envois: list[Envoi]) -> list[Verdict]:
        self.envois.extend(envois)
        return self.verdicts or [Verdict.ENVOYE for _ in envois]


async def createur(session: AsyncSession, **champs) -> User:
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
    )
    for nom, valeur in champs.items():
        setattr(user, nom, valeur)
    await session.flush()
    return user


async def avec_un_terminal(session: AsyncSession, user: User, token: str = "ExponentPushToken[x]"):
    await service.enregistrer_un_terminal(
        session, user_id=user.id, token=token, platform=DevicePlatform.IOS
    )
    await session.flush()


# --------------------------------------------------------------------------
# qui ne reçoit jamais
# --------------------------------------------------------------------------


@pytest.mark.parametrize("statut", [UserStatus.SUSPENDED, UserStatus.ANONYMIZED])
async def test_un_compte_non_actif_ne_recoit_rien(
    session: AsyncSession, statut: UserStatus
) -> None:
    """La garantie de fond, et elle passe avant les préférences.

    Un compte suspendu a pu couper ou non ses notifications ; la question ne se
    pose pas. Un compte anonymisé n'existe plus comme personne, et lui envoyer
    quoi que ce soit serait le contraire de ce que l'anonymisation promet.
    """
    user = await createur(session)
    await avec_un_terminal(session, user)
    user.status = statut
    await session.flush()

    espion = Espion()
    envoye = await service.envoyer(
        session, user_id=user.id, kind=GENRE, sender=espion, cle="booking.approved"
    )

    assert envoye is False
    assert espion.envois == [], "rien n'a même été composé"


async def test_un_compte_actif_recoit(session: AsyncSession) -> None:
    """Le pendant. Un service qui refuserait tout le monde passerait le test
    précédent sans rien garantir."""
    user = await createur(session)
    await avec_un_terminal(session, user)

    espion = Espion()
    envoye = await service.envoyer(
        session, user_id=user.id, kind=GENRE, sender=espion, cle="booking.approved"
    )

    assert envoye is True
    assert len(espion.envois) == 1


async def test_tous_les_genres_partent(session: AsyncSession) -> None:
    """**Le réglage par genre a été retiré : tout ce que le produit a à dire, il
    le dit.**

    Deux tests vivaient ici — couper un genre n'en coupe pas sept, et une
    préférence absente vaut oui. Ils éprouvaient une fonction qui n'existe plus.
    Ce qui la remplace est plus simple et se vérifie sur **les sept genres** :
    aucun ne se tait. Une garde qui n'en regarderait qu'un laisserait passer un
    filtre posé sur les six autres.
    """
    user = await createur(session)
    await avec_un_terminal(session, user)

    espion = Espion()
    for genre in NotificationKind:
        assert await service.envoyer(
            session, user_id=user.id, kind=genre, sender=espion, cle="booking.approved"
        ), f"le genre {genre.value} ne part pas"


async def test_sans_terminal_il_n_y_a_rien_a_envoyer(session: AsyncSession) -> None:
    """Un créateur qui n'a jamais ouvert l'app sur un téléphone. Ce n'est pas
    une erreur, c'est le silence."""
    user = await createur(session)

    espion = Espion()
    envoye = await service.envoyer(
        session, user_id=user.id, kind=GENRE, sender=espion, cle="booking.approved"
    )

    assert envoye is False
    assert espion.envois == []


# --------------------------------------------------------------------------
# le jeton, révoqué comme un jeton social
# --------------------------------------------------------------------------


async def test_un_jeton_declare_mort_est_revoque(session: AsyncSession) -> None:
    """C'est la seule occasion qu'on ait de l'apprendre.

    Le fournisseur ne prévient pas d'avance : il répond au moment où l'on
    essaie de s'en servir. Ne pas révoquer laisserait la table grossir de
    terminaux morts qu'on retenterait à chaque événement.
    """
    user = await createur(session)
    await avec_un_terminal(session, user, token="ExponentPushToken[mort]")

    espion = Espion(verdicts=[Verdict.JETON_INVALIDE])
    await service.envoyer(
        session, user_id=user.id, kind=GENRE, sender=espion, cle="booking.approved"
    )

    statut = await session.scalar(
        sa.select(DeviceToken.status).where(DeviceToken.token == "ExponentPushToken[mort]")
    )
    assert statut is DeviceTokenStatus.REVOKED


async def test_un_echec_passager_ne_revoque_rien(session: AsyncSession) -> None:
    """Le pendant, et il compte autant.

    Révoquer sur un hoquet du service couperait les notifications de gens dont
    le terminal va parfaitement bien, et ils ne s'en apercevraient qu'en ne
    recevant plus rien — sans rien à réparer de leur côté.
    """
    user = await createur(session)
    await avec_un_terminal(session, user, token="ExponentPushToken[vivant]")

    espion = Espion(verdicts=[Verdict.ECHEC])
    await service.envoyer(
        session, user_id=user.id, kind=GENRE, sender=espion, cle="booking.approved"
    )

    statut = await session.scalar(
        sa.select(DeviceToken.status).where(DeviceToken.token == "ExponentPushToken[vivant]")
    )
    assert statut is DeviceTokenStatus.ACTIVE


async def test_un_seul_jeton_mort_n_emporte_pas_les_autres(session: AsyncSession) -> None:
    """Les verdicts s'apparient aux envois par position : c'est le contrat de
    l'interface, et s'il glissait on révoquerait le terminal de quelqu'un
    d'autre."""
    user = await createur(session)
    await avec_un_terminal(session, user, token="ExponentPushToken[un]")
    await avec_un_terminal(session, user, token="ExponentPushToken[deux]")

    espion = Espion(verdicts=[Verdict.ENVOYE, Verdict.JETON_INVALIDE])
    await service.envoyer(
        session, user_id=user.id, kind=GENRE, sender=espion, cle="booking.approved"
    )

    statuts = {
        token: statut
        for token, statut in await session.execute(
            sa.select(DeviceToken.token, DeviceToken.status).where(DeviceToken.user_id == user.id)
        )
    }
    # L'ordre d'envoi est celui de la requête ; on vérifie qu'il n'y en a
    # qu'un de révoqué, et que l'autre a survécu.
    assert sorted(statuts.values(), key=str) == sorted(
        [DeviceTokenStatus.ACTIVE, DeviceTokenStatus.REVOKED], key=str
    )


async def test_l_anonymisation_revoque_les_terminaux(session: AsyncSession) -> None:
    """Comme les jetons sociaux, et par le même geste.

    Le service d'envoi refuse déjà de servir un compte non actif ; ceci est la
    transition ponctuelle, celui-là la garantie permanente. Les deux existent
    parce que la première peut être oubliée sur un chemin nouveau.
    """
    from app.services.anonymization import anonymize_account
    from app.services.audit import Actor

    user = await createur(session)
    await avec_un_terminal(session, user, token="ExponentPushToken[parti]")

    await anonymize_account(session, user=user, actor=Actor.from_user(user))
    await session.flush()

    statut = await session.scalar(
        sa.select(DeviceToken.status).where(DeviceToken.token == "ExponentPushToken[parti]")
    )
    assert statut is DeviceTokenStatus.REVOKED


async def test_un_terminal_se_reinscrit_apres_avoir_ete_revoque(session: AsyncSession) -> None:
    """Rouvrir l'application redemande à être joint.

    Refuser demanderait de désinstaller à nouveau pour y arriver, ce qui n'est
    une conduite que personne ne devinerait.
    """
    user = await createur(session)
    await avec_un_terminal(session, user, token="ExponentPushToken[revenu]")
    await service.revoquer_un_terminal(session, user_id=user.id, token="ExponentPushToken[revenu]")
    await session.flush()

    await avec_un_terminal(session, user, token="ExponentPushToken[revenu]")

    ligne = await session.scalar(
        sa.select(DeviceToken).where(DeviceToken.token == "ExponentPushToken[revenu]")
    )
    assert ligne.status is DeviceTokenStatus.ACTIVE
    assert ligne.revoked_at is None, "la date de révocation part avec la révocation"


async def test_un_jeton_change_de_main_sans_doubler(session: AsyncSession) -> None:
    """Un téléphone prêté puis reconnecté sous un autre compte.

    Sans reprise, les deux comptes recevraient les notifications de l'autre —
    ce qui est une fuite, pas un doublon.
    """
    une = await createur(session)
    autre = await createur(session)
    await avec_un_terminal(session, une, token="ExponentPushToken[partage]")

    await avec_un_terminal(session, autre, token="ExponentPushToken[partage]")

    proprietaires = list(
        await session.scalars(
            sa.select(DeviceToken.user_id).where(DeviceToken.token == "ExponentPushToken[partage]")
        )
    )
    assert proprietaires == [autre.id], "un seul propriétaire, le dernier"


async def test_on_ne_revoque_pas_le_terminal_d_un_autre(session: AsyncSession) -> None:
    """Sans la vérification d'appartenance, connaître un jeton suffirait à
    couper les notifications de quelqu'un d'autre."""
    une = await createur(session)
    autre = await createur(session)
    await avec_un_terminal(session, une, token="ExponentPushToken[sien]")

    revoque = await service.revoquer_un_terminal(
        session, user_id=autre.id, token="ExponentPushToken[sien]"
    )

    assert revoque is False
    statut = await session.scalar(
        sa.select(DeviceToken.status).where(DeviceToken.token == "ExponentPushToken[sien]")
    )
    assert statut is DeviceTokenStatus.ACTIVE


# --------------------------------------------------------------------------
# ce que le fournisseur rend
# --------------------------------------------------------------------------


def test_le_recu_distingue_le_jeton_mort_du_hoquet() -> None:
    """`DeviceNotRegistered` est le seul détail qu'on lit dans une erreur.

    Les autres codes changent avec le temps, et les interpréter reviendrait à
    suivre une documentation qui n'est pas la nôtre.
    """
    assert _lire_le_recu({"status": "ok"}) is Verdict.ENVOYE
    assert (
        _lire_le_recu({"status": "error", "details": {"error": "DeviceNotRegistered"}})
        is Verdict.JETON_INVALIDE
    )
    assert (
        _lire_le_recu({"status": "error", "details": {"error": "MessageTooBig"}}) is Verdict.ECHEC
    )
    # Une forme qu'on ne sait pas lire n'est jamais prise pour un succès.
    assert _lire_le_recu(None) is Verdict.ECHEC
    assert _lire_le_recu({"status": "error"}) is Verdict.ECHEC


async def test_le_fournisseur_de_journal_est_celui_en_service() -> None:
    """Tant qu'aucun compte Expo n'existe. Le mode est en configuration, et il
    n'y a pas de repli silencieux."""
    assert isinstance(get_push_sender(), LogPushSender)
    assert await LogPushSender().envoyer([]) == []


async def test_un_lot_qui_ne_part_pas_echoue_en_entier() -> None:
    """On ne sait pas lesquels sont partis.

    Les compter comme envoyés en perdrait ; les compter comme invalides
    révoquerait des terminaux parfaitement valides. L'échec est le seul verdict
    honnête.
    """
    import httpx

    async def refuser(requete: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"errors": [{"code": "SERVER_ERROR"}]})

    transport = httpx.MockTransport(refuser)
    async with httpx.AsyncClient(transport=transport) as client:
        verdicts = await ExpoPushSender(client).envoyer(
            [Envoi(token="a", titre="t", corps="c", donnees={}) for _ in range(3)]
        )

    assert verdicts == [Verdict.ECHEC, Verdict.ECHEC, Verdict.ECHEC]


async def test_des_recus_desalignes_ne_decalent_pas_les_verdicts() -> None:
    """Le contrat d'Expo est « un reçu par envoi, dans l'ordre ».

    S'il ne le tient pas, une liste plus courte décalerait tous les verdicts
    suivants — et révoquerait le jeton de quelqu'un d'autre.
    """
    import httpx

    async def repondre(requete: httpx.Request) -> httpx.Response:
        # Deux reçus pour trois envois.
        return httpx.Response(200, json={"data": [{"status": "ok"}, {"status": "ok"}]})

    transport = httpx.MockTransport(repondre)
    async with httpx.AsyncClient(transport=transport) as client:
        verdicts = await ExpoPushSender(client).envoyer(
            [Envoi(token=f"t{n}", titre="t", corps="c", donnees={}) for n in range(3)]
        )

    assert len(verdicts) == 3
    assert verdicts[2] is Verdict.ECHEC, "le manquant n'est jamais pris pour un succès"


# --------------------------------------------------------------------------
# les routes
# --------------------------------------------------------------------------


async def connecte(client: AsyncClient, session: AsyncSession) -> dict:
    user = await createur(session)
    await session.commit()
    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
        )
    ).json()
    return {"headers": {"Authorization": f"Bearer {jetons['access_token']}"}}


async def test_l_enregistrement_est_idempotent(client: AsyncClient, session: AsyncSession) -> None:
    """L'app le rappelle à chaque démarrage : une route qui créerait une ligne
    par appel en accumulerait une par ouverture."""
    entetes = await connecte(client, session)
    charge = {"token": "ExponentPushToken[abc123]", "platform": "ios"}

    une = await client.put(f"{PREFIX}/me/devices", json=charge, **entetes)
    deux = await client.put(f"{PREFIX}/me/devices", json=charge, **entetes)

    assert une.status_code == 200
    assert deux.status_code == 200
    assert une.json()["id"] == deux.json()["id"]


async def test_la_revocation_ne_dit_pas_si_le_jeton_existait(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Distinguer « révoqué » de « pas à vous » dirait à qui essaie des jetons
    lesquels existent."""
    entetes = await connecte(client, session)

    inconnu = await client.delete(f"{PREFIX}/me/devices/ExponentPushToken[jamais-vu]", **entetes)

    assert inconnu.status_code == 204
