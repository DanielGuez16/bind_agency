"""La reprise d'un compte commerce par l'administration.

**La garantie qui porte ce fichier : après l'activation, l'administration n'a
aucun accès au compte d'un salon.** Elle en obtient un par un geste explicite,
motivé, borné dans le temps, et **dont le salon est prévenu**. Les quatre
qualificatifs comptent ensemble : une reprise sans motif ne dit pas pourquoi on
est entré, une reprise sans terme redevient un accès permanent, et une reprise
silencieuse est un accès dont personne ne peut demander compte.

Le sens inverse compte autant : hors reprise, un administrateur reçoit le même
refus que n'importe qui. Une dérogation qui laisserait passer sans reprise
rendrait tout le dispositif décoratif.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import get_settings
from app.models import AuditLog, BusinessSupportAccess, User
from app.models.enums import ActorKind, UserRole
from app.services import auth as auth_service
from app.services import support as service
from tests.factories import PASSWORD_HASH, new_business, new_user
from tests.test_activation import commerce_en_cours

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def administrateur(session: AsyncSession) -> User:
    return await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.ADMIN,
    )


# --------------------------------------------------------------------------
# aucun accès sans reprise
# --------------------------------------------------------------------------


async def test_hors_reprise_un_administrateur_n_a_aucun_acces(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**La garantie de fond.** Sans reprise ouverte, le refus est le même que
    pour n'importe qui."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": admin.email, "password": MOT_DE_PASSE}
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 403, reponse.text


async def test_pendant_une_reprise_l_administrateur_agit_au_nom_du_salon(
    session: AsyncSession, client: AsyncClient
) -> None:
    """La reprise ouvre la porte — c'est ce à quoi elle sert."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=business, admin=admin, motif="débloquer les horaires")
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login", json={"email": admin.email, "password": MOT_DE_PASSE}
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200, reponse.text
    assert reponse.json()["id"] == str(business.id)


async def test_une_reprise_expiree_ne_donne_plus_rien(session: AsyncSession) -> None:
    """**Bornée**, et vérifié sur l'horloge de lecture : une reprise qu'on
    oublie de fermer redeviendrait un accès permanent."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    acces = await service.ouvrir(
        session, business=business, admin=admin, motif="comprendre un refus"
    )

    apres = acces.expires_at + timedelta(seconds=1)

    assert (
        await service.en_cours(
            session, business_id=business.id, admin_user_id=admin.id, maintenant=apres
        )
        is None
    )


async def test_une_reprise_fermee_ne_donne_plus_rien(session: AsyncSession) -> None:
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    acces = await service.ouvrir(
        session, business=business, admin=admin, motif="débloquer les horaires"
    )

    await service.fermer(session, acces=acces, admin=admin)

    assert acces.ended_at is not None
    assert await service.en_cours(session, business_id=business.id, admin_user_id=admin.id) is None


async def test_la_reprise_d_un_administrateur_n_ouvre_rien_a_un_autre(
    session: AsyncSession,
) -> None:
    """Nominative. Un accès ouvert par l'un ne se prête pas."""
    business, _ = await commerce_en_cours(session)
    premier = await administrateur(session)
    second = await administrateur(session)
    await service.ouvrir(session, business=business, admin=premier, motif="débloquer les horaires")

    assert await service.en_cours(session, business_id=business.id, admin_user_id=second.id) is None


async def test_la_reprise_ne_vaut_que_pour_ce_commerce(session: AsyncSession) -> None:
    """Le sens qu'on oublierait de vérifier : une reprise ouverte chez A ne doit
    pas ouvrir B."""
    chez_a, _ = await commerce_en_cours(session)
    chez_b, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=chez_a, admin=admin, motif="un motif")

    assert await service.en_cours(session, business_id=chez_b.id, admin_user_id=admin.id) is None


# --------------------------------------------------------------------------
# explicite, et motivée
# --------------------------------------------------------------------------


