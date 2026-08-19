"""La boîte d'envoi.

**La garantie qui porte ce fichier : un message est écrit avec l'événement qui
le provoque, et il part plus tard.** Avant, une décision de réservation
envoyait son courriel et son push *avant de répondre* : la requête attendait
deux services externes dont l'appelant n'avait rien à faire, et si le processus
mourait entre le commit et l'envoi, personne n'était prévenu et rien ne le
rattrapait.

Trois autres propriétés comptent. **La préférence se relit à l'envoi**, pas au
dépôt : quelqu'un qui coupe entre les deux doit être entendu. **Trois issues, et
pas deux** — parti, écarté, ou à réessayer ; confondre « écarté » avec un échec
ferait marteler un compte suspendu, et avec un succès ferait croire qu'il a
reçu. Et **un envoi raté ne bloque pas les autres** : c'était le défaut du
balayage des rappels, où un service injoignable laissait sans rappel toutes les
échéances qui suivaient.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import get_settings
from app.integrations.email import EmailError, Message
from app.integrations.push import Verdict
from app.models import DeviceToken, OutboundMessage, User
from app.models.enums import (
    DeviceTokenStatus,
    Locale,
    MessageChannel,
    NotificationKind,
    UserRole,
    UserStatus,
)
from app.services import auth as auth_service
from app.services import outbox
from tests.factories import PASSWORD_HASH, new_user

MOT_DE_PASSE = "un-mot-de-passe-solide-42"
CLE = "collaboration.reminder"
GENRE = NotificationKind.PUBLICATION_REMINDER


class FauxCourriel:
    """Retient ce qu'on lui donne, ou lève."""

    def __init__(self, *, leve: Exception | None = None) -> None:
        self.leve = leve
        self.messages: list[Message] = []

    async def envoyer(self, message: Message) -> None:
        if self.leve is not None:
            raise self.leve
        self.messages.append(message)


class FauxPush:
    """Rend le verdict qu'on lui demande, pour chaque envoi."""

    def __init__(self, verdict: Verdict = Verdict.ENVOYE) -> None:
        self.verdict = verdict
        self.envois: list = []

    async def envoyer(self, envois):
        self.envois.extend(envois)
        return [self.verdict for _ in envois]


async def destinataire(session: AsyncSession, **overrides) -> User:
    return await auth_service.register(
        session,
        email=overrides.pop("email", f"{uuid.uuid4()}@example.com"),
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
    )


async def depose(session: AsyncSession, user: User, **extra) -> tuple[OutboundMessage, ...]:
    valeurs = {
        "creator": "Rebecca",
        "business": "Salon Ocean",
        "item": "Soin visage",
        "deadline": "2026-09-07 18:00",
    } | extra
    return await outbox.deposer(session, user_id=user.id, cle=CLE, **valeurs)


async def avec_un_terminal(session: AsyncSession, user: User) -> None:
    session.add(
        DeviceToken(
            user_id=user.id,
            token=f"ExponentPushToken[{uuid.uuid4()}]",
            platform="ios",
            status=DeviceTokenStatus.ACTIVE,
        )
    )
    await session.flush()


# --------------------------------------------------------------------------
# déposer
# --------------------------------------------------------------------------


async def test_deposer_n_envoie_rien(session: AsyncSession) -> None:
    """**La garantie de fond.** Le dépôt écrit, il ne parle à personne."""
    utilisateur = await destinataire(session)
    courriel = FauxCourriel()

    lignes = await depose(session, utilisateur)

    assert courriel.messages == []
    assert len(lignes) == 2
    assert {ligne.channel for ligne in lignes} == {MessageChannel.EMAIL, MessageChannel.PUSH}
    assert all(ligne.sent_at is None and ligne.skipped_reason is None for ligne in lignes)


async def test_le_genre_vient_de_la_cle(session: AsyncSession) -> None:
    utilisateur = await destinataire(session)

    lignes = await depose(session, utilisateur)

    assert {ligne.kind for ligne in lignes} == {GENRE}


