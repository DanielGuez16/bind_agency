"""Paliers et interface d'administration.

Le test qui compte le plus est le dernier : modifier un seuil ne doit rien
changer à une contrepartie passée ni à une réservation en cours. Ce n'est pas
une précaution du service, c'est la forme des tables — et c'est justement ce
qu'un test doit démontrer plutôt qu'affirmer.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import get_settings
from app.models import AuditLog, Booking, Collaboration, Tier, TierOffer
from app.models.enums import ActorKind, BookingStatus, ContentFormat, Platform, UserRole
from tests.factories import (
    booking_insert,
    new_booking_graph,
    new_business,
    new_catalog_item,
    new_tier,
    new_tier_offer,
)

PREFIX = get_settings().api_v1_prefix


async def compte(client: AsyncClient, role: UserRole) -> dict:
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


def palier_payload(**overrides) -> dict:
    return {
        "platform": Platform.YOUTUBE.value,
        "content_format": ContentFormat.POST.value,
        "min_followers": 2000,
        "min_completed_collabs": 0,
        "display_order": 1,
    } | overrides


# --------------------------------------------------------------------------
# données de référence
# --------------------------------------------------------------------------


async def test_les_paliers_de_reference_existent_apres_migration(
    conn: AsyncConnection,
) -> None:
    """Ils entrent par migration, pas par la commande de jeu de données.

    Ce sont des données de référence : elles doivent exister en production, où
    la commande de jeu de données ne tourne jamais.
    """
    lignes = (
        await conn.execute(
            sa.select(Tier.platform, Tier.content_format, Tier.is_active).order_by(
                Tier.platform, Tier.display_order
            )
        )
    ).all()

    couples = {(ligne.platform, ligne.content_format) for ligne in lignes}
    assert couples == {
        (Platform.INSTAGRAM, ContentFormat.STORY),
        (Platform.INSTAGRAM, ContentFormat.POST),
        (Platform.INSTAGRAM, ContentFormat.REEL),
        (Platform.TIKTOK, ContentFormat.STORY),
        (Platform.TIKTOK, ContentFormat.POST),
        (Platform.TIKTOK, ContentFormat.REEL),
        (Platform.SNAPCHAT, ContentFormat.STORY),
    }


async def test_snapchat_est_pose_mais_inactif(conn: AsyncConnection) -> None:
    """L'accès partenaire n'est pas obtenu : la bascule ne demandera qu'un `is_active`."""
    actif = await conn.scalar(sa.select(Tier.is_active).where(Tier.platform == Platform.SNAPCHAT))
    assert actif is False

    autres = list(
        await conn.scalars(sa.select(Tier.is_active).where(Tier.platform != Platform.SNAPCHAT))
    )
    assert all(autres)


async def test_les_identifiants_de_reference_sont_stables(conn: AsyncConnection) -> None:
    """Fixés en dur : un `tier_id` est lisible d'un environnement à l'autre."""
    identifiant = await conn.scalar(
        sa.select(Tier.id).where(
            Tier.platform == Platform.INSTAGRAM, Tier.content_format == ContentFormat.STORY
        )
    )
    assert str(identifiant) == "8f9bfcd8-39ff-41a3-9b6b-f00e40f8774d"


# --------------------------------------------------------------------------
# accès réservé à l'administration
# --------------------------------------------------------------------------


