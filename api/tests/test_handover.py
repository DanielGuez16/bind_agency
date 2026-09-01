"""La fiche préparée sur le terrain, et sa prise en main.

**La garantie qui porte ce fichier : la fondatrice saisit des faits, jamais des
engagements.** Une fiche préparée n'appartient à personne, n'est visible de
personne, et ne s'ouvre pas. Ce qui la fait exister comme commerce, c'est un
gérant qui crée son compte et accepte les conditions — et ce moment-là laisse
une trace que rien n'efface.

Deux autres propriétés comptent presque autant. **Un seul lien vivant par
fiche** : renvoyer un lien ferme le précédent, sans quoi un lien envoyé trois
fois laisserait trois portes ouvertes. Et **un refus ne dit jamais laquelle des
quatre raisons s'applique** : distinguer « expiré » de « inconnu » apprendrait
quels salons ont été démarchés.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import ManualGeocoder
from app.models import AuditLog, Business, BusinessHandover, BusinessMember, User
from app.models.enums import (
    BusinessCategory,
    BusinessMemberRole,
    BusinessStatus,
    HandoverChannel,
    UserRole,
)
from app.schemas.business import BusinessCreate, CoordinatesPayload
from app.services import auth as auth_service
from app.services import business as business_service
from app.services import handover as service
from app.services.audit import Actor
from tests.conftest import inscrire_verifie
from tests.factories import PASSWORD_HASH, new_business, new_user

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"
MIAMI = CoordinatesPayload(longitude=-80.1918, latitude=25.7617)


def fiche(**overrides) -> BusinessCreate:
    champs = {
        "name": "Salon Ocean",
        "category": BusinessCategory.BEAUTY,
        "currency": "USD",
        "address": "100 Ocean Drive, Miami, FL",
        "coordinates": MIAMI,
        "timezone": "America/New_York",
    } | overrides
    return BusinessCreate(**champs)


async def fondatrice(session: AsyncSession) -> User:
    return await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )


async def preparee(session: AsyncSession, **overrides) -> tuple[Business, User]:
    """Une fiche préparée au comptoir, et celle qui l'a préparée."""
    admin = await fondatrice(session)
    business = await service.preparer_la_fiche(
        session,
        payload=fiche(**overrides),
        prepare_par=admin,
        geocoder=ManualGeocoder(),
    )
    return business, admin


@pytest.fixture(autouse=True)
def _adresse_de_prise_en_main(monkeypatch: pytest.MonkeyPatch):
    """Sans elle, l'émission refuse — et c'est voulu, c'est éprouvé plus bas."""
    get_settings.cache_clear()
    monkeypatch.setenv("HANDOVER_BASE_URL", "https://bind.example/reprendre")
    yield
    get_settings.cache_clear()


# --------------------------------------------------------------------------
# une fiche préparée n'appartient à personne
# --------------------------------------------------------------------------


async def test_une_fiche_preparee_n_a_aucun_membre(session: AsyncSession) -> None:
    """**La garantie de fond.** Elle prépare, elle ne possède pas.

    Vérifié sur l'appartenance et non sur le statut : c'est `business_member`
    qui donne accès à un commerce, et une fondatrice rattachée à cinquante
    salons pourrait agir dans chacun sans que rien ne le dise.
    """
    business, admin = await preparee(session)

    membres = (
        await session.scalars(
            sa.select(BusinessMember).where(BusinessMember.business_id == business.id)
        )
    ).all()

    assert business.status is BusinessStatus.DRAFT
    assert membres == []
    assert admin.role is UserRole.ADMIN


async def test_une_fiche_preparee_ne_s_ouvre_pas(session: AsyncSession) -> None:
    """L'activer publierait un salon que personne n'assume.

    Le refus est nommé : « ça n'a pas marché » enverrait chercher une étape
    manquante, alors que toutes les étapes bloquantes sont faites.
    """
    business, admin = await preparee(session)

    with pytest.raises(business_service.NotClaimed):
        await business_service.activate_business(
            session, business=business, actor=Actor.from_user(admin)
        )

    # La session reste saine, et la fiche n'a pas bougé.
    await session.refresh(business)
    assert business.status is BusinessStatus.DRAFT


