"""Profil commerce.

Le service ne connaît que l'interface `Geocoder`, jamais un fournisseur.
Comme partout, il n'ouvre ni ne committe de transaction.
"""

import uuid

import sqlalchemy as sa
from geoalchemy2 import Geometry, WKTElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.geocoding import Coordinates, Geocoder
from app.models import Business, BusinessMember, User
from app.models.enums import BusinessMemberRole, BusinessStatus
from app.schemas.business import BusinessCreate, BusinessUpdate
from app.services.audit import Actor, AuditedEntity, record_transition

REASON_ACTIVATION = "business_activated"

SRID = 4326


class BusinessError(Exception):
    """Base des erreurs du profil commerce."""


class AlreadyActive(BusinessError):
    pass


class MissingAddress(BusinessError):
    pass


class MissingCoordinates(BusinessError):
    pass


def _point(coordinates: Coordinates) -> WKTElement:
    return WKTElement(coordinates.as_wkt(), srid=SRID)


async def coordinates_of(session: AsyncSession, business: Business) -> Coordinates | None:
    """Relit les coordonnées en base : `geo` est un binaire opaque côté Python."""
    if business.geo is None:
        return None

    point = sa.cast(Business.geo, Geometry)
    row = (
        await session.execute(
            sa.select(sa.func.ST_X(point), sa.func.ST_Y(point)).where(Business.id == business.id)
        )
    ).one()

    return Coordinates(longitude=row[0], latitude=row[1])


async def create_business(
    session: AsyncSession,
    *,
    payload: BusinessCreate,
    creator: User,
    geocoder: Geocoder,
) -> Business:
    """Crée le commerce et rattache son créateur comme `owner`, d'un seul tenant.

    Un commerce sans membre est un commerce auquel personne ne peut accéder :
    les deux écritures appartiennent à la même transaction, pas à deux étapes
    dont la seconde pourrait manquer.
    """
    declared = (
        Coordinates(payload.coordinates.longitude, payload.coordinates.latitude)
        if payload.coordinates
        else None
    )
    resolved = await geocoder.locate(payload.address, declared=declared)

    business = Business(
        name=payload.name,
        category=payload.category,
        address=payload.address,
        geo=_point(resolved) if resolved else None,
        timezone=payload.timezone,
        default_locale=payload.default_locale,
        phone=payload.phone,
        currency=payload.currency,
        cover_photo_key=payload.cover_photo_key,
        status=BusinessStatus.ONBOARDING,
    )
    session.add(business)
    await session.flush()

    session.add(
        BusinessMember(
            business_id=business.id,
            user_id=creator.id,
            role=BusinessMemberRole.OWNER,
        )
    )
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=None,
        to_status=BusinessStatus.ONBOARDING.value,
        actor=Actor.from_user(creator),
    )

    return business


async def get_business(session: AsyncSession, business_id: uuid.UUID) -> Business | None:
    return await session.get(Business, business_id)


async def update_business(
    session: AsyncSession,
    *,
    business: Business,
    payload: BusinessUpdate,
    geocoder: Geocoder,
) -> Business:
    """Met à jour les champs fournis. La devise n'en fait pas partie, par construction."""
    fields = payload.model_dump(exclude_unset=True)

    if "coordinates" in fields or "address" in fields:
        declared = (
            Coordinates(payload.coordinates.longitude, payload.coordinates.latitude)
            if payload.coordinates
            else None
        )
        address = fields.get("address", business.address)
        resolved = await geocoder.locate(address, declared=declared)
        business.geo = _point(resolved) if resolved else None

    for name in (
        "name",
        "category",
        "address",
        "timezone",
        "default_locale",
        "phone",
        "cover_photo_key",
    ):
        if name in fields:
            setattr(business, name, fields[name])

    await session.flush()
    return business


async def activate_business(session: AsyncSession, *, business: Business, actor: Actor) -> Business:
    """Transition explicite, jamais un effet de bord d'une mise à jour.

    Le refus nomme la condition qui manque : « ça n'a pas marché » n'aide
    personne à compléter son inscription.
    """
    if business.status is BusinessStatus.ACTIVE:
        raise AlreadyActive(business.id)

    if business.address is None:
        raise MissingAddress(business.id)

    if business.geo is None:
        raise MissingCoordinates(business.id)

    previous = business.status
    business.status = BusinessStatus.ACTIVE
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=previous.value,
        to_status=BusinessStatus.ACTIVE.value,
        actor=actor,
        reason=REASON_ACTIVATION,
    )

    return business