async def test_une_cle_sans_genre_ne_se_depose_pas(session: AsyncSession) -> None:
    """Un message qu'aucune préférence ne commande ne se dépose pas plus qu'il
    ne s'envoie : le laisser entrer dans la boîte le ferait partir plus tard.

    `account.welcome` est le dernier message du catalogue dans ce cas : écrit,
    traduit, et émis par personne. Les deux autres — l'ouverture d'une
    contrepartie et sa non-honoration — ont reçu leur genre et sont désormais
    envoyés.
    """
    utilisateur = await destinataire(session)

    with pytest.raises(KeyError):
        await outbox.deposer(session, user_id=utilisateur.id, cle="account.welcome")


# --------------------------------------------------------------------------
# vider
# --------------------------------------------------------------------------


async def test_le_message_part_et_la_ligne_se_ferme(session: AsyncSession) -> None:
    utilisateur = await destinataire(session)
    await avec_un_terminal(session, utilisateur)
    lignes = await depose(session, utilisateur)
    courriel, push = FauxCourriel(), FauxPush()

    resultat = await outbox.vider(session, email_sender=courriel, push_sender=push)

    assert resultat.envoyes == 2
    assert len(courriel.messages) == 1
    assert len(push.envois) == 1
    assert all(ligne.sent_at is not None for ligne in lignes)


async def test_un_message_parti_ne_repart_pas(session: AsyncSession) -> None:
    """Le passage suivant ne doit pas le relire. Sans quoi le rappel d'échéance
    arriverait toutes les minutes jusqu'à l'échéance."""
    utilisateur = await destinataire(session)
    await depose(session, utilisateur)
    courriel = FauxCourriel()
    await outbox.vider(session, email_sender=courriel, push_sender=FauxPush())

    second = FauxCourriel()
    resultat = await outbox.vider(session, email_sender=second, push_sender=FauxPush())

    assert second.messages == []
    assert resultat.envoyes == 0


async def test_le_message_est_rendu_dans_la_langue_du_destinataire(
    session: AsyncSession,
) -> None:
    """**Lue à l'envoi, pas au dépôt.** Quelqu'un qui change de langue entre les
    deux doit lire le message dans celle qu'il vient de choisir."""
    utilisateur = await destinataire(session)
    await depose(session, utilisateur)
    await session.execute(sa.update(User).where(User.id == utilisateur.id).values(locale="es"))
    await session.flush()

    courriel = FauxCourriel()
    await outbox.vider(session, email_sender=courriel, push_sender=FauxPush())

    assert courriel.messages[0].locale == Locale.ES


# --------------------------------------------------------------------------
# la préférence, relue à l'envoi
# --------------------------------------------------------------------------


async def test_un_compte_ferme_apres_le_depot_ne_recoit_pas(session: AsyncSession) -> None:
    """**La raison pour laquelle la joignabilité n'est pas figée au dépôt.**

    Le message est écrit à l'instant de la décision et part une minute plus
    tard ; entre les deux, un compte peut avoir été suspendu. C'est le moment
    où le message arriverait qui compte, pas celui où il a été écrit.

    Ce test éprouvait la même chose sur un genre coupé, du temps où le produit
    avait un réglage par genre. Le réglage est parti ; la propriété — on relit
    au moment de sortir — n'a pas bougé de sens, et la suspension la porte
    aussi bien.
    """
    utilisateur = await destinataire(session)
    lignes = await depose(session, utilisateur)
    await session.execute(
        sa.update(User).where(User.id == utilisateur.id).values(status=UserStatus.SUSPENDED)
    )
    await session.flush()

    courriel = FauxCourriel()
    resultat = await outbox.vider(session, email_sender=courriel, push_sender=FauxPush())

    assert courriel.messages == []
    assert resultat.ecartes == 2
    assert all(ligne.skipped_reason == outbox.ECARTE_INJOIGNABLE for ligne in lignes)


async def test_un_message_ecarte_n_est_jamais_repris(session: AsyncSession) -> None:
    """Écarté n'est ni un succès ni un échec : le relire à chaque passage ferait
    tourner la boîte sur place, et le compter comme un échec finirait par
    marteler un compte suspendu."""
    utilisateur = await destinataire(session)
    await depose(session, utilisateur)
    await session.execute(
        sa.update(User).where(User.id == utilisateur.id).values(status=UserStatus.SUSPENDED)
    )
    await session.flush()
    await outbox.vider(session, email_sender=FauxCourriel(), push_sender=FauxPush())

    assert await outbox.en_attente(session) == []


