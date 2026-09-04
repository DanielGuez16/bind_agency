"""Journal d'audit des transitions d'état.

Deux propriétés comptent ici. D'abord qu'une transition et sa ligne de journal
apparaissent ensemble, ou pas du tout : un `commit` qui laisse la transition
sans sa trace rend le dossier indéfendable. Ensuite que la ligne, une fois
écrite, ne puisse plus bouger.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.core.config import get_settings
from app.models import AuditLog, RefreshToken, User
from app.models.enums import ActorKind, RefreshTokenState, UserRole, UserStatus
from app.services import audit as audit_service
from app.services import auth as auth_service
from tests.conftest import inscrire_verifie
from tests.factories import new_user

PREFIX = get_settings().api_v1_prefix


async def journal(
    conn: AsyncConnection, entity: str | None = None, entity_id: object = None
) -> list:
    """Lignes de journal, dans l'ordre où elles ont été écrites.

    `select(AuditLog.__table__)` et non `select(AuditLog)` : sur une connexion
    Core, la seconde forme renvoie des colonnes et non une entité.

    **`entity_id` restreint à ce que le test vient d'écrire, et ce n'est pas un
    confort.** Le journal d'audit est immuable : les deux tests qui écrivent pour
    de bon y laissent leurs lignes, et le nettoyage ne les retire pas — c'est
    écrit dans leur dérogation. Lire la table entière ne marchait donc que par
    l'ordre alphabétique des fichiers, qui plaçait ce fichier-ci avant eux.

    En parallèle, cet ordre n'existe plus : sept lignes là où le test en
    attendait une, et la première n'était pas la sienne. La règle est la même
    que celle de la garde anti-fuite — ne désigner que ce qu'on a soi-même
    écrit.
    """
    statement = sa.select(AuditLog.__table__).order_by(AuditLog.occurred_at)
    if entity is not None:
        statement = statement.where(AuditLog.entity_type == entity)
    if entity_id is not None:
        statement = statement.where(AuditLog.entity_id == entity_id)
    return (await conn.execute(statement)).all()


async def register_and_login(client: AsyncClient, role: UserRole = UserRole.CREATOR) -> dict:
    email = f"{uuid.uuid4()}@example.com"
    password = "tourbillon-cactus-91-vermeil"
    created = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": email,
            "password": password,
            "role": role.value,
            "date_of_birth": "1992-04-17",
        },
    )
    assert created.status_code == 201
    logged = await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    assert logged.status_code == 200
    return {"user_id": created.json()["id"], "email": email} | logged.json()


# --------------------------------------------------------------------------
# la transition et sa trace vont ensemble
# --------------------------------------------------------------------------


async def test_l_inscription_ecrit_sa_ligne_de_journal(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    email = "journal@example.com"

    response = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": email,
            "password": "tourbillon-cactus-91-vermeil",
            "role": "creator",
            "date_of_birth": "1992-04-17",
        },
    )
    assert response.status_code == 201

    lignes = await journal(conn, entity="app_user", entity_id=uuid.UUID(response.json()["id"]))
    assert len(lignes) == 1
    ligne = lignes[0]
    assert ligne.entity_id == uuid.UUID(response.json()["id"])
    assert ligne.from_status is None
    assert ligne.to_status == UserStatus.ACTIVE.value
    assert ligne.actor_kind == ActorKind.CREATOR
    assert ligne.actor_user_id == ligne.entity_id


async def test_la_connexion_journalise_l_emission_du_jeton(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    tokens = await register_and_login(client)

    lignes = await journal(conn, entity="refresh_token")
    assert len(lignes) == 1
    ligne = lignes[0]
    assert ligne.from_status is None
    assert ligne.to_status == RefreshTokenState.ISSUED.value
    assert ligne.actor_user_id == uuid.UUID(tokens["user_id"])


async def test_la_rotation_journalise_la_revocation_puis_l_emission(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    tokens = await register_and_login(client)

    rotated = await client.post(
        f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert rotated.status_code == 200

    lignes = await journal(conn, entity="refresh_token")
    assert [ligne.to_status for ligne in lignes] == [
        RefreshTokenState.ISSUED.value,
        RefreshTokenState.REVOKED.value,
        RefreshTokenState.ISSUED.value,
    ]
    assert lignes[1].reason == auth_service.REASON_ROTATION
    assert lignes[1].actor_kind == ActorKind.CREATOR


async def test_la_deconnexion_journalise_sa_raison(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    tokens = await register_and_login(client)

    response = await client.post(
        f"{PREFIX}/auth/logout", json={"refresh_token": tokens["refresh_token"]}
    )
    assert response.status_code == 204

    revocations = [
        row
        for row in await journal(conn, entity="refresh_token")
        if row.to_status == RefreshTokenState.REVOKED.value
    ]
    assert len(revocations) == 1
    assert revocations[0].reason == auth_service.REASON_LOGOUT


async def test_le_rejeu_journalise_une_coupure_systeme_sans_acteur_utilisateur(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Une transition automatique n'a pas d'acteur humain, et le journal le dit."""
    tokens = await register_and_login(client)
    await client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})

    # Rejeu de l'ancien jeton : le système coupe toutes les sessions du compte.
    await client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})

    coupures = [
        row
        for row in await journal(conn, entity="refresh_token")
        if row.reason == auth_service.REASON_REUSE_DETECTED
    ]
    assert coupures, "le rejeu doit laisser une trace"
    for coupure in coupures:
        assert coupure.actor_kind == ActorKind.SYSTEM
        assert coupure.actor_user_id is None
        assert coupure.from_status == RefreshTokenState.ISSUED.value
        assert coupure.to_status == RefreshTokenState.REVOKED.value


