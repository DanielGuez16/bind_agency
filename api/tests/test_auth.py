"""Authentification, jetons et protection des routes par rôle.

Le point le plus surveillé ici n'est pas la connexion mais l'isolation entre
commerces : un membre du commerce A ne doit rien pouvoir lire du commerce B,
même avec le bon rôle et un jeton parfaitement valide.
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.core.security import TokenType, create_token
from app.models import BusinessMember, RefreshToken, User
from app.models.enums import BusinessMemberRole, UserRole, UserStatus
from app.schemas.auth import PASSWORD_MAX_LENGTH
from tests.factories import PASSWORD, new_business, new_user

PREFIX = get_settings().api_v1_prefix


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register_and_login(
    client: AsyncClient, *, role: UserRole = UserRole.CREATOR, email: str | None = None
) -> dict:
    email = email or f"{uuid.uuid4()}@example.com"
    password = "tourbillon-cactus-91-vermeil"

    created = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": role.value, "date_of_birth": "1992-04-17"},
    )
    assert created.status_code == 201, created.text

    logged = await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    assert logged.status_code == 200, logged.text

    return {"user_id": created.json()["id"], "email": email, "password": password} | logged.json()


# --------------------------------------------------------------------------
# inscription
# --------------------------------------------------------------------------


async def test_inscription_stocke_une_empreinte_argon2id_et_jamais_le_mot_de_passe(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    email = "createur@example.com"
    password = "tourbillon-cactus-91-vermeil"

    response = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.CREATOR.value, "date_of_birth": "1992-04-17"},
    )

    assert response.status_code == 201
    assert "password" not in response.text

    stored = await conn.scalar(sa.select(User.password_hash).where(User.email == email))
    assert stored.startswith("$argon2id$")
    assert password not in stored


async def test_inscription_refuse_une_adresse_deja_prise_meme_casse_differente(
    client: AsyncClient,
) -> None:
    payload = {
        "email": "Rebecca@Example.com",
        "password": "tourbillon-cactus-91-vermeil",
        "role": UserRole.ADMIN.value,
    }
    first = await client.post(f"{PREFIX}/auth/register", json=payload)
    assert first.status_code == 201

    second = await client.post(
        f"{PREFIX}/auth/register", json={**payload, "email": "rebecca@example.com"}
    )

    assert second.status_code == 409
    assert second.json()["detail"] == "email_already_used"

    # `register` fait un `rollback` explicite sur violation : la session doit
    # rester utilisable pour l'inscription suivante.
    troisieme = await client.post(
        f"{PREFIX}/auth/register", json={**payload, "email": "autre@example.com"}
    )
    assert troisieme.status_code == 201


async def test_inscription_refuse_un_mot_de_passe_trop_court(client: AsyncClient) -> None:
    response = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": "court@example.com", "password": "court", "role": UserRole.CREATOR.value, "date_of_birth": "1992-04-17"},
    )
    assert response.status_code == 422


async def test_inscription_refuse_un_mot_de_passe_demesure(client: AsyncClient) -> None:
    """La borne haute protège du déni de service par hachage d'une entrée énorme."""
    response = await client.post(
        f"{PREFIX}/auth/register",
        json={
            "email": "enorme@example.com",
            "password": "a" * (PASSWORD_MAX_LENGTH + 1),
            "role": UserRole.CREATOR.value,
        },
    )
    assert response.status_code == 422