async def test_une_fiche_preparee_est_invisible_de_la_fiche_publique(
    session: AsyncSession, client: AsyncClient
) -> None:
    """Ce que le créateur verrait s'il devinait l'identifiant : rien."""
    business, _ = await preparee(session)
    await session.commit()
    createur = await compte(client, UserRole.CREATOR)

    reponse = await client.get(f"{PREFIX}/businesses/{business.id}", headers=createur["headers"])
    assert reponse.status_code == 404, reponse.text


# --------------------------------------------------------------------------
# le jeton
# --------------------------------------------------------------------------


async def test_le_jeton_n_est_pas_stocke(session: AsyncSession) -> None:
    """La base ne contient pas de quoi ouvrir une fiche.

    Vérifié en cherchant le jeton lui-même dans la colonne, et pas seulement en
    lisant que la colonne s'appelle « empreinte ».
    """
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )

    stocke = await session.scalar(
        sa.select(BusinessHandover.token_hash).where(BusinessHandover.id == emis.handover_id)
    )
    assert stocke != emis.jeton.encode()
    assert emis.jeton not in stocke.decode("latin-1")
    assert len(stocke) == 32
    assert emis.jeton in emis.url


async def test_emettre_ferme_le_lien_precedent(session: AsyncSession) -> None:
    """Un seul vivant. Le lien perdu ne reste pas ouvert derrière le nouveau."""
    business, admin = await preparee(session)
    premier = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )
    second = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )

    with pytest.raises(service.HandoverUnknown):
        await service.resoudre(session, jeton=premier.jeton)

    # Et le nouveau, lui, ouvre bien.
    assert (await service.resoudre(session, jeton=second.jeton)).id == second.handover_id


async def test_un_lien_revoque_ne_resout_plus(session: AsyncSession) -> None:
    """La fondatrice ferme le lien, et il ne s'ouvre plus."""
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )

    ferme = await service.revoquer(session, business=business, actor=admin)

    assert ferme is not None and ferme.id == emis.handover_id
    with pytest.raises(service.HandoverUnknown):
        await service.resoudre(session, jeton=emis.jeton)


async def test_un_lien_expire_ne_resout_plus(session: AsyncSession) -> None:
    """**L'expiration se mesure au moment où on résout**, pas à l'émission.

    Éprouvée en avançant l'horloge de lecture et non en reculant la date
    d'expiration : la base refuse une ligne qui expire avant d'être émise —
    c'est une autre garantie, et elle a son propre test.
    """
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )

    plus_tard = emis.expires_at + timedelta(seconds=1)

    assert (await service.resoudre(session, jeton=emis.jeton)).id == emis.handover_id
    with pytest.raises(service.HandoverUnknown):
        await service.resoudre(session, jeton=emis.jeton, maintenant=plus_tard)


async def test_un_jeton_inconnu_est_refuse(session: AsyncSession) -> None:
    with pytest.raises(service.HandoverUnknown):
        await service.resoudre(session, jeton="jamais-emis")