async def test_une_ligne_par_jeton_coupe_et_non_une_seule_pour_le_lot(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    tokens_a = await register_and_login(client)
    # Une seconde session sur le même compte, obtenue par rotation.
    await client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": tokens_a["refresh_token"]})
    await client.post(
        f"{PREFIX}/auth/login",
        json={"email": tokens_a["email"], "password": "tourbillon-cactus-91-vermeil"},
    )

    encore_actifs = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(RefreshToken)
        .where(
            RefreshToken.user_id == uuid.UUID(tokens_a["user_id"]),
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert encore_actifs == 2

    await client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": tokens_a["refresh_token"]})

    coupures = [
        row
        for row in await journal(conn, entity="refresh_token")
        if row.reason == auth_service.REASON_REUSE_DETECTED
    ]
    assert len(coupures) == encore_actifs
    assert len({coupure.entity_id for coupure in coupures}) == encore_actifs


# --------------------------------------------------------------------------
# ou pas du tout
# --------------------------------------------------------------------------


async def test_un_rollback_ne_laisse_aucune_ligne_orpheline(
    session: AsyncSession, conn: AsyncConnection
) -> None:
    """La ligne de journal vit dans la transaction de la transition qu'elle décrit.

    **Compté en écart, jamais en absolu.** Ce test lisait le journal entier et
    exigeait une ligne : il ne passait que parce qu'il s'exécutait avant les deux
    tests qui écrivent pour de bon, dans l'ordre alphabétique des fichiers. En
    parallèle, l'ordre n'est plus garanti — il a vu sept lignes et en attendait
    une. C'est la même règle que la garde anti-fuite, qui compare un avant et un
    après pour ne désigner que celui qui a écrit.
    """
    avant = len(await journal(conn, entity="app_user"))

    await inscrire_verifie(
        session,
        email="annule@example.com",
        password="tourbillon-cactus-91-vermeil",
        role=UserRole.CREATOR,
    )
    assert len(await journal(conn, entity="app_user")) == avant + 1

    await session.rollback()

    assert len(await journal(conn, entity="app_user")) == avant
    # Les comptes que les tests d'écriture réelle laissent derrière eux ne sont
    # pas les nôtres : on vérifie que **le nôtre** est parti.
    assert (
        await conn.scalar(
            sa.select(sa.func.count()).select_from(User).where(User.email == "annule@example.com")
        )
        == 0
    )


async def test_une_inscription_refusee_ne_laisse_aucune_ligne(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    payload = {
        "email": "doublon@example.com",
        "password": "tourbillon-cactus-91-vermeil",
        "role": "creator",
        "date_of_birth": "1992-04-17",
    }
    avant = len(await journal(conn, entity="app_user"))

    await client.post(f"{PREFIX}/auth/register", json=payload)
    await client.post(f"{PREFIX}/auth/register", json=payload)

    # Une seule ligne de plus : le doublon n'en écrit aucune.
    assert len(await journal(conn, entity="app_user")) == avant + 1


# --------------------------------------------------------------------------
# immuabilité
# --------------------------------------------------------------------------


@pytest.mark.parametrize("operation", ["update", "delete"])
async def test_une_ligne_ecrite_ne_peut_plus_bouger(
    client: AsyncClient, conn: AsyncConnection, operation: str
) -> None:
    jetons = await register_and_login(client)
    ligne = (await journal(conn, entity="app_user", entity_id=uuid.UUID(jetons["user_id"])))[0]

    statements = {
        "update": sa.update(AuditLog).where(AuditLog.id == ligne.id).values(to_status="suspended"),
        "delete": sa.delete(AuditLog).where(AuditLog.id == ligne.id),
    }

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(statements[operation])

    assert "audit_log est immuable" in str(excinfo.value)


# --------------------------------------------------------------------------
# cohérence de l'acteur
# --------------------------------------------------------------------------


async def test_une_transition_systeme_doit_dire_pourquoi(session: AsyncSession) -> None:
    """Une décision automatique muette est indéfendable trois mois plus tard."""
    with pytest.raises(ValueError, match="pourquoi"):
        await audit_service.record_transition(
            session,
            entity=audit_service.AuditedEntity.APP_USER,
            entity_id=uuid.uuid4(),
            to_status="suspended",
            actor=audit_service.Actor.system(),
        )


async def test_un_acteur_systeme_avec_un_utilisateur_est_refuse_en_base(
    conn: AsyncConnection,
) -> None:
    user_id = await new_user(conn)

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.insert(AuditLog).values(
                    entity_type="app_user",
                    entity_id=user_id,
                    to_status="suspended",
                    actor_kind=ActorKind.SYSTEM,
                    actor_user_id=user_id,
                    reason="incoherent",
                )
            )

    assert excinfo.value.orig.diag.constraint_name == "ck_audit_log_system_actor_has_no_user"


async def test_un_acteur_humain_sans_utilisateur_est_refuse_en_base(
    conn: AsyncConnection,
) -> None:
    """Un acteur humain anonyme est un acteur dont on ne saura jamais qui il était."""
    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.insert(AuditLog).values(
                    entity_type="app_user",
                    entity_id=uuid.uuid4(),
                    to_status="suspended",
                    actor_kind=ActorKind.ADMIN,
                    actor_user_id=None,
                )
            )

    assert excinfo.value.orig.diag.constraint_name == "ck_audit_log_system_actor_has_no_user"


@pytest.mark.parametrize(
    ("role", "attendu"),
    [
        (UserRole.CREATOR, ActorKind.CREATOR),
        (UserRole.BUSINESS_MEMBER, ActorKind.BUSINESS_MEMBER),
        (UserRole.ADMIN, ActorKind.ADMIN),
    ],
)
async def test_le_role_determine_la_nature_de_l_acteur(
    client: AsyncClient, conn: AsyncConnection, role: UserRole, attendu: ActorKind
) -> None:
    jetons = await register_and_login(client, role=role)

    # **Sa propre ligne, pas la première de la table.** Trois rôles, trois
    # comptes : lire la première rendait celle du cas précédent, et le
    # paramétrage passait par accident tant que l'ordre était garanti.
    ligne = (await journal(conn, entity="app_user", entity_id=uuid.UUID(jetons["user_id"])))[0]
    assert ligne.actor_kind == attendu
