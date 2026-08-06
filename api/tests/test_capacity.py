"""Règles de capacité et disponibilité temps réel.

Les horaires sont des heures locales du commerce, jamais des instants : ils sont
stockés tels qu'ils sont saisis. La conversion appartient au calcul de
disponibilité, en phase 5.
"""

import uuid
from datetime import date, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.models import AuditLog, Booking, CapacityRule
from app.models.enums import ActorKind, UserRole
from tests.factories import new_creator, new_social_account, new_tier, new_tier_offer

PREFIX = get_settings().api_v1_prefix

MIAMI = {"longitude": -80.1918, "latitude": 25.7617}
MARDI = 1


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
        f"{PREFIX}/business/{business_id}/catalog-items", json=payload, headers=membre["headers"]
    )
    assert response.status_code == 201, response.text
    return response.json()


async def plage(client: AsyncClient, membre: dict, business_id: str, **overrides) -> dict:
    payload = {
        "weekday": MARDI,
        "start_time": "09:00:00",
        "end_time": "12:00:00",
        "concurrent_slots": 3,
    } | overrides
    response = await client.post(
        f"{PREFIX}/business/{business_id}/capacity-rules", json=payload, headers=membre["headers"]
    )
    return response


# --------------------------------------------------------------------------
# plages hebdomadaires
# --------------------------------------------------------------------------


async def test_plusieurs_plages_le_meme_jour_sont_permises(client: AsyncClient) -> None:
    """Un commerce ferme le midi."""
    membre = await compte(client)
    business_id = await commerce(client, membre)

    matin = await plage(client, membre, business_id)
    apres_midi = await plage(
        client, membre, business_id, start_time="14:00:00", end_time="18:00:00"
    )

    assert matin.status_code == 201
    assert apres_midi.status_code == 201