async def test_un_motif_vide_est_refuse(session: AsyncSession) -> None:
    """Le motif est ce qui distingue une intervention d'une habitude."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)

    with pytest.raises(service.ReasonRequired):
        await service.ouvrir(session, business=business, admin=admin, motif="   ")

    assert await service.en_cours(session, business_id=business.id, admin_user_id=admin.id) is None


async def test_seul_un_administrateur_reprend(session: AsyncSession) -> None:
    business, proprietaire = await commerce_en_cours(session)

    with pytest.raises(service.NotAnAdmin):
        await service.ouvrir(session, business=business, admin=proprietaire, motif="un motif")


async def test_on_n_ouvre_pas_deux_reprises_a_la_fois(session: AsyncSession) -> None:
    """Deux motifs pour une seule intervention feraient deux lignes dans la
    liste du salon là où il ne s'est rien passé de plus."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=business, admin=admin, motif="premier motif")

    with pytest.raises(service.AlreadyOpen):
        await service.ouvrir(session, business=business, admin=admin, motif="second motif")


async def test_l_ouverture_ecrit_son_motif_au_journal(session: AsyncSession) -> None:
    """**Au journal, qui ne s'efface pas.** La ligne de reprise peut être
    supprimée un jour ; ce qu'on relira alors est là."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)

    await service.ouvrir(session, business=business, admin=admin, motif="débloquer les horaires")

    entree = await session.scalar(
        sa.select(AuditLog).where(
            AuditLog.entity_id == business.id, AuditLog.reason == service.REASON_OUVERTE
        )
    )
    assert entree is not None
    assert entree.note == "débloquer les horaires"
    assert entree.actor_kind is ActorKind.ADMIN
    assert entree.actor_user_id == admin.id


# --------------------------------------------------------------------------
# visible du salon
# --------------------------------------------------------------------------


async def test_le_salon_lit_les_reprises_passees(
    session: AsyncSession, client: AsyncClient
) -> None:
    """**Ce qui rend le dispositif acceptable.** Un accès qu'on découvre n'est
    pas un accès déclaré."""
    business, proprietaire = await commerce_en_cours(session)
    admin = await administrateur(session)
    acces = await service.ouvrir(
        session, business=business, admin=admin, motif="débloquer les horaires"
    )
    await service.fermer(session, acces=acces, admin=admin)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE},
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/support-access",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200, reponse.text
    lignes = reponse.json()
    assert len(lignes) == 1
    assert lignes[0]["reason"] == "débloquer les horaires"
    assert lignes[0]["ended_at"] is not None


async def test_un_salon_ne_lit_pas_les_reprises_d_un_autre(
    session: AsyncSession, client: AsyncClient
) -> None:
    """La fuite classique entre locataires, sur une route neuve."""
    chez_a, _ = await commerce_en_cours(session)
    chez_b, proprietaire_b = await commerce_en_cours(session)
    admin = await administrateur(session)
    await service.ouvrir(session, business=chez_a, admin=admin, motif="un motif")
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire_b.email, "password": MOT_DE_PASSE},
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{chez_a.id}/support-access",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 403, reponse.text
    del chez_b


async def test_l_historique_garde_les_reprises_closes(session: AsyncSession) -> None:
    """N'afficher que celles en cours dirait « personne n'est entré » à
    quelqu'un chez qui on est entré trois fois."""
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    for motif in ("première", "deuxième"):
        acces = await service.ouvrir(session, business=business, admin=admin, motif=motif)
        await service.fermer(session, acces=acces, admin=admin)

    lignes = await service.historique(session, business_id=business.id)

    assert [ligne.reason for ligne in lignes] == ["deuxième", "première"]


# --------------------------------------------------------------------------
# les contraintes, éprouvées en SQL direct
# --------------------------------------------------------------------------


