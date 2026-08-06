"""Fabriques minimales pour les tests de contraintes.

Elles n'insèrent que ce qui est nécessaire pour atteindre la contrainte visée.
Aucune logique métier ici, c'est du remplissage de lignes.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.security import hash_password
from app.models import (
    Booking,
    Business,
    CatalogItem,
    CreatorProfile,
    SocialAccount,
    Tier,
    TierOffer,
    User,
)
from app.models.enums import (
    BookingStatus,
    BusinessCategory,
    ContentFormat,
    Platform,
    UserRole,
)

# Miami, ville de lancement.
MIAMI = "POINT(-80.1918 25.7617)"


async def new_business(conn: AsyncConnection, **overrides: Any) -> uuid.UUID:
    values: dict[str, Any] = {
        "name": "Salon d'essai",
        "category": BusinessCategory.BEAUTY,
        "address": "100 Ocean Drive, Miami",
        "geo": sa.func.ST_GeogFromText(MIAMI),
        "currency": "USD",
    } | overrides
    result = await conn.execute(sa.insert(Business).values(**values).returning(Business.id))
    return result.scalar_one()


PASSWORD = "mot-de-passe-de-test-1234"

# Haché une seule fois : argon2id est volontairement lent, le refaire à chaque
# insertion de test coûterait plusieurs secondes sur la suite.
PASSWORD_HASH = hash_password(PASSWORD)


async def new_user(conn: AsyncConnection, **overrides: Any) -> uuid.UUID:
    values: dict[str, Any] = {
        "role": UserRole.CREATOR,
        "email": f"{uuid.uuid4()}@example.com",
        "password_hash": PASSWORD_HASH,
    } | overrides
    result = await conn.execute(sa.insert(User).values(**values).returning(User.id))
    return result.scalar_one()


async def new_creator(conn: AsyncConnection, **overrides: Any) -> uuid.UUID:
    user_id = await new_user(conn, role=UserRole.CREATOR)
    await conn.execute(sa.insert(CreatorProfile).values(user_id=user_id, **overrides))
    return user_id


async def new_social_account(
    conn: AsyncConnection, creator_id: uuid.UUID, **overrides: Any
) -> uuid.UUID:
    values: dict[str, Any] = {
        "creator_id": creator_id,
        "platform": Platform.INSTAGRAM,
        "external_id": str(uuid.uuid4()),
        "handle": "compte_essai",
    } | overrides
    result = await conn.execute(
        sa.insert(SocialAccount).values(**values).returning(SocialAccount.id)
    )
    return result.scalar_one()


async def new_catalog_item(
    conn: AsyncConnection,
    business_id: uuid.UUID,
    *,
    requires_booking: bool = True,
    **overrides: Any,
) -> uuid.UUID:
    values: dict[str, Any] = {
        "business_id": business_id,
        "name": "Soin visage",
        "price_cents": 8000,
        "requires_booking": requires_booking,
        "duration_minutes": DUREE_PAR_DEFAUT if requires_booking else None,
    } | overrides
    result = await conn.execute(sa.insert(CatalogItem).values(**values).returning(CatalogItem.id))
    return result.scalar_one()


async def new_tier(conn: AsyncConnection, **overrides: Any) -> uuid.UUID:
    """Crée un palier, ou renvoie celui qui existe déjà sur ce couple.

    Un palier est une configuration globale de la plateforme, unique sur
    (platform, content_format) : deux graphes de test coexistant dans la même
    transaction doivent le partager, pas se le disputer.
    """
    values: dict[str, Any] = {
        "platform": Platform.INSTAGRAM,
        "content_format": ContentFormat.STORY,
        "min_followers": 1000,
        "display_order": 1,
    } | overrides

    existing = await conn.scalar(
        sa.select(Tier.id).where(
            Tier.platform == values["platform"],
            Tier.content_format == values["content_format"],
        )
    )
    if existing is not None:
        return existing

    result = await conn.execute(sa.insert(Tier).values(**values).returning(Tier.id))
    return result.scalar_one()


async def new_tier_offer(
    conn: AsyncConnection,
    business_id: uuid.UUID,
    tier_id: uuid.UUID,
    catalog_item_id: uuid.UUID,
    **overrides: Any,
) -> uuid.UUID:
    values: dict[str, Any] = {
        "business_id": business_id,
        "tier_id": tier_id,
        "catalog_item_id": catalog_item_id,
    } | overrides
    result = await conn.execute(sa.insert(TierOffer).values(**values).returning(TierOffer.id))
    return result.scalar_one()


#: Durée par défaut d'un item réservable dans les fabriques. La réservation
#: porte la sienne, et la clé étrangère composite exige qu'elles coïncident.
DUREE_PAR_DEFAUT = 60


def booking_values(*, requires_booking: bool = True, **overrides: Any) -> dict[str, Any]:
    """Valeurs valides pour une réservation. Les tests n'écrasent que ce qu'ils visent."""
    now = datetime.now(UTC)
    duree = DUREE_PAR_DEFAUT if requires_booking else None
    debut = now + timedelta(days=1) if requires_booking else None
    values: dict[str, Any] = {
        "requires_booking": requires_booking,
        "duration_minutes": duree,
        "starts_at": debut,
        # `ends_at` se déduit de la durée : la base vérifie qu'ils coïncident.
        "ends_at": debut + timedelta(minutes=duree) if debut else None,
        "valid_until": now + timedelta(days=7),
        "status": BookingStatus.CONFIRMED,
        "value_cents_snapshot": 8000,
    }
    return values | overrides


async def new_booking_graph(conn: AsyncConnection, *, requires_booking: bool = True) -> dict:
    """Le graphe minimal complet permettant d'insérer une réservation valide."""
    business_id = await new_business(conn)
    creator_id = await new_creator(conn)
    social_account_id = await new_social_account(conn, creator_id)
    catalog_item_id = await new_catalog_item(conn, business_id, requires_booking=requires_booking)
    tier_id = await new_tier(conn)
    tier_offer_id = await new_tier_offer(conn, business_id, tier_id, catalog_item_id)
    return {
        "business_id": business_id,
        "creator_id": creator_id,
        "social_account_id": social_account_id,
        "catalog_item_id": catalog_item_id,
        "tier_id": tier_id,
        "tier_offer_id": tier_offer_id,
    }


def booking_insert(graph: dict, **overrides: Any) -> sa.Insert:
    keys = (
        "creator_id",
        "business_id",
        "tier_offer_id",
        "catalog_item_id",
        "social_account_id",
    )
    values = {key: graph[key] for key in keys}
    values |= booking_values(**overrides)
    return sa.insert(Booking).values(**values)
