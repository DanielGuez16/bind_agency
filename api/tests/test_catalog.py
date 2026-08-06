"""Catalogue en saisie manuelle.

Le cœur du sujet : ce qu'une réservation existante fige, et ce qu'elle laisse
libre. Le prix change sans contrainte parce que `value_cents_snapshot` fige la
valeur ; la nature et la durée ne changent plus parce que rien ne les fige.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.models import Booking, CatalogItem
from app.models.enums import BookingStatus, UserRole
from tests.factories import new_creator, new_social_account, new_tier, new_tier_offer

PREFIX = get_settings().api_v1_prefix

MIAMI = {"longitude": -80.1918, "latitude": 25.7617}


async def compte(client: AsyncClient, role: UserRole = UserRole.BUSINESS_MEMBER) -> dict:
    email = f"{uuid.uuid4()}@example.com"
    password = "un-mot-de-passe-solide-42"
    created = await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": role.value},
    )
    assert created.status_code == 201, created.text
    tokens = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    return {
        "user_id": created.json()["id"],
        "headers": {"Authorization": f"Bearer {tokens['access_token']}"},
    }


async def commerce(client: AsyncClient, membre: dict, nom: str = "Salon Ocean") -> str:
    response = await client.post(
        f"{PREFIX}/business",
        json={
            "name": nom,
            "category": "beauty",
            "currency": "usd",
            "address": "100 Ocean Drive, Miami, FL",
            "coordinates": MIAMI,
        },
        headers=membre["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def item(client: AsyncClient, membre: dict, business_id: str, **overrides) -> dict:
    payload = {
        "name": "Soin visage",
        "price_cents": 8000,
        "duration_minutes": 60,
        "requires_booking": True,
    } | overrides
    response = await client.post(
        f"{PREFIX}/business/{business_id}/catalog-items",
        json=payload,
        headers=membre["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()


async def reserve(conn: AsyncConnection, business_id: str, item_id: str) -> uuid.UUID:
    """Pose une vraie réservation sur l'item, avec tout ce que la base exige."""
    creator_id = await new_creator(conn)
    social_account_id = await new_social_account(conn, creator_id)
    tier_id = await new_tier(conn)
    tier_offer_id = await new_tier_offer(conn, uuid.UUID(business_id), tier_id, uuid.UUID(item_id))
    now = datetime.now(UTC)

    return (
        await conn.execute(
            sa.insert(Booking)
            .values(
                creator_id=creator_id,
                business_id=uuid.UUID(business_id),
                tier_offer_id=tier_offer_id,
                catalog_item_id=uuid.UUID(item_id),
                social_account_id=social_account_id,
                requires_booking=True,
                starts_at=now + timedelta(days=1),
                ends_at=now + timedelta(days=1, hours=1),
                valid_until=now + timedelta(days=7),
                status=BookingStatus.CONFIRMED,
                value_cents_snapshot=8000,
            )
            .returning(Booking.id)
        )
    ).scalar_one()


