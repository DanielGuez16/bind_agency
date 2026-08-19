"""Composition des offres par palier.

Le sujet est ce qu'une offre survit : un palier désactivé, un item désactivé,
une réservation. Rien de tout ça ne l'efface, elle cesse simplement d'être
proposée — et « proposée » est calculé, jamais recopié.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.models import AuditLog, Booking, Tier, TierOffer
from app.models.enums import ActorKind, BookingStatus, ContentFormat, Platform, UserRole
from tests.factories import new_creator, new_social_account

PREFIX = get_settings().api_v1_prefix
MIAMI = {"longitude": -80.1918, "latitude": 25.7617}


async def compte(client: AsyncClient, role: UserRole = UserRole.BUSINESS_MEMBER) -> dict:
    email = f"{uuid.uuid4()}@example.com"
    password = "tourbillon-cactus-91-vermeil"
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


async def palier(
    conn: AsyncConnection,
    platform: Platform = Platform.INSTAGRAM,
    format_: ContentFormat = ContentFormat.STORY,
) -> uuid.UUID:
    """Les paliers de référence viennent de la migration."""
    return await conn.scalar(
        sa.select(Tier.id).where(Tier.platform == platform, Tier.content_format == format_)
    )


async def offrir(
    client: AsyncClient, membre: dict, business_id: str, tier_id: uuid.UUID, item_id: str
):
    return await client.post(
        f"{PREFIX}/business/{business_id}/tier-offers",
        json={"tier_id": str(tier_id), "catalog_item_id": item_id},
        headers=membre["headers"],
    )


# --------------------------------------------------------------------------
# ce qui se compose et ce qui ne se compose pas
# --------------------------------------------------------------------------


async def test_une_variante_se_propose(client: AsyncClient, conn: AsyncConnection) -> None:
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

    response = await offrir(client, membre, business_id, await palier(conn), variante["id"])

    assert response.status_code == 201
    corps = response.json()
    assert corps["item_name"] == "Longue"
    assert corps["platform"] == Platform.INSTAGRAM.value
    assert corps["is_effectively_offered"] is True


async def test_un_parent_ne_se_propose_pas(client: AsyncClient, conn: AsyncConnection) -> None:
    """Suite directe de l'invariant de catalogue : c'est la variante qui se réserve."""
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

    response = await offrir(client, membre, business_id, await palier(conn), parent["id"])

    assert response.status_code == 409
    assert response.json()["detail"] == "tier_offer_parent_not_allowed"


async def test_un_item_non_reservable_se_propose(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """`requires_booking` ne conditionne rien ici."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    sans_creneau = await item(
        client,
        membre,
        business_id,
        name="Carte cadeau",
        requires_booking=False,
        duration_minutes=None,
    )

    response = await offrir(client, membre, business_id, await palier(conn), sans_creneau["id"])

    assert response.status_code == 201
    assert response.json()["is_effectively_offered"] is True