@pytest.mark.parametrize("role", [UserRole.CREATOR, UserRole.BUSINESS_MEMBER])
@pytest.mark.parametrize(
    ("verbe", "chemin"),
    [
        ("get", ""),
        ("post", ""),
        ("get", "/{id}"),
        ("patch", "/{id}"),
        ("delete", "/{id}"),
    ],
)
async def test_un_non_administrateur_est_refuse(
    client: AsyncClient, conn: AsyncConnection, role: UserRole, verbe: str, chemin: str
) -> None:
    utilisateur = await compte(client, role)
    tier_id = await conn.scalar(sa.select(Tier.id).limit(1))

    url = f"{PREFIX}/admin/tiers{chemin.format(id=tier_id)}"
    appel = getattr(client, verbe)
    response = (
        await appel(url, json=palier_payload(), headers=utilisateur["headers"])
        if verbe in {"post", "patch"}
        else await appel(url, headers=utilisateur["headers"])
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "insufficient_role"


async def test_sans_jeton_c_est_401(client: AsyncClient) -> None:
    response = await client.get(f"{PREFIX}/admin/tiers")
    assert response.status_code == 401


async def test_un_administrateur_liste_les_paliers(client: AsyncClient) -> None:
    admin = await compte(client, UserRole.ADMIN)

    response = await client.get(f"{PREFIX}/admin/tiers", headers=admin["headers"])

    assert response.status_code == 200
    assert len(response.json()) == 7
    assert {"value_ratio_hint", "min_reliability_score"} <= set(response.json()[0])


# --------------------------------------------------------------------------
# création et unicité
# --------------------------------------------------------------------------


async def test_le_couple_plateforme_format_est_unique(client: AsyncClient) -> None:
    admin = await compte(client, UserRole.ADMIN)
    doublon = palier_payload(
        platform=Platform.INSTAGRAM.value, content_format=ContentFormat.STORY.value
    )

    response = await client.post(f"{PREFIX}/admin/tiers", json=doublon, headers=admin["headers"])

    assert response.status_code == 409
    assert response.json()["detail"] == "tier_already_exists"
    assert "violates" not in response.text


async def test_un_nouveau_couple_est_accepte(client: AsyncClient) -> None:
    admin = await compte(client, UserRole.ADMIN)

    response = await client.post(
        f"{PREFIX}/admin/tiers", json=palier_payload(), headers=admin["headers"]
    )

    assert response.status_code == 201
    assert response.json()["platform"] == Platform.YOUTUBE.value


async def test_le_score_minimal_nul_reste_nul(client: AsyncClient) -> None:
    """Nul veut dire « aucune condition de score », pas « score zéro exigé »."""
    admin = await compte(client, UserRole.ADMIN)

    cree = (
        await client.post(f"{PREFIX}/admin/tiers", json=palier_payload(), headers=admin["headers"])
    ).json()

    assert cree["min_reliability_score"] is None


async def test_la_plateforme_et_le_format_ne_se_modifient_pas(client: AsyncClient) -> None:
    admin = await compte(client, UserRole.ADMIN)
    cree = (
        await client.post(f"{PREFIX}/admin/tiers", json=palier_payload(), headers=admin["headers"])
    ).json()

    response = await client.patch(
        f"{PREFIX}/admin/tiers/{cree['id']}",
        json={"platform": Platform.SNAPCHAT.value},
        headers=admin["headers"],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "validation_failed"


# --------------------------------------------------------------------------
# suppression et désactivation
# --------------------------------------------------------------------------


async def _palier_reference(conn: AsyncConnection) -> uuid.UUID:
    """Un palier tenu par une offre composée."""
    business_id = await new_business(conn)
    item_id = await new_catalog_item(conn, business_id)
    tier_id = await new_tier(conn, platform=Platform.YOUTUBE, content_format=ContentFormat.REEL)
    await new_tier_offer(conn, business_id, tier_id, item_id)
    return tier_id


async def test_un_palier_reference_ne_se_supprime_pas(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    admin = await compte(client, UserRole.ADMIN)
    tier_id = await _palier_reference(conn)

    response = await client.delete(f"{PREFIX}/admin/tiers/{tier_id}", headers=admin["headers"])

    assert response.status_code == 409
    assert response.json()["detail"] == "tier_in_use"
    assert "violates" not in response.text
    assert "constraint" not in response.text


async def test_un_palier_reference_par_une_contrepartie_ne_se_supprime_pas(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    admin = await compte(client, UserRole.ADMIN)
    graph = await new_booking_graph(conn)
    booking_id = (await conn.execute(booking_insert(graph).returning(Booking.id))).scalar_one()
    await conn.execute(
        sa.insert(Collaboration).values(
            booking_id=booking_id,
            tier_id=graph["tier_id"],
            required_format=ContentFormat.STORY,
            deadline_at=datetime.now(UTC) + timedelta(days=2),
        )
    )

    response = await client.delete(
        f"{PREFIX}/admin/tiers/{graph['tier_id']}", headers=admin["headers"]
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "tier_in_use"


async def test_un_palier_libre_se_supprime(client: AsyncClient, conn: AsyncConnection) -> None:
    admin = await compte(client, UserRole.ADMIN)
    cree = (
        await client.post(f"{PREFIX}/admin/tiers", json=palier_payload(), headers=admin["headers"])
    ).json()

    response = await client.delete(f"{PREFIX}/admin/tiers/{cree['id']}", headers=admin["headers"])

    assert response.status_code == 204
    reste = await conn.scalar(
        sa.select(sa.func.count()).select_from(Tier).where(Tier.id == uuid.UUID(cree["id"]))
    )
    assert reste == 0


async def test_desactiver_un_palier_laisse_ses_offres_intactes(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Elles cessent d'être proposées, elles ne sont pas supprimées."""
    admin = await compte(client, UserRole.ADMIN)
    tier_id = await _palier_reference(conn)
    offres_avant = await conn.scalar(
        sa.select(sa.func.count()).select_from(TierOffer).where(TierOffer.tier_id == tier_id)
    )
    assert offres_avant == 1

    response = await client.patch(
        f"{PREFIX}/admin/tiers/{tier_id}",
        json={"is_active": False},
        headers=admin["headers"],
    )

    assert response.status_code == 200
    assert response.json()["is_active"] is False

    offres_apres = (
        await conn.execute(
            sa.select(TierOffer.id, TierOffer.is_active).where(TierOffer.tier_id == tier_id)
        )
    ).all()
    assert len(offres_apres) == 1
    assert offres_apres[0].is_active is True, "l'offre n'a pas à être touchée"


async def test_la_bascule_d_activite_est_journalisee(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    admin = await compte(client, UserRole.ADMIN)
    tier_id = await conn.scalar(sa.select(Tier.id).where(Tier.platform == Platform.SNAPCHAT))

    await client.patch(
        f"{PREFIX}/admin/tiers/{tier_id}", json={"is_active": True}, headers=admin["headers"]
    )

    ligne = (
        await conn.execute(sa.select(AuditLog.__table__).where(AuditLog.entity_type == "tier"))
    ).one()
    assert ligne.entity_id == tier_id
    assert ligne.from_status == "inactive"
    assert ligne.to_status == "active"
    assert ligne.actor_kind == ActorKind.ADMIN
    assert ligne.actor_user_id == uuid.UUID(admin["user_id"])


async def test_un_changement_de_seuil_n_est_pas_une_bascule(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Le journal ne décrit que des transitions d'état. Voir DECISIONS.md."""
    admin = await compte(client, UserRole.ADMIN)
    tier_id = await conn.scalar(sa.select(Tier.id).limit(1))

    await client.patch(
        f"{PREFIX}/admin/tiers/{tier_id}",
        json={"min_followers": 99999},
        headers=admin["headers"],
    )

    combien = await conn.scalar(
        sa.select(sa.func.count()).select_from(AuditLog).where(AuditLog.entity_type == "tier")
    )
    assert combien == 0


# --------------------------------------------------------------------------
# aucun effet rétroactif
# --------------------------------------------------------------------------


async def test_modifier_un_seuil_n_affecte_ni_contrepartie_ni_reservation(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    """Le test central de la tâche.

    Un seuil ne s'applique qu'à l'entrée. La contrepartie fige ses propres
    critères, la réservation fige sa valeur : rien en aval ne relit le palier.
    """
    admin = await compte(client, UserRole.ADMIN)
    graph = await new_booking_graph(conn)
    booking_id = (await conn.execute(booking_insert(graph).returning(Booking.id))).scalar_one()
    collaboration_id = (
        await conn.execute(
            sa.insert(Collaboration)
            .values(
                booking_id=booking_id,
                tier_id=graph["tier_id"],
                required_format=ContentFormat.STORY,
                required_mention="@salon_ocean",
                required_geotag=True,
                deadline_at=datetime.now(UTC) + timedelta(days=2),
            )
            .returning(Collaboration.id)
        )
    ).scalar_one()

    avant_reservation = (
        await conn.execute(
            sa.select(Booking.value_cents_snapshot, Booking.status, Booking.tier_offer_id).where(
                Booking.id == booking_id
            )
        )
    ).one()
    avant_contrepartie = (
        await conn.execute(
            sa.select(
                Collaboration.required_format,
                Collaboration.required_mention,
                Collaboration.required_geotag,
                Collaboration.deadline_at,
            ).where(Collaboration.id == collaboration_id)
        )
    ).one()

    modifiee = await client.patch(
        f"{PREFIX}/admin/tiers/{graph['tier_id']}",
        json={
            "min_followers": 999999,
            "min_completed_collabs": 99,
            "min_reliability_score": "99.00",
            "value_ratio_hint": "9.999",
        },
        headers=admin["headers"],
    )
    assert modifiee.status_code == 200

    apres_reservation = (
        await conn.execute(
            sa.select(Booking.value_cents_snapshot, Booking.status, Booking.tier_offer_id).where(
                Booking.id == booking_id
            )
        )
    ).one()
    apres_contrepartie = (
        await conn.execute(
            sa.select(
                Collaboration.required_format,
                Collaboration.required_mention,
                Collaboration.required_geotag,
                Collaboration.deadline_at,
            ).where(Collaboration.id == collaboration_id)
        )
    ).one()

    assert apres_reservation == avant_reservation
    assert apres_contrepartie == avant_contrepartie


async def test_desactiver_un_palier_n_affecte_pas_une_reservation_en_cours(
    client: AsyncClient, conn: AsyncConnection
) -> None:
    admin = await compte(client, UserRole.ADMIN)
    graph = await new_booking_graph(conn)
    booking_id = (
        await conn.execute(
            booking_insert(graph, status=BookingStatus.CONFIRMED).returning(Booking.id)
        )
    ).scalar_one()

    await client.patch(
        f"{PREFIX}/admin/tiers/{graph['tier_id']}",
        json={"is_active": False},
        headers=admin["headers"],
    )

    statut = await conn.scalar(sa.select(Booking.status).where(Booking.id == booking_id))
    assert statut == BookingStatus.CONFIRMED