# --------------------------------------------------------------------------
# ce qu'une réservation fige
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "modification",
    [
        {"requires_booking": False, "duration_minutes": None},
        {"duration_minutes": 90},
    ],
    ids=["nature", "duree"],
)
async def test_un_item_reserve_ne_change_ni_de_nature_ni_de_duree(
    client: AsyncClient, conn: AsyncConnection, modification: dict
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    await reserve(conn, business_id, cree["id"])

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        json=modification,
        headers=membre["headers"],
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "catalog_item_locked_by_bookings"
    assert "violates" not in response.text, "aucune violation brute ne doit remonter"
    assert "constraint" not in response.text


async def test_la_bascule_inverse_est_refusee_aussi(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    sans_reservation = await item(
        client, membre, business_id, requires_booking=False, duration_minutes=None
    )

    # Une réservation sur un item sans créneau : pas de starts_at, pas de ends_at.
    creator_id = await new_creator(conn)
    social_account_id = await new_social_account(conn, creator_id)
    tier_id = await new_tier(conn)
    tier_offer_id = await new_tier_offer(
        conn, uuid.UUID(business_id), tier_id, uuid.UUID(sans_reservation["id"])
    )
    await conn.execute(
        sa.insert(Booking).values(
            creator_id=creator_id,
            business_id=uuid.UUID(business_id),
            tier_offer_id=tier_offer_id,
            catalog_item_id=uuid.UUID(sans_reservation["id"]),
            social_account_id=social_account_id,
            requires_booking=False,
            valid_until=datetime.now(UTC) + timedelta(days=7),
            status=BookingStatus.CONFIRMED,
            value_cents_snapshot=2000,
        )
    )

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{sans_reservation['id']}",
        json={"requires_booking": True, "duration_minutes": 45},
        headers=membre["headers"],
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "catalog_item_locked_by_bookings"


@pytest.mark.parametrize(
    "modification",
    [
        {"requires_booking": False, "duration_minutes": None},
        {"duration_minutes": 90},
    ],
    ids=["nature", "duree"],
)
async def test_les_memes_bascules_passent_sans_reservation(
    client: AsyncClient, modification: dict
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        json=modification,
        headers=membre["headers"],
    )

    assert response.status_code == 200, response.text
    for champ, valeur in modification.items():
        assert response.json()[champ] == valeur


# --------------------------------------------------------------------------
# ce qu'une réservation laisse libre
# --------------------------------------------------------------------------


async def test_le_prix_reste_modifiable_et_la_reservation_garde_sa_valeur(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """`value_cents_snapshot` existe exactement pour ça."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    booking_id = await reserve(conn, business_id, cree["id"])

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        json={"price_cents": 15000},
        headers=membre["headers"],
    )

    assert response.status_code == 200
    assert response.json()["price_cents"] == 15000

    fige = await conn.scalar(
        sa.select(Booking.value_cents_snapshot).where(Booking.id == booking_id)
    )
    assert fige == 8000, "l'historique ne bouge pas quand la carte change"


async def test_le_nom_et_la_disponibilite_restent_modifiables(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    await reserve(conn, business_id, cree["id"])

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        json={"name": "Soin visage premium", "is_available": False},
        headers=membre["headers"],
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Soin visage premium"
    assert response.json()["is_available"] is False


# --------------------------------------------------------------------------
# suppression
# --------------------------------------------------------------------------


async def test_un_item_reserve_ne_se_supprime_pas(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    await reserve(conn, business_id, cree["id"])

    response = await client.delete(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        headers=membre["headers"],
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "catalog_item_has_bookings"
    assert "violates" not in response.text


async def test_un_item_reserve_se_desactive(client: AsyncClient, conn: AsyncConnection) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    await reserve(conn, business_id, cree["id"])

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        json={"is_available": False},
        headers=membre["headers"],
    )

    assert response.status_code == 200
    assert response.json()["is_effectively_available"] is False


async def test_un_item_sans_reservation_se_supprime(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)

    response = await client.delete(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        headers=membre["headers"],
    )

    assert response.status_code == 204
    reste = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(CatalogItem.id == uuid.UUID(cree["id"]))
    )
    assert reste == 0


async def test_supprimer_un_parent_dont_une_variante_est_reservee_est_refuse(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """La suppression du parent emporterait la variante, et sa réservation avec."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    parent = await item(
        client,
        membre,
        business_id,
        name="Coloration",
        requires_booking=False,
        duration_minutes=None,
    )
    variante = await item(
        client, membre, business_id, name="Coloration longue", parent_item_id=parent["id"]
    )
    await reserve(conn, business_id, variante["id"])

    response = await client.delete(
        f"{PREFIX}/business/{business_id}/catalog-items/{parent['id']}",
        headers=membre["headers"],
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "catalog_item_has_bookings"


# --------------------------------------------------------------------------
# variantes
# --------------------------------------------------------------------------


async def test_un_parent_n_est_pas_reservable(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    reservable = await item(client, membre, business_id)

    response = await client.post(
        f"{PREFIX}/business/{business_id}/catalog-items",
        json={
            "name": "Variante",
            "price_cents": 9000,
            "duration_minutes": 90,
            "parent_item_id": reservable["id"],
        },
        headers=membre["headers"],
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "catalog_parent_must_not_be_bookable"


async def test_un_item_avec_variantes_ne_devient_pas_reservable(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    parent = await item(
        client,
        membre,
        business_id,
        name="Coloration",
        requires_booking=False,
        duration_minutes=None,
    )
    await item(client, membre, business_id, name="Longue", parent_item_id=parent["id"])

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{parent['id']}",
        json={"requires_booking": True, "duration_minutes": 60},
        headers=membre["headers"],
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "catalog_parent_must_not_be_bookable"


async def test_pas_de_variante_de_variante(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    parent = await item(
        client,
        membre,
        business_id,
        name="Coloration",
        requires_booking=False,
        duration_minutes=None,
    )
    variante = await item(client, membre, business_id, name="Longue", parent_item_id=parent["id"])

    response = await client.post(
        f"{PREFIX}/business/{business_id}/catalog-items",
        json={
            "name": "Encore plus longue",
            "price_cents": 9000,
            "duration_minutes": 120,
            "parent_item_id": variante["id"],
        },
        headers=membre["headers"],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "catalog_variant_depth_exceeded"


async def test_un_parent_d_un_autre_commerce_est_refuse(client: AsyncClient) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    business_a = await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    parent_b = await item(
        client, membre_b, business_b, requires_booking=False, duration_minutes=None
    )

    response = await client.post(
        f"{PREFIX}/business/{business_a}/catalog-items",
        json={
            "name": "Variante volée",
            "price_cents": 9000,
            "duration_minutes": 90,
            "parent_item_id": parent_b["id"],
        },
        headers=membre_a["headers"],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "catalog_parent_not_found"


# --------------------------------------------------------------------------
# disponibilité calculée
# --------------------------------------------------------------------------


async def test_un_parent_desactive_rend_ses_variantes_indisponibles(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    parent = await item(
        client,
        membre,
        business_id,
        name="Coloration",
        requires_booking=False,
        duration_minutes=None,
    )
    variante = await item(client, membre, business_id, name="Longue", parent_item_id=parent["id"])
    assert variante["is_effectively_available"] is True

    await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{parent['id']}",
        json={"is_available": False},
        headers=membre["headers"],
    )

    relu = await client.get(
        f"{PREFIX}/business/{business_id}/catalog-items/{variante['id']}",
        headers=membre["headers"],
    )
    corps = relu.json()
    assert corps["is_effectively_available"] is False
    assert corps["is_available"] is True, "l'interrupteur propre de la variante n'a pas bougé"

    # L'état n'est pas recopié en base : il est calculé.
    stocke = await conn.scalar(
        sa.select(CatalogItem.is_available).where(CatalogItem.id == uuid.UUID(variante["id"]))
    )
    assert stocke is True


async def test_la_liste_calcule_la_disponibilite_de_chaque_ligne(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    parent = await item(
        client,
        membre,
        business_id,
        name="Coloration",
        requires_booking=False,
        duration_minutes=None,
        is_available=False,
    )
    await item(client, membre, business_id, name="Longue", parent_item_id=parent["id"])
    await item(client, membre, business_id, name="Soin autonome")

    response = await client.get(
        f"{PREFIX}/business/{business_id}/catalog-items", headers=membre["headers"]
    )

    assert response.status_code == 200
    par_nom = {ligne["name"]: ligne for ligne in response.json()}
    assert par_nom["Longue"]["is_effectively_available"] is False
    assert par_nom["Longue"]["is_available"] is True
    assert par_nom["Soin autonome"]["is_effectively_available"] is True


# --------------------------------------------------------------------------
# validation et isolation
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "Sans durée", "price_cents": 8000, "requires_booking": True},
        {
            "name": "Durée inutile",
            "price_cents": 8000,
            "requires_booking": False,
            "duration_minutes": 60,
        },
        {"name": "Durée nulle", "price_cents": 8000, "duration_minutes": 0},
        {"name": "Prix négatif", "price_cents": -1, "duration_minutes": 60},
        {"name": "", "price_cents": 8000, "duration_minutes": 60},
    ],
)
async def test_les_saisies_invalides_sont_refusees(client: AsyncClient, payload: dict) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)

    response = await client.post(
        f"{PREFIX}/business/{business_id}/catalog-items",
        json=payload,
        headers=membre["headers"],
    )

    assert response.status_code == 422, f"{payload} aurait dû être refusé"


async def test_un_item_reservable_sans_duree_est_refuse_avec_un_message_utile(
    client: AsyncClient,
) -> None:
    """Le CHECK en base existe, mais il ne dit rien d'exploitable à l'appelant."""
    membre = await compte(client)
    business_id = await commerce(client, membre)

    response = await client.post(
        f"{PREFIX}/business/{business_id}/catalog-items",
        json={"name": "Soin", "price_cents": 8000, "requires_booking": True},
        headers=membre["headers"],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "catalog_duration_mismatch"
    assert "constraint" not in response.text


async def test_une_bascule_partielle_incoherente_est_refusee(client: AsyncClient) -> None:
    """Rendre un item non réservable sans retirer sa durée : aucun champ envoyé n'est
    invalide, seul l'état résultant l'est."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        json={"requires_booking": False},
        headers=membre["headers"],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "catalog_duration_mismatch"


@pytest.mark.parametrize("verbe", ["get", "patch", "delete"])
async def test_un_membre_du_commerce_a_n_atteint_pas_le_catalogue_de_b(
    client: AsyncClient, verbe: str
) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    item_b = await item(client, membre_b, business_b)

    chemin = f"{PREFIX}/business/{business_b}/catalog-items/{item_b['id']}"
    appel = getattr(client, verbe)
    response = (
        await appel(chemin, json={"name": "Volé"}, headers=membre_a["headers"])
        if verbe == "patch"
        else await appel(chemin, headers=membre_a["headers"])
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "not_a_member"


async def test_un_item_d_un_autre_commerce_est_absent_du_sien(client: AsyncClient) -> None:
    """404 et non 403 : l'appelant est chez lui, l'item n'y est simplement pas."""
    membre_a = await compte(client)
    membre_b = await compte(client)
    business_a = await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    item_b = await item(client, membre_b, business_b)

    response = await client.get(
        f"{PREFIX}/business/{business_a}/catalog-items/{item_b['id']}",
        headers=membre_a["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "catalog_item_not_found"


async def test_la_liste_ne_montre_que_le_catalogue_du_commerce(client: AsyncClient) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    business_a = await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    await item(client, membre_a, business_a, name="Chez A")
    await item(client, membre_b, business_b, name="Chez B")

    response = await client.get(
        f"{PREFIX}/business/{business_a}/catalog-items", headers=membre_a["headers"]
    )

    noms = {ligne["name"] for ligne in response.json()}
    assert noms == {"Chez A"}