async def test_deux_plages_qui_se_touchent_ne_se_chevauchent_pas(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    await plage(client, membre, business_id)

    accolee = await plage(client, membre, business_id, start_time="12:00:00", end_time="18:00:00")

    assert accolee.status_code == 201


@pytest.mark.parametrize(
    ("debut", "fin"),
    [
        ("11:00:00", "15:00:00"),  # chevauche la fin
        ("08:00:00", "10:00:00"),  # chevauche le début
        ("10:00:00", "11:00:00"),  # entièrement dedans
        ("08:00:00", "13:00:00"),  # englobe
        ("09:00:00", "12:00:00"),  # identique
    ],
)
async def test_le_chevauchement_sur_un_meme_jour_est_refuse(
    client: AsyncClient, debut: str, fin: str
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    await plage(client, membre, business_id)

    response = await plage(client, membre, business_id, start_time=debut, end_time=fin)

    assert response.status_code == 409
    assert response.json()["detail"] == "capacity_rule_overlap"


async def test_la_meme_plage_un_autre_jour_est_permise(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    await plage(client, membre, business_id)

    autre_jour = await plage(client, membre, business_id, weekday=MARDI + 1)

    assert autre_jour.status_code == 201


async def test_la_meme_plage_chez_un_autre_commerce_est_permise(client: AsyncClient) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    business_a = await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    await plage(client, membre_a, business_a)

    chez_b = await plage(client, membre_b, business_b)

    assert chez_b.status_code == 201


async def test_une_plage_deplacee_sur_une_autre_ne_passe_pas(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    matin = (await plage(client, membre, business_id)).json()
    await plage(client, membre, business_id, start_time="14:00:00", end_time="18:00:00")

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/capacity-rules/{matin['id']}",
        json={"start_time": "13:00:00", "end_time": "16:00:00"},
        headers=membre["headers"],
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "capacity_rule_overlap"


async def test_une_plage_qui_ne_bouge_pas_ne_se_chevauche_pas_elle_meme(
    client: AsyncClient,
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    matin = (await plage(client, membre, business_id)).json()

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/capacity-rules/{matin['id']}",
        json={"concurrent_slots": 5},
        headers=membre["headers"],
    )

    assert response.status_code == 200
    assert response.json()["concurrent_slots"] == 5


@pytest.mark.parametrize(
    "payload",
    [
        {"weekday": 7, "start_time": "09:00:00", "end_time": "12:00:00", "concurrent_slots": 3},
        {"weekday": -1, "start_time": "09:00:00", "end_time": "12:00:00", "concurrent_slots": 3},
        {"weekday": 1, "start_time": "18:00:00", "end_time": "09:00:00", "concurrent_slots": 3},
        {"weekday": 1, "start_time": "09:00:00", "end_time": "09:00:00", "concurrent_slots": 3},
        {"weekday": 1, "start_time": "09:00:00", "end_time": "12:00:00", "concurrent_slots": 0},
    ],
)
async def test_une_plage_invalide_est_refusee(client: AsyncClient, payload: dict) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)

    response = await client.post(
        f"{PREFIX}/business/{business_id}/capacity-rules",
        json=payload,
        headers=membre["headers"],
    )
    assert response.status_code == 422, f"{payload} aurait dû être refusé"


async def test_les_horaires_sont_stockes_tels_quels(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Une heure d'ouverture est une heure locale, pas un instant : aucune conversion."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    creee = (await plage(client, membre, business_id)).json()

    stocke = (
        await conn.execute(
            sa.select(CapacityRule.start_time, CapacityRule.end_time).where(
                CapacityRule.id == uuid.UUID(creee["id"])
            )
        )
    ).one()

    assert str(stocke.start_time) == "09:00:00"
    assert str(stocke.end_time) == "12:00:00"


async def test_supprimer_une_plage_ne_touche_pas_les_reservations(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """On ne déplace ni n'annule rien : la phase 5 décidera quoi montrer au commerce."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    creee = (await plage(client, membre, business_id)).json()

    creator_id = await new_creator(conn)
    social_account_id = await new_social_account(conn, creator_id)
    tier_id = await new_tier(conn)
    tier_offer_id = await new_tier_offer(
        conn, uuid.UUID(business_id), tier_id, uuid.UUID(cree["id"])
    )
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    booking_id = (
        await conn.execute(
            sa.insert(Booking)
            .values(
                creator_id=creator_id,
                business_id=uuid.UUID(business_id),
                tier_offer_id=tier_offer_id,
                catalog_item_id=uuid.UUID(cree["id"]),
                social_account_id=social_account_id,
                requires_booking=True,
                duration_minutes=60,
                starts_at=now + timedelta(days=1),
                ends_at=now + timedelta(days=1, hours=1),
                valid_until=now + timedelta(days=7),
                status="confirmed",
                value_cents_snapshot=8000,
            )
            .returning(Booking.id)
        )
    ).scalar_one()

    response = await client.delete(
        f"{PREFIX}/business/{business_id}/capacity-rules/{creee['id']}",
        headers=membre["headers"],
    )

    assert response.status_code == 204
    intacte = await conn.scalar(sa.select(Booking.starts_at).where(Booking.id == booking_id))
    assert intacte is not None


# --------------------------------------------------------------------------
# exceptions ponctuelles
# --------------------------------------------------------------------------


async def test_une_exception_sans_horaires_est_une_fermeture(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)

    response = await client.post(
        f"{PREFIX}/business/{business_id}/capacity-exceptions",
        json={"date": str(date(2026, 12, 25))},
        headers=membre["headers"],
    )

    assert response.status_code == 201
    corps = response.json()
    assert corps["is_closed"] is True
    assert corps["start_time"] is None
    assert corps["concurrent_slots"] is None


async def test_une_exception_avec_horaires_remplace_la_journee(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)

    response = await client.post(
        f"{PREFIX}/business/{business_id}/capacity-exceptions",
        json={
            "date": str(date(2026, 12, 24)),
            "start_time": "09:00:00",
            "end_time": "13:00:00",
            "concurrent_slots": 1,
        },
        headers=membre["headers"],
    )

    assert response.status_code == 201
    corps = response.json()
    assert corps["is_closed"] is False
    assert corps["start_time"] == "09:00:00"
    assert corps["concurrent_slots"] == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"date": "2026-12-25", "start_time": "09:00:00"},
        {"date": "2026-12-25", "end_time": "13:00:00"},
        {"date": "2026-12-25", "concurrent_slots": 2},
        {
            "date": "2026-12-25",
            "start_time": "13:00:00",
            "end_time": "09:00:00",
            "concurrent_slots": 2,
        },
        {"date": "2026-12-25", "start_time": "09:00:00", "end_time": "13:00:00"},
    ],
)
async def test_une_exception_incoherente_est_refusee(client: AsyncClient, payload: dict) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)

    response = await client.post(
        f"{PREFIX}/business/{business_id}/capacity-exceptions",
        json=payload,
        headers=membre["headers"],
    )
    assert response.status_code == 422, f"{payload} aurait dû être refusé"


async def test_deux_exceptions_le_meme_jour_sont_refusees(client: AsyncClient) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    payload = {"date": str(date(2026, 12, 25))}
    await client.post(
        f"{PREFIX}/business/{business_id}/capacity-exceptions",
        json=payload,
        headers=membre["headers"],
    )

    doublon = await client.post(
        f"{PREFIX}/business/{business_id}/capacity-exceptions",
        json=payload,
        headers=membre["headers"],
    )

    assert doublon.status_code == 409
    assert doublon.json()["detail"] == "capacity_exception_duplicate_date"

    autre_date = await client.post(
        f"{PREFIX}/business/{business_id}/capacity-exceptions",
        json={"date": str(date(2026, 12, 26))},
        headers=membre["headers"],
    )
    assert autre_date.status_code == 201


# --------------------------------------------------------------------------
# disponibilité temps réel
# --------------------------------------------------------------------------


async def test_desactiver_un_parent_rend_ses_variantes_indisponibles(
    client: AsyncClient,
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

    bascule = await client.put(
        f"{PREFIX}/business/{business_id}/catalog-items/{parent['id']}/availability",
        json={"is_available": False},
        headers=membre["headers"],
    )
    assert bascule.status_code == 204

    relue = (
        await client.get(
            f"{PREFIX}/business/{business_id}/catalog-items/{variante['id']}",
            headers=membre["headers"],
        )
    ).json()

    assert relue["is_effectively_available"] is False
    assert relue["is_available"] is True, "l'interrupteur de la variante n'a pas bougé"


async def test_la_desactivation_ecrit_sa_ligne_de_journal(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)

    await client.put(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}/availability",
        json={"is_available": False},
        headers=membre["headers"],
    )

    ligne = (
        await conn.execute(
            sa.select(AuditLog.__table__).where(AuditLog.entity_type == "catalog_item")
        )
    ).one()
    assert ligne.entity_id == uuid.UUID(cree["id"])
    assert ligne.from_status == "available"
    assert ligne.to_status == "unavailable"
    assert ligne.actor_kind == ActorKind.BUSINESS_MEMBER
    assert ligne.actor_user_id == uuid.UUID(membre["user_id"])


async def test_la_reactivation_ecrit_aussi_sa_ligne(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    chemin = f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}/availability"

    await client.put(chemin, json={"is_available": False}, headers=membre["headers"])
    await client.put(chemin, json={"is_available": True}, headers=membre["headers"])

    lignes = (
        await conn.execute(
            sa.select(AuditLog.__table__)
            .where(AuditLog.entity_type == "catalog_item")
            .order_by(AuditLog.occurred_at)
        )
    ).all()
    assert [ligne.to_status for ligne in lignes] == ["unavailable", "available"]


async def test_rebasculer_sur_la_meme_valeur_n_ecrit_rien(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Une transition qui n'en est pas une ne laisse pas de trace."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    chemin = f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}/availability"

    await client.put(chemin, json={"is_available": False}, headers=membre["headers"])
    await client.put(chemin, json={"is_available": False}, headers=membre["headers"])

    combien = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(AuditLog)
        .where(AuditLog.entity_type == "catalog_item")
    )
    assert combien == 1


async def test_la_disponibilite_ne_passe_plus_par_la_mise_a_jour_generale(
    client: AsyncClient,
) -> None:
    """Deux chemins pour la même transition finiraient par diverger sur le journal."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)

    response = await client.patch(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}",
        json={"is_available": False},
        headers=membre["headers"],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "validation_failed"


# --------------------------------------------------------------------------
# isolation entre commerces
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("verbe", "suffixe"),
    [
        ("get", "/capacity-rules"),
        ("post", "/capacity-rules"),
        ("get", "/capacity-exceptions"),
        ("post", "/capacity-exceptions"),
    ],
)
async def test_un_membre_de_a_n_atteint_pas_la_capacite_de_b(
    client: AsyncClient, verbe: str, suffixe: str
) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")

    appel = getattr(client, verbe)
    chemin = f"{PREFIX}/business/{business_b}{suffixe}"
    response = (
        await appel(chemin, json={}, headers=membre_a["headers"])
        if verbe == "post"
        else await appel(chemin, headers=membre_a["headers"])
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "not_a_member"


@pytest.mark.parametrize("verbe", ["patch", "delete"])
async def test_un_membre_de_a_ne_modifie_pas_une_plage_de_b(
    client: AsyncClient, verbe: str
) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    plage_b = (await plage(client, membre_b, business_b)).json()

    chemin = f"{PREFIX}/business/{business_b}/capacity-rules/{plage_b['id']}"
    appel = getattr(client, verbe)
    response = (
        await appel(chemin, json={"concurrent_slots": 9}, headers=membre_a["headers"])
        if verbe == "patch"
        else await appel(chemin, headers=membre_a["headers"])
    )

    assert response.status_code == 403


async def test_un_membre_de_a_ne_bascule_pas_un_item_de_b(client: AsyncClient) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    item_b = await item(client, membre_b, business_b)

    response = await client.put(
        f"{PREFIX}/business/{business_b}/catalog-items/{item_b['id']}/availability",
        json={"is_available": False},
        headers=membre_a["headers"],
    )

    assert response.status_code == 403


async def test_une_plage_d_un_autre_commerce_est_absente_du_sien(client: AsyncClient) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    business_a = await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    plage_b = (await plage(client, membre_b, business_b)).json()

    response = await client.delete(
        f"{PREFIX}/business/{business_a}/capacity-rules/{plage_b['id']}",
        headers=membre_a["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "capacity_rule_not_found"