async def _insertion(conn: AsyncConnection, **overrides):
    business_id = await new_business(conn)
    admin_id = await new_user(conn, role=UserRole.ADMIN, password_hash=PASSWORD_HASH)
    instant = datetime.now(UTC)
    valeurs = {
        "business_id": business_id,
        "admin_user_id": admin_id,
        "reason": "un motif",
        "expires_at": instant + timedelta(hours=2),
    } | overrides
    return sa.insert(BusinessSupportAccess).values(**valeurs)


async def test_la_base_accepte_une_reprise_bien_formee(conn: AsyncConnection) -> None:
    """**Le sens qui passe.** Une contrainte qui refuse tout passerait les
    refus suivants sans rien garantir."""
    await conn.execute(await _insertion(conn))


@pytest.mark.parametrize(
    ("champs", "contrainte"),
    [
        pytest.param(
            {"reason": "   "},
            "ck_business_support_access_motif_non_vide",
            id="motif vide",
        ),
        pytest.param(
            {"reason": "x" * 501},
            "ck_business_support_access_motif_borne",
            id="motif trop long",
        ),
        pytest.param(
            {"expires_at": datetime.now(UTC) - timedelta(hours=1)},
            "ck_business_support_access_expire_apres_ouverture",
            id="expire avant d'être ouverte",
        ),
        pytest.param(
            {"ended_at": datetime.now(UTC) - timedelta(hours=1)},
            "ck_business_support_access_close_apres_ouverture",
            id="close avant d'être ouverte",
        ),
    ],
)
async def test_la_base_refuse_les_reprises_incoherentes(
    conn: AsyncConnection, champs: dict, contrainte: str
) -> None:
    insertion = await _insertion(conn, **champs)

    with pytest.raises(IntegrityError) as echec:
        async with conn.begin_nested():
            await conn.execute(insertion)
    assert echec.value.orig.diag.constraint_name == contrainte

    # La transaction reste utilisable après le refus.
    assert await conn.scalar(sa.select(sa.literal(1))) == 1


async def test_la_fermeture_ne_compare_pas_deux_horloges(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Deux horloges, et une contrainte qui les compare.**

    `started_at` est écrit par `clock_timestamp()`, côté Postgres. `ended_at`
    l'était par `datetime.now(UTC)`, côté Python. La contrainte
    `close_apres_ouverture` compare les deux : il suffit que l'horloge de la
    base soit en avance de quelques millisecondes pour qu'une reprise ouverte
    puis refermée dans la foulée paraisse s'être fermée avant de s'ouvrir.

    Vu en intégration continue avec les chiffres — 2,7 millisecondes d'écart —
    et sur trois tests d'un coup.

    **Le sabotage est une horloge Python en retard**, ce qui est exactement la
    forme du défaut. Avec l'ancienne écriture il produit la violation à tous les
    coups ; avec la nouvelle il ne change rien, puisque l'heure ne vient plus de
    là. Un test qui se contenterait de vérifier `ended_at >= started_at` sur
    l'horloge du jour passerait dans les deux cas — c'est le décor qui pourrait
    être produit par le code fautif.
    """
    business, _ = await commerce_en_cours(session)
    admin = await administrateur(session)
    acces = await service.ouvrir(
        session, business=business, admin=admin, motif="débloquer les horaires"
    )

    class HorlogeEnRetard(datetime):
        @classmethod
        def now(cls, tz=None):  # noqa: ANN001, ANN206 - signature de datetime
            return datetime.now(tz) - timedelta(seconds=1)

    monkeypatch.setattr(service, "datetime", HorlogeEnRetard)

    ferme = await service.fermer(session, acces=acces, admin=admin)

    assert ferme.ended_at is not None
    assert ferme.ended_at >= ferme.started_at
    # La session reste saine : une violation attrapée hors point de sauvegarde
    # la laisserait inutilisable, et le défaut ressortirait ailleurs.
    assert await session.scalar(sa.select(sa.literal(1))) == 1