async def test_l_emission_refuse_sans_adresse_configuree(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Plutôt que de fabriquer une adresse. Un lien mort est la seule impression
    que le gérant gardera."""
    business, admin = await preparee(session)

    # **On surcharge le réglage, pas la variable d'environnement.**
    #
    # `monkeypatch.delenv` vidait `os.environ`, ce qui n'empêche pas
    # pydantic-settings de relire le fichier `.env` : le test ne passait donc
    # que sur une machine dont le fichier ne porte pas `HANDOVER_BASE_URL` —
    # c'est-à-dire vert partout **parce que** personne ne configurait la
    # variable qu'il éprouve. Le jour où quelqu'un la renseigne, et le mode
    # terrain en a besoin pour exister, ce test tombe sans qu'aucun code n'ait
    # bougé.
    #
    # La forme employée partout ailleurs dans cette suite remplace le résolveur
    # dans le module éprouvé : elle ne dépend ni du fichier ni du cache.
    reglages = get_settings().model_copy(update={"handover_base_url": None})
    monkeypatch.setattr("app.services.handover.get_settings", lambda: reglages)

    with pytest.raises(service.HandoverError):
        await service.emettre(session, business=business, emis_par=admin, canal=HandoverChannel.QR)


async def test_on_n_emet_pas_de_lien_sur_un_commerce_deja_pris(session: AsyncSession) -> None:
    """Un changement de main ne se prend pas par un lien."""
    business, admin = await preparee(session)
    business.status = BusinessStatus.ONBOARDING
    await session.flush()

    with pytest.raises(service.NotADraft):
        await service.emettre(session, business=business, emis_par=admin, canal=HandoverChannel.QR)


# --------------------------------------------------------------------------
# la prise en main
# --------------------------------------------------------------------------


async def test_prendre_en_main_cree_le_compte_et_le_proprietaire(session: AsyncSession) -> None:
    """Les trois écritures qui ne se séparent pas."""
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )
    lien = await service.resoudre(session, jeton=emis.jeton)

    gerant, repris = await service.prendre_en_main(
        session,
        handover=lien,
        email="gerant@salon.example",
        password=MOT_DE_PASSE,
        terms_version=get_settings().terms_version,
    )

    appartenance = await session.scalar(
        sa.select(BusinessMember).where(
            BusinessMember.business_id == business.id, BusinessMember.user_id == gerant.id
        )
    )
    assert gerant.role is UserRole.BUSINESS_MEMBER
    assert appartenance is not None
    assert appartenance.role is BusinessMemberRole.OWNER
    # `onboarding`, pas `active` : c'est le salon qui décide de se montrer,
    # après avoir vu ce qui a été préparé en son nom.
    assert repris.status is BusinessStatus.ONBOARDING
    assert lien.used_at is not None
    assert lien.used_by_user_id == gerant.id


async def test_la_version_acceptee_est_ecrite_au_journal(session: AsyncSession) -> None:
    """**La preuve de l'engagement.** Qui, quand, sur quelle version.

    Au journal d'audit et non sur la ligne de prise en main : le journal est
    immuable et ne disparaît pas avec le commerce.
    """
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.EMAIL
    )
    lien = await service.resoudre(session, jeton=emis.jeton)
    gerant, _ = await service.prendre_en_main(
        session,
        handover=lien,
        email="gerant@salon.example",
        password=MOT_DE_PASSE,
        terms_version=get_settings().terms_version,
    )

    entree = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == business.id, AuditLog.reason == service.REASON_PRISE_EN_MAIN
        )
    )
    assert entree is not None
    assert entree.from_status == BusinessStatus.DRAFT.value
    assert entree.to_status == BusinessStatus.ONBOARDING.value
    assert entree.actor_user_id == gerant.id
    assert entree.extra["terms_version"] == get_settings().terms_version


async def test_un_lien_ne_sert_qu_une_fois(session: AsyncSession) -> None:
    """Le second gérant qui ouvrirait le même lien ne prend rien."""
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )
    lien = await service.resoudre(session, jeton=emis.jeton)
    await service.prendre_en_main(
        session,
        handover=lien,
        email="premier@salon.example",
        password=MOT_DE_PASSE,
        terms_version=get_settings().terms_version,
    )

    with pytest.raises(service.HandoverUnknown):
        await service.resoudre(session, jeton=emis.jeton)


async def test_une_version_perimee_n_ecrit_rien(session: AsyncSession) -> None:
    """Le refus arrive **avant** la création du compte.

    Une adresse consommée par une acceptation refusée obligerait le gérant à
    s'en inventer une seconde pour réessayer.
    """
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )
    lien = await service.resoudre(session, jeton=emis.jeton)

    with pytest.raises(service.TermsNotAccepted):
        await service.prendre_en_main(
            session,
            handover=lien,
            email="gerant@salon.example",
            password=MOT_DE_PASSE,
            terms_version="conditions-de-l-an-dernier",
        )

    assert await auth_service.get_user_by_email(session, "gerant@salon.example") is None
    await session.refresh(business)
    assert business.status is BusinessStatus.DRAFT
    assert lien.used_at is None


async def test_un_compte_existant_peut_assumer_la_fiche(session: AsyncSession) -> None:
    """Le cas du deuxième salon, qui a le même propriétaire que le premier."""
    business, admin = await preparee(session)
    emis = await service.emettre(
        session, business=business, emis_par=admin, canal=HandoverChannel.QR
    )
    lien = await service.resoudre(session, jeton=emis.jeton)
    deja = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.BUSINESS_MEMBER,
    )

    repris = await service.rattacher(
        session, handover=lien, utilisateur=deja, terms_version=get_settings().terms_version
    )

    appartenance = await session.scalar(
        sa.select(BusinessMember).where(
            BusinessMember.business_id == repris.id, BusinessMember.user_id == deja.id
        )
    )
    assert appartenance is not None
    assert appartenance.role is BusinessMemberRole.OWNER


# --------------------------------------------------------------------------
# le suivi du démarchage
# --------------------------------------------------------------------------


async def test_le_suivi_garde_les_fiches_assumees(session: AsyncSession) -> None:
    """Sans elles, on ne saurait jamais combien de visites ont abouti."""
    ouverte, admin = await preparee(session, name="Salon en attente")
    assumee = await service.preparer_la_fiche(
        session, payload=fiche(name="Salon signé"), prepare_par=admin, geocoder=ManualGeocoder()
    )
    emis = await service.emettre(
        session, business=assumee, emis_par=admin, canal=HandoverChannel.EMAIL
    )
    lien = await service.resoudre(session, jeton=emis.jeton)
    await service.prendre_en_main(
        session,
        handover=lien,
        email="signe@salon.example",
        password=MOT_DE_PASSE,
        terms_version=get_settings().terms_version,
    )

    lignes = {ligne.business_id: ligne for ligne in await service.suivi(session)}

    assert lignes[ouverte.id].status is BusinessStatus.DRAFT
    assert lignes[ouverte.id].used_at is None
    assert lignes[assumee.id].status is BusinessStatus.ONBOARDING
    assert lignes[assumee.id].used_at is not None
    assert lignes[assumee.id].channel is HandoverChannel.EMAIL


# --------------------------------------------------------------------------
# les contraintes, éprouvées en SQL direct
# --------------------------------------------------------------------------


async def _ligne(conn: AsyncConnection, **overrides):
    business_id = await new_business(conn, status=BusinessStatus.DRAFT)
    admin_id = await new_user(conn, role=UserRole.ADMIN, password_hash=PASSWORD_HASH)
    instant = datetime.now(UTC)
    valeurs = {
        "business_id": business_id,
        "token_hash": uuid.uuid4().bytes,
        "channel": HandoverChannel.QR,
        "issued_by_user_id": admin_id,
        "expires_at": instant + timedelta(days=7),
    } | overrides
    return sa.insert(BusinessHandover).values(**valeurs), admin_id


async def test_la_base_accepte_une_prise_en_main_complete(conn: AsyncConnection) -> None:
    """**Le sens qui passe.** Une contrainte qui refuse tout passerait les trois
    tests suivants sans rien garantir."""
    insertion, admin_id = await _ligne(
        conn,
        used_at=datetime.now(UTC),
        accepted_terms_version="2026-01",
    )
    await conn.execute(insertion.values(used_by_user_id=admin_id))


@pytest.mark.parametrize(
    ("champs", "contrainte"),
    [
        pytest.param(
            {"used_at": datetime.now(UTC)},
            "ck_business_handover_prise_en_main_a_son_auteur_et_sa_version",
            id="assumée sans auteur ni version",
        ),
        pytest.param(
            {"used_at": datetime.now(UTC), "revoked_at": datetime.now(UTC)},
            "ck_business_handover_pas_utilise_et_revoque_a_la_fois",
            id="utilisée et révoquée",
        ),
        pytest.param(
            {"expires_at": datetime.now(UTC) - timedelta(days=1)},
            "ck_business_handover_expire_apres_emission",
            id="expire avant d'être émise",
        ),
    ],
)
async def test_la_base_refuse_les_lignes_incoherentes(
    conn: AsyncConnection, champs: dict, contrainte: str
) -> None:
    """Éprouvé en SQL direct, sans passer par le service qu'elles doublent."""
    insertion, _ = await _ligne(conn, **champs)

    with pytest.raises(IntegrityError) as echec:
        async with conn.begin_nested():
            await conn.execute(insertion)
    assert echec.value.orig.diag.constraint_name == contrainte

    # La transaction reste utilisable après le refus.
    assert await conn.scalar(sa.select(sa.literal(1))) == 1


# --------------------------------------------------------------------------
# les routes
# --------------------------------------------------------------------------


async def compte(client: AsyncClient, role: UserRole) -> dict:
    email = f"{uuid.uuid4()}@example.com"
    cree = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": MOT_DE_PASSE, "role": role.value},
    )
    assert cree.status_code == 201, cree.text
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": MOT_DE_PASSE})
    ).json()
    return {
        "email": email,
        "headers": {"Authorization": f"Bearer {jetons['access_token']}"},
    }