async def test_un_compte_suspendu_ne_recoit_rien(session: AsyncSession) -> None:
    utilisateur = await destinataire(session)
    await depose(session, utilisateur)
    await session.execute(
        sa.update(User).where(User.id == utilisateur.id).values(status=UserStatus.SUSPENDED)
    )
    await session.flush()

    courriel = FauxCourriel()
    resultat = await outbox.vider(session, email_sender=courriel, push_sender=FauxPush())

    assert courriel.messages == []
    assert resultat.ecartes == 2


# --------------------------------------------------------------------------
# ce qui rate
# --------------------------------------------------------------------------


async def test_un_envoi_rate_est_reporte_et_non_perdu(session: AsyncSession) -> None:
    utilisateur = await destinataire(session)
    lignes = await depose(session, utilisateur)
    avant = datetime.now(UTC)

    resultat = await outbox.vider(
        session,
        email_sender=FauxCourriel(leve=EmailError("injoignable")),
        push_sender=FauxPush(),
    )

    courriel = next(ligne for ligne in lignes if ligne.channel is MessageChannel.EMAIL)
    assert resultat.reportes == 1
    assert courriel.attempts == 1
    assert courriel.run_after > avant
    assert courriel.sent_at is None
    assert courriel.last_error is not None


async def test_un_envoi_rate_ne_bloque_pas_les_autres(session: AsyncSession) -> None:
    """**Le défaut du balayage des rappels, refermé.** Un service injoignable
    laissait sans rappel toutes les échéances qui suivaient dans la même passe :
    l'exception faisait échouer le job entier."""
    premier = await destinataire(session)
    second = await destinataire(session)
    await avec_un_terminal(session, second)
    await depose(session, premier)
    await depose(session, second)

    push = FauxPush()
    resultat = await outbox.vider(
        session, email_sender=FauxCourriel(leve=EmailError("injoignable")), push_sender=push
    )

    # Les deux courriels sont reportés, et les deux push sont partis quand
    # même : rien ne s'arrête à la première erreur.
    assert resultat.reportes == 2
    assert resultat.envoyes + resultat.ecartes == 2


async def test_un_message_qui_ne_part_jamais_finit_par_sortir_de_la_boite(
    session: AsyncSession,
) -> None:
    """Sinon il occupe chaque passage jusqu'à la fin des temps.

    Le plafond est celui des jobs : deux politiques de report se désaccordent
    au premier ajustement, et c'est celle qu'on oublierait qui martèlerait.
    """
    utilisateur = await destinataire(session)
    lignes = await depose(session, utilisateur)
    courriel = next(ligne for ligne in lignes if ligne.channel is MessageChannel.EMAIL)
    maximum = get_settings().job_max_attempts

    for tour in range(maximum):
        courriel.run_after = datetime.now(UTC) - timedelta(seconds=1)
        await session.flush()
        await outbox.vider(
            session,
            email_sender=FauxCourriel(leve=EmailError("injoignable")),
            push_sender=FauxPush(),
        )
        del tour

    assert courriel.attempts == maximum
    assert courriel.skipped_reason == outbox.ECARTE_EPUISE
    assert await outbox.en_attente(session) == []


async def test_un_push_sans_terminal_est_ecarte_et_non_reporte(
    session: AsyncSession,
) -> None:
    """Le prochain passage trouverait la même absence."""
    utilisateur = await destinataire(session)
    lignes = await depose(session, utilisateur)

    resultat = await outbox.vider(session, email_sender=FauxCourriel(), push_sender=FauxPush())

    pousse = next(ligne for ligne in lignes if ligne.channel is MessageChannel.PUSH)
    assert pousse.skipped_reason == outbox.ECARTE_SANS_TERMINAL
    assert resultat.ecartes == 1


async def test_un_jeton_declare_mort_est_revoque(session: AsyncSession) -> None:
    """C'est la seule occasion qu'on ait de l'apprendre."""
    utilisateur = await destinataire(session)
    await avec_un_terminal(session, utilisateur)
    await depose(session, utilisateur)

    await outbox.vider(
        session,
        email_sender=FauxCourriel(),
        push_sender=FauxPush(Verdict.JETON_INVALIDE),
    )

    statut = await session.scalar(
        sa.select(DeviceToken.status).where(DeviceToken.user_id == utilisateur.id)
    )
    assert statut is DeviceTokenStatus.REVOKED