async def test_le_meme_item_se_place_a_plusieurs_paliers(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Un créateur éligible aux deux le verra deux fois. C'est au fil de trancher."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)

    story = await offrir(client, membre, business_id, await palier(conn), cree["id"])
    post = await offrir(
        client, membre, business_id, await palier(conn, format_=ContentFormat.POST), cree["id"]
    )

    assert story.status_code == 201
    assert post.status_code == 201
    assert story.json()["id"] != post.json()["id"]


async def test_le_meme_item_au_meme_palier_deux_fois_est_refuse(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    tier_id = await palier(conn)
    await offrir(client, membre, business_id, tier_id, cree["id"])

    doublon = await offrir(client, membre, business_id, tier_id, cree["id"])

    assert doublon.status_code == 409
    assert doublon.json()["detail"] == "tier_offer_already_exists"
    assert "violates" not in doublon.text

    # C'est ce refus-là qui avait révélé le défaut du `begin_nested` : le code
    # était bon, la session ne l'était plus.
    ailleurs = await offrir(
        client, membre, business_id, await palier(conn, format_=ContentFormat.POST), cree["id"]
    )
    assert ailleurs.status_code == 201


async def test_un_palier_inactif_est_refuse_a_la_creation(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    snapchat = await palier(conn, platform=Platform.SNAPCHAT)

    response = await offrir(client, membre, business_id, snapchat, cree["id"])

    assert response.status_code == 409
    assert response.json()["detail"] == "tier_offer_tier_inactive"


async def test_un_item_d_un_autre_commerce_est_refuse(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    business_a = await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    item_b = await item(client, membre_b, business_b)

    response = await offrir(client, membre_a, business_a, await palier(conn), item_b["id"])

    assert response.status_code == 404
    assert response.json()["detail"] == "tier_offer_not_found"


# --------------------------------------------------------------------------
# ce qu'une offre survit
# --------------------------------------------------------------------------


async def test_desactiver_le_palier_laisse_l_offre_en_base(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Deux règles différentes : refus à la création, tolérance après coup."""
    membre = await compte(client)
    admin = await compte(client, UserRole.ADMIN)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    tier_id = await palier(conn)
    offre = (await offrir(client, membre, business_id, tier_id, cree["id"])).json()

    bascule = await client.patch(
        f"{PREFIX}/admin/tiers/{tier_id}", json={"is_active": False}, headers=admin["headers"]
    )
    assert bascule.status_code == 200

    relue = (
        await client.get(f"{PREFIX}/business/{business_id}/tier-offers", headers=membre["headers"])
    ).json()

    assert len(relue) == 1
    assert relue[0]["id"] == offre["id"]
    assert relue[0]["is_active"] is True, "l'interrupteur de l'offre n'a pas bougé"
    assert relue[0]["is_effectively_offered"] is False


async def test_desactiver_l_item_laisse_l_offre_en_base(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    offre = (await offrir(client, membre, business_id, await palier(conn), cree["id"])).json()

    await client.put(
        f"{PREFIX}/business/{business_id}/catalog-items/{cree['id']}/availability",
        json={"is_available": False},
        headers=membre["headers"],
    )

    relue = (
        await client.get(f"{PREFIX}/business/{business_id}/tier-offers", headers=membre["headers"])
    ).json()

    assert len(relue) == 1
    assert relue[0]["id"] == offre["id"]
    assert relue[0]["is_effectively_offered"] is False


async def test_desactiver_le_parent_retire_l_offre_de_la_variante(
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
    await offrir(client, membre, business_id, await palier(conn), variante["id"])

    await client.put(
        f"{PREFIX}/business/{business_id}/catalog-items/{parent['id']}/availability",
        json={"is_available": False},
        headers=membre["headers"],
    )

    relue = (
        await client.get(f"{PREFIX}/business/{business_id}/tier-offers", headers=membre["headers"])
    ).json()
    assert relue[0]["is_effectively_offered"] is False


# --------------------------------------------------------------------------
# retrait
# --------------------------------------------------------------------------


async def _reserver(conn: AsyncConnection, business_id: str, offer_id: str, item_id: str) -> None:
    creator_id = await new_creator(conn)
    social_account_id = await new_social_account(conn, creator_id)
    now = datetime.now(UTC)
    await conn.execute(
        sa.insert(Booking).values(
            creator_id=creator_id,
            business_id=uuid.UUID(business_id),
            tier_offer_id=uuid.UUID(offer_id),
            catalog_item_id=uuid.UUID(item_id),
            social_account_id=social_account_id,
            requires_booking=True,
            duration_minutes=60,
            starts_at=now + timedelta(days=1),
            ends_at=now + timedelta(days=1, hours=1),
            valid_until=now + timedelta(days=7),
            status=BookingStatus.CONFIRMED,
            value_cents_snapshot=8000,
        )
    )


async def test_une_offre_libre_se_supprime(client: AsyncClient, conn: AsyncConnection) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    offre = (await offrir(client, membre, business_id, await palier(conn), cree["id"])).json()

    response = await client.delete(
        f"{PREFIX}/business/{business_id}/tier-offers/{offre['id']}", headers=membre["headers"]
    )

    assert response.status_code == 204
    reste = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(TierOffer)
        .where(TierOffer.id == uuid.UUID(offre["id"]))
    )
    assert reste == 0


async def test_une_offre_reservee_ne_se_supprime_pas(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    offre = (await offrir(client, membre, business_id, await palier(conn), cree["id"])).json()
    await _reserver(conn, business_id, offre["id"], cree["id"])

    response = await client.delete(
        f"{PREFIX}/business/{business_id}/tier-offers/{offre['id']}", headers=membre["headers"]
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "tier_offer_has_bookings"
    assert "violates" not in response.text
    assert "constraint" not in response.text

    apres = await client.get(
        f"{PREFIX}/business/{business_id}/tier-offers", headers=membre["headers"]
    )
    assert apres.status_code == 200
    assert len(apres.json()) == 1


async def test_une_offre_reservee_se_retire_par_desactivation(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    offre = (await offrir(client, membre, business_id, await palier(conn), cree["id"])).json()
    await _reserver(conn, business_id, offre["id"], cree["id"])

    response = await client.put(
        f"{PREFIX}/business/{business_id}/tier-offers/{offre['id']}/activation",
        json={"is_active": False},
        headers=membre["headers"],
    )

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert response.json()["is_effectively_offered"] is False


async def test_le_retrait_est_journalise(client: AsyncClient, conn: AsyncConnection) -> None:
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cree = await item(client, membre, business_id)
    offre = (await offrir(client, membre, business_id, await palier(conn), cree["id"])).json()

    await client.put(
        f"{PREFIX}/business/{business_id}/tier-offers/{offre['id']}/activation",
        json={"is_active": False},
        headers=membre["headers"],
    )

    ligne = (
        await conn.execute(
            sa.select(AuditLog.__table__).where(AuditLog.entity_type == "tier_offer")
        )
    ).one()
    assert ligne.entity_id == uuid.UUID(offre["id"])
    assert (ligne.from_status, ligne.to_status) == ("active", "inactive")
    assert ligne.actor_kind == ActorKind.BUSINESS_MEMBER


# --------------------------------------------------------------------------
# isolation entre commerces
# --------------------------------------------------------------------------


@pytest.mark.parametrize("verbe", ["get", "post"])
async def test_un_membre_de_a_n_atteint_pas_les_offres_de_b(
    client: AsyncClient, verbe: str
) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")

    chemin = f"{PREFIX}/business/{business_b}/tier-offers"
    appel = getattr(client, verbe)
    response = (
        await appel(chemin, json={}, headers=membre_a["headers"])
        if verbe == "post"
        else await appel(chemin, headers=membre_a["headers"])
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "not_a_member"


@pytest.mark.parametrize("verbe", ["put", "delete"])
async def test_un_membre_de_a_ne_retire_pas_une_offre_de_b(
    client: AsyncClient, conn: AsyncConnection, verbe: str
) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    item_b = await item(client, membre_b, business_b)
    offre_b = (await offrir(client, membre_b, business_b, await palier(conn), item_b["id"])).json()

    appel = getattr(client, verbe)
    chemin = f"{PREFIX}/business/{business_b}/tier-offers/{offre_b['id']}"
    response = (
        await appel(f"{chemin}/activation", json={"is_active": False}, headers=membre_a["headers"])
        if verbe == "put"
        else await appel(chemin, headers=membre_a["headers"])
    )

    assert response.status_code == 403


async def test_une_offre_d_un_autre_commerce_est_absente_du_sien(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    business_a = await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    item_b = await item(client, membre_b, business_b)
    offre_b = (await offrir(client, membre_b, business_b, await palier(conn), item_b["id"])).json()

    response = await client.delete(
        f"{PREFIX}/business/{business_a}/tier-offers/{offre_b['id']}",
        headers=membre_a["headers"],
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "tier_offer_not_found"


async def test_la_liste_ne_montre_que_ses_propres_offres(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    membre_a = await compte(client)
    membre_b = await compte(client)
    business_a = await commerce(client, membre_a)
    business_b = await commerce(client, membre_b, nom="Salon B")
    item_a = await item(client, membre_a, business_a, name="Chez A")
    item_b = await item(client, membre_b, business_b, name="Chez B")
    tier_id = await palier(conn)
    await offrir(client, membre_a, business_a, tier_id, item_a["id"])
    await offrir(client, membre_b, business_b, tier_id, item_b["id"])

    response = await client.get(
        f"{PREFIX}/business/{business_a}/tier-offers", headers=membre_a["headers"]
    )

    assert [ligne["item_name"] for ligne in response.json()] == ["Chez A"]


# --------------------------------------------------------------------------
# la lecture des paliers par un commerce
# --------------------------------------------------------------------------


async def test_le_commerce_lit_les_paliers_qu_il_peut_offrir(client: AsyncClient) -> None:
    """Sans cette liste, composer une offre demanderait de saisir un UUID.

    L'écran de catalogue n'avait aucun moyen d'apprendre quels paliers
    existent : la seule route était réservée à l'administration.
    """
    membre = await compte(client)
    business_id = await commerce(client, membre)

    reponse = await client.get(f"{PREFIX}/business/{business_id}/tiers", headers=membre["headers"])

    assert reponse.status_code == 200, reponse.text
    paliers = reponse.json()
    assert paliers, "les paliers de référence viennent de la migration"
    # Chaque ligne se suffit : l'écran montre un palier, pas un identifiant.
    for p in paliers:
        assert p["platform"] and p["content_format"]
        assert p["min_followers"] >= 0


async def test_un_palier_desactive_n_est_pas_proposable(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Le proposer ferait échouer la création après coup, sans rien annoncer.

    La composition refuse déjà un palier inactif ; l'offrir au choix serait une
    impasse dessinée à l'écran.
    """
    membre = await compte(client)
    business_id = await commerce(client, membre)
    cible = await palier(conn)

    # Pas de `commit()` : la connexion du test est déjà dans une transaction
    # annulée en sortie, et la valider désactiverait ce palier pour de bon —
    # dans la base partagée, pour tous les tests suivants. C'est ce qui a fait
    # tomber `test_tiers.py` en intégration continue et pas en local, où
    # l'ordre d'exécution masquait la fuite. Le client HTTP partage cette même
    # connexion : l'écriture lui est visible sans être validée.
    await conn.execute(sa.update(Tier).where(Tier.id == cible).values(is_active=False))

    reponse = await client.get(f"{PREFIX}/business/{business_id}/tiers", headers=membre["headers"])

    assert reponse.status_code == 200, reponse.text
    assert str(cible) not in {p["id"] for p in reponse.json()}


async def test_un_membre_d_un_autre_commerce_n_y_accede_pas(client: AsyncClient) -> None:
    """La borne est celle de l'appartenance, pas un filtre écrit dans la route."""
    membre = await compte(client)
    business_id = await commerce(client, membre)
    etranger = await compte(client)
    await commerce(client, etranger, nom="Autre salon")

    reponse = await client.get(
        f"{PREFIX}/business/{business_id}/tiers", headers=etranger["headers"]
    )

    assert reponse.status_code in (403, 404), reponse.text