async def test_un_createur_ne_prepare_pas_de_fiche(client: AsyncClient) -> None:
    createur = await compte(client, UserRole.CREATOR)
    reponse = await client.post(
        f"{PREFIX}/admin/prospects",
        json=fiche().model_dump(mode="json"),
        headers=createur["headers"],
    )
    assert reponse.status_code == 403, reponse.text


async def test_le_parcours_complet_depuis_les_routes(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Du comptoir au compte : préparer, émettre, voir, assumer, se connecter.

    C'est le seul test qui parcourt les deux côtés — celui de la fondatrice et
    celui du salon — et il vérifie ce que rien d'autre ne vérifie : que le
    gérant peut effectivement se connecter au compte qu'il vient de créer.
    """
    admin = await fondatrice(session)
    await session.commit()
    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": admin.email, "password": MOT_DE_PASSE}
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    prospect = await client.post(
        f"{PREFIX}/admin/prospects", json=fiche().model_dump(mode="json"), headers=entetes
    )
    assert prospect.status_code == 201, prospect.text
    assert prospect.json()["status"] == BusinessStatus.DRAFT.value

    emission = await client.post(
        f"{PREFIX}/admin/prospects/{prospect.json()['id']}/handover",
        json={"channel": HandoverChannel.QR.value},
        headers=entetes,
    )
    assert emission.status_code == 200, emission.text
    jeton = emission.json()["url"].rsplit("/", 1)[-1]

    # Le salon, qui n'est connecté à rien.
    apercu = await client.get(f"{PREFIX}/handover/{jeton}")
    assert apercu.status_code == 200, apercu.text
    assert apercu.json()["business_name"] == "Salon Ocean"

    prise = await client.post(
        f"{PREFIX}/handover/{jeton}/claim",
        json={
            "email": "comptoir@salon.example",
            "password": MOT_DE_PASSE,
            "terms_version": apercu.json()["terms_version"],
        },
    )
    assert prise.status_code == 200, prise.text
    assert prise.json()["status"] == BusinessStatus.ONBOARDING.value

    connexion = await client.post(
        f"{PREFIX}/auth/login",
        json={"email": "comptoir@salon.example", "password": MOT_DE_PASSE},
    )
    assert connexion.status_code == 200, connexion.text

    mes_commerces = await client.get(
        f"{PREFIX}/me/businesses",
        headers={"Authorization": f"Bearer {connexion.json()['access_token']}"},
    )
    assert [c["id"] for c in mes_commerces.json()] == [prospect.json()["id"]]


async def test_un_jeton_inconnu_rend_le_meme_refus_qu_un_jeton_mort(
    client: AsyncClient,
) -> None:
    """Le code d'erreur ne distingue pas les quatre raisons."""
    reponse = await client.get(f"{PREFIX}/handover/{uuid.uuid4()}")
    assert reponse.status_code == 404
    assert reponse.json()["detail"] == "handover_invalid"