# --------------------------------------------------------------------------
# l'ordre
# --------------------------------------------------------------------------


async def test_le_plus_ancien_part_en_premier(session: AsyncSession) -> None:
    """Une boîte lue dans l'autre sens laisse le premier arrivé au fond."""
    utilisateur = await destinataire(session)
    vieux = await depose(session, utilisateur, item="Le premier")
    for ligne in vieux:
        ligne.run_after = datetime.now(UTC) - timedelta(hours=1)
    await session.flush()
    await depose(session, utilisateur, item="Le second")

    attente = await outbox.en_attente(session)

    assert attente[0].values["item"] == "Le premier"


# --------------------------------------------------------------------------
# les contraintes, éprouvées en SQL direct
# --------------------------------------------------------------------------


async def test_la_base_accepte_un_message_bien_forme(conn: AsyncConnection) -> None:
    """**Le sens qui passe.** Une contrainte qui refuse tout passerait les refus
    suivants sans rien garantir."""
    user_id = await new_user(conn, password_hash=PASSWORD_HASH)
    await conn.execute(
        sa.insert(OutboundMessage).values(
            channel=MessageChannel.EMAIL,
            user_id=user_id,
            kind=GENRE,
            template_key=CLE,
            values={},
            sent_at=datetime.now(UTC),
        )
    )


@pytest.mark.parametrize(
    ("champs", "contrainte"),
    [
        pytest.param(
            {"sent_at": datetime.now(UTC), "skipped_reason": "les deux"},
            "ck_outbound_message_pas_parti_et_ecarte",
            id="parti et écarté",
        ),
        pytest.param(
            {"attempts": -1},
            "ck_outbound_message_tentatives_positives",
            id="tentatives négatives",
        ),
    ],
)
async def test_la_base_refuse_les_lignes_incoherentes(
    conn: AsyncConnection, champs: dict, contrainte: str
) -> None:
    user_id = await new_user(conn, password_hash=PASSWORD_HASH)
    insertion = sa.insert(OutboundMessage).values(
        channel=MessageChannel.EMAIL,
        user_id=user_id,
        kind=GENRE,
        template_key=CLE,
        values={},
        **champs,
    )

    with pytest.raises(IntegrityError) as echec:
        async with conn.begin_nested():
            await conn.execute(insertion)
    assert echec.value.orig.diag.constraint_name == contrainte

    # La transaction reste utilisable après le refus.
    assert await conn.scalar(sa.select(sa.literal(1))) == 1


# --------------------------------------------------------------------------
# le réglage retiré
# --------------------------------------------------------------------------


async def test_plus_aucun_genre_ne_se_coupe(session: AsyncSession) -> None:
    """**Les sept genres restent, le réglage part.**

    Le produit n'a plus de choix par personne : tout ce qu'il a à dire, il le
    dit. Ce test tient la décision — si un filtre par genre revenait sans qu'on
    le décide, il tomberait.

    Éprouvé sur **les sept genres** et non sur un seul : une garde qui n'en
    regarderait qu'un laisserait passer un filtre posé sur les six autres.
    """
    from app.models.enums import NotificationKind
    from app.services import notifications

    utilisateur = await destinataire(session)

    for genre in NotificationKind:
        assert await notifications.joignable(session, user_id=utilisateur.id, kind=genre)


async def test_la_suspension_ferme_toujours_tous_les_genres(session: AsyncSession) -> None:
    """L'autre sens, et c'est la garantie qui devait survivre au retrait.

    Une joignabilité qui rendrait toujours vrai passerait le test ci-dessus sans
    rien garantir — et un compte suspendu recevrait, ce qui est exactement ce
    que le produit promet de ne jamais faire.
    """
    from app.models.enums import NotificationKind
    from app.services import notifications

    utilisateur = await destinataire(session)
    await session.execute(
        sa.update(User).where(User.id == utilisateur.id).values(status=UserStatus.SUSPENDED)
    )
    await session.flush()

    for genre in NotificationKind:
        assert not await notifications.joignable(session, user_id=utilisateur.id, kind=genre)