async def test_connexion_refuse_un_mot_de_passe_demesure(client: AsyncClient) -> None:
    """La même borne doit exister à la connexion : c'est la route non authentifiée."""
    tokens = await register_and_login(client)

    response = await client.post(
        f"{PREFIX}/auth/login",
        json={"email": tokens["email"], "password": "a" * (PASSWORD_MAX_LENGTH + 1)},
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# connexion
# --------------------------------------------------------------------------


async def test_connexion_renvoie_une_paire_de_jetons(client: AsyncClient) -> None:
    tokens = await register_and_login(client)

    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == get_settings().access_token_ttl_seconds
    assert tokens["access_token"] != tokens["refresh_token"]


@pytest.mark.parametrize("mauvais_mot_de_passe", ["mauvais-mot-de-passe-999", ""])
async def test_connexion_refusee_avec_un_mauvais_mot_de_passe(
    client: AsyncClient, mauvais_mot_de_passe: str
) -> None:
    tokens = await register_and_login(client)

    response = await client.post(
        f"{PREFIX}/auth/login",
        json={"email": tokens["email"], "password": mauvais_mot_de_passe},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_credentials"


async def test_connexion_refusee_pour_une_adresse_inconnue(client: AsyncClient) -> None:
    response = await client.post(
        f"{PREFIX}/auth/login",
        json={"email": "personne@example.com", "password": "tourbillon-cactus-91-vermeil"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_credentials"


@pytest.mark.parametrize("statut", [UserStatus.SUSPENDED, UserStatus.ANONYMIZED])
async def test_connexion_refusee_pour_un_compte_ferme(
    client: AsyncClient, conn: AsyncConnection, statut: UserStatus
) -> None:
    """Identifiants bons mais compte fermé : 403, réessayer n'y changera rien."""
    tokens = await register_and_login(client)
    # L'email et l'empreinte sont conservés : c'est bien le statut qu'on teste,
    # pas l'absence d'identifiants.
    await conn.execute(sa.update(User).where(User.email == tokens["email"]).values(status=statut))

    response = await client.post(
        f"{PREFIX}/auth/login", json={"email": tokens["email"], "password": tokens["password"]}
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "account_not_active"


# --------------------------------------------------------------------------
# jetons d'accès
# --------------------------------------------------------------------------


async def test_route_protegee_accessible_avec_un_jeton_valide(client: AsyncClient) -> None:
    tokens = await register_and_login(client)

    response = await client.get(
        f"{PREFIX}/probe/any-authenticated", headers=auth_header(tokens["access_token"])
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == tokens["user_id"]


async def test_route_protegee_refusee_sans_jeton(client: AsyncClient) -> None:
    response = await client.get(f"{PREFIX}/probe/any-authenticated")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


async def test_jeton_expire_est_refuse(client: AsyncClient) -> None:
    tokens = await register_and_login(client)

    expire = create_token(
        subject=uuid.UUID(tokens["user_id"]),
        token_type=TokenType.ACCESS,
        token_id=uuid.uuid4(),
        lifetime=timedelta(seconds=-1),
    )

    response = await client.get(f"{PREFIX}/probe/any-authenticated", headers=auth_header(expire))
    assert response.status_code == 401


async def test_jeton_signe_avec_une_autre_cle_est_refuse(client: AsyncClient) -> None:
    tokens = await register_and_login(client)
    settings = get_settings()
    now = datetime.now(UTC)

    contrefait = jwt.encode(
        {
            "sub": tokens["user_id"],
            "typ": TokenType.ACCESS.value,
            "jti": str(uuid.uuid4()),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        },
        # Au moins 32 octets, sinon PyJWT avertit sur la longueur et le test
        # échouerait pour une raison qui n'est pas celle qu'on éprouve.
        "une-cle-qui-n-est-pas-la-notre-et-qui-fait-la-bonne-longueur",
        algorithm=settings.jwt_algorithm,
    )

    response = await client.get(
        f"{PREFIX}/probe/any-authenticated", headers=auth_header(contrefait)
    )
    assert response.status_code == 401


async def test_jeton_sans_claim_de_type_est_refuse(client: AsyncClient) -> None:
    """Complément du contrôle de type : un jeton correctement signé mais muet
    sur `typ` ne doit pas être accepté par défaut."""
    tokens = await register_and_login(client)
    settings = get_settings()
    now = datetime.now(UTC)

    sans_type = jwt.encode(
        {
            "sub": tokens["user_id"],
            "jti": str(uuid.uuid4()),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        },
        settings.jwt_secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )

    response = await client.get(f"{PREFIX}/probe/any-authenticated", headers=auth_header(sans_type))
    assert response.status_code == 401


async def test_jeton_de_rafraichissement_refuse_comme_jeton_d_acces(client: AsyncClient) -> None:
    """Sans contrôle de type, un jeton à trente jours ouvrirait les routes protégées."""
    tokens = await register_and_login(client)

    response = await client.get(
        f"{PREFIX}/probe/any-authenticated", headers=auth_header(tokens["refresh_token"])
    )
    assert response.status_code == 401


async def test_suspension_invalide_immediatement_un_jeton_deja_emis(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    tokens = await register_and_login(client)
    await conn.execute(
        sa.update(User).where(User.email == tokens["email"]).values(status=UserStatus.SUSPENDED)
    )

    response = await client.get(
        f"{PREFIX}/probe/any-authenticated", headers=auth_header(tokens["access_token"])
    )
    assert response.status_code == 401


# --------------------------------------------------------------------------
# rôles
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("route", "role", "attendu"),
    [
        ("creator-only", UserRole.CREATOR, 200),
        ("creator-only", UserRole.BUSINESS_MEMBER, 403),
        ("creator-only", UserRole.ADMIN, 403),
        ("admin-only", UserRole.ADMIN, 200),
        ("admin-only", UserRole.CREATOR, 403),
        ("admin-only", UserRole.BUSINESS_MEMBER, 403),
        ("staff-or-admin", UserRole.BUSINESS_MEMBER, 200),
        ("staff-or-admin", UserRole.ADMIN, 200),
        ("staff-or-admin", UserRole.CREATOR, 403),
    ],
)
async def test_chaque_role_sur_une_route_protegee(
    client: AsyncClient, route: str, role: UserRole, attendu: int
) -> None:
    tokens = await register_and_login(client, role=role)

    response = await client.get(
        f"{PREFIX}/probe/{route}", headers=auth_header(tokens["access_token"])
    )

    assert response.status_code == attendu, f"{role} sur {route} : {response.text}"
    if attendu == 403:
        assert response.json()["detail"] == "insufficient_role"


# --------------------------------------------------------------------------
# isolation entre commerces
# --------------------------------------------------------------------------


async def test_membre_accede_a_la_ressource_de_son_commerce(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    business_id = await new_business(conn)
    tokens = await register_and_login(client, role=UserRole.BUSINESS_MEMBER)
    await conn.execute(
        sa.insert(BusinessMember).values(
            business_id=business_id,
            user_id=uuid.UUID(tokens["user_id"]),
            role=BusinessMemberRole.OWNER,
        )
    )

    response = await client.get(
        f"{PREFIX}/probe/businesses/{business_id}/resource",
        headers=auth_header(tokens["access_token"]),
    )

    assert response.status_code == 200
    assert response.json()["business_id"] == str(business_id)


async def test_membre_du_commerce_a_ne_lit_pas_le_commerce_b(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """La fuite classique entre locataires : bon rôle, mauvais commerce."""
    business_a = await new_business(conn, name="Salon A")
    business_b = await new_business(conn, name="Salon B")

    tokens = await register_and_login(client, role=UserRole.BUSINESS_MEMBER)
    await conn.execute(
        sa.insert(BusinessMember).values(
            business_id=business_a,
            user_id=uuid.UUID(tokens["user_id"]),
            role=BusinessMemberRole.OWNER,
        )
    )

    response = await client.get(
        f"{PREFIX}/probe/businesses/{business_b}/resource",
        headers=auth_header(tokens["access_token"]),
    )

    assert response.status_code == 403, "un 404 masquerait un défaut d'autorisation"
    assert response.json()["detail"] == "not_a_member"


async def test_commerce_inexistant_repond_403_et_non_404(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Distinguer les deux cas dirait quels identifiants existent ailleurs."""
    business_a = await new_business(conn)
    tokens = await register_and_login(client, role=UserRole.BUSINESS_MEMBER)
    await conn.execute(
        sa.insert(BusinessMember).values(
            business_id=business_a,
            user_id=uuid.UUID(tokens["user_id"]),
            role=BusinessMemberRole.OWNER,
        )
    )

    response = await client.get(
        f"{PREFIX}/probe/businesses/{uuid.uuid4()}/resource",
        headers=auth_header(tokens["access_token"]),
    )
    assert response.status_code == 403


async def test_un_createur_n_atteint_pas_une_ressource_commerce(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    business_id = await new_business(conn)
    tokens = await register_and_login(client, role=UserRole.CREATOR)

    response = await client.get(
        f"{PREFIX}/probe/businesses/{business_id}/resource",
        headers=auth_header(tokens["access_token"]),
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "insufficient_role"


async def test_un_administrateur_n_est_pas_membre_d_office(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Aucune dérogation : une route d'administration se déclare comme telle."""
    business_id = await new_business(conn)
    tokens = await register_and_login(client, role=UserRole.ADMIN)

    response = await client.get(
        f"{PREFIX}/probe/businesses/{business_id}/resource",
        headers=auth_header(tokens["access_token"]),
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------
# rafraîchissement et révocation
# --------------------------------------------------------------------------


async def test_rafraichissement_renvoie_une_nouvelle_paire_et_invalide_l_ancienne(
    client: AsyncClient,
) -> None:
    tokens = await register_and_login(client)

    rotated = await client.post(
        f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert rotated.status_code == 200
    assert rotated.json()["refresh_token"] != tokens["refresh_token"]

    rejoue = await client.post(
        f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert rejoue.status_code == 401


async def test_le_rejeu_d_un_jeton_consomme_coupe_toutes_les_sessions(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    tokens = await register_and_login(client)
    rotated = (
        await client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    ).json()

    # Rejeu de l'ancien jeton : la session est considérée comme compromise.
    await client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})

    encore_valides = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(RefreshToken)
        .where(
            RefreshToken.user_id == uuid.UUID(tokens["user_id"]),
            RefreshToken.revoked_at.is_(None),
        )
    )
    assert encore_valides == 0

    apres = await client.post(
        f"{PREFIX}/auth/refresh", json={"refresh_token": rotated["refresh_token"]}
    )
    assert apres.status_code == 401


async def test_deconnexion_revoque_le_jeton_de_rafraichissement(client: AsyncClient) -> None:
    tokens = await register_and_login(client)

    logout = await client.post(
        f"{PREFIX}/auth/logout", json={"refresh_token": tokens["refresh_token"]}
    )
    assert logout.status_code == 204

    response = await client.post(
        f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_refresh_token"


async def test_rafraichissement_refuse_pour_un_jeton_inconnu(client: AsyncClient) -> None:
    tokens = await register_and_login(client)

    inconnu = create_token(
        subject=uuid.UUID(tokens["user_id"]),
        token_type=TokenType.REFRESH,
        token_id=uuid.uuid4(),
        lifetime=timedelta(days=30),
    )

    response = await client.post(f"{PREFIX}/auth/refresh", json={"refresh_token": inconnu})
    assert response.status_code == 401


async def test_rafraichissement_refuse_quand_la_ligne_est_expiree_en_base(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Le vrai chemin de révocation côté serveur.

    Le JWT reste parfaitement valide et non expiré : c'est `expires_at` en base
    qui tranche. Sans ce test, rien ne prouve que la liste d'autorisation fait
    autre chose que redire ce que le jeton dit déjà de lui-même.
    """
    tokens = await register_and_login(client)

    await conn.execute(
        sa.update(RefreshToken)
        .where(RefreshToken.user_id == uuid.UUID(tokens["user_id"]))
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )

    response = await client.post(
        f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_refresh_token"


async def test_rafraichissement_refuse_apres_suspension(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    tokens = await register_and_login(client)
    await conn.execute(
        sa.update(User).where(User.email == tokens["email"]).values(status=UserStatus.SUSPENDED)
    )

    response = await client.post(
        f"{PREFIX}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert response.status_code == 401


# --------------------------------------------------------------------------
# /me
# --------------------------------------------------------------------------


async def test_me_renvoie_le_compte_courant_sans_empreinte(client: AsyncClient) -> None:
    tokens = await register_and_login(client, role=UserRole.BUSINESS_MEMBER)

    response = await client.get(f"{PREFIX}/me", headers=auth_header(tokens["access_token"]))

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == tokens["email"]
    assert body["role"] == UserRole.BUSINESS_MEMBER.value
    assert "password_hash" not in body


async def test_me_refuse_un_jeton_designant_un_compte_inexistant(client: AsyncClient) -> None:
    """Le jeton est parfaitement signé, mais son sujet n'existe pas.

    Il n'est plus possible de supprimer un compte inscrit pour éprouver ce cas :
    sa ligne de journal d'inscription le retient. C'est la politique
    d'anonymisation qui s'applique, la suppression n'existe pas.
    """
    forge = create_token(
        subject=uuid.uuid4(),
        token_type=TokenType.ACCESS,
        token_id=uuid.uuid4(),
        lifetime=timedelta(hours=1),
    )

    response = await client.get(f"{PREFIX}/me", headers=auth_header(forge))
    assert response.status_code == 401


async def test_un_compte_inscrit_ne_peut_plus_etre_supprime(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Sa ligne de journal d'inscription le retient : effacer, c'est anonymiser."""
    tokens = await register_and_login(client)

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(sa.delete(User).where(User.email == tokens["email"]))

    assert excinfo.value.orig.diag.constraint_name == "fk_audit_log_actor_user_id_app_user"


async def test_un_compte_de_fabrique_peut_se_connecter(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Vérifie que l'empreinte partagée des fabriques est bien vérifiable."""
    email = "fabrique@example.com"
    await new_user(conn, email=email)

    response = await client.post(
        f"{PREFIX}/auth/login", json={"email": email, "password": PASSWORD}
    )
    assert response.status_code == 200
