"""Profil commerce.

Le service ne connaît que l'interface `Geocoder`, jamais un fournisseur.
Comme partout, il n'ouvre ni ne committe de transaction.
"""

import uuid
from dataclasses import dataclass
from enum import StrEnum

import sqlalchemy as sa
from geoalchemy2 import Geometry, WKTElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.geocoding import Coordinates, Geocoder
from app.models import (
    Business,
    BusinessMember,
    CapacityRule,
    CatalogItem,
    Tier,
    TierOffer,
    User,
)
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

    # La même liste que celle rendue par `etapes_activation`. Réécrire les
    # conditions ici en ferait deux, et l'écran finirait par annoncer « prêt »
    # sur une activation que le service refuse.
    for etape in await etapes_activation(session, business=business):
        if etape.blocking and not etape.done:
            raise _REFUS_PAR_ETAPE[etape.cle](business.id)

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


# ---------------------------------------------------------------------------
# Étapes d'activation
#
# Le service connaissait déjà ces conditions, il ne les exposait pas : le
# commerçant apprenait ce qui lui manquait en essayant, une condition à la
# fois, sans jamais voir la liste. Elles sont maintenant lisibles avant
# l'essai, et `activate_business` les consomme — c'est ce qui garantit que
# l'écran et le refus disent la même chose.
# ---------------------------------------------------------------------------


class EtapeActivation(StrEnum):
    ADRESSE = "address"
    COORDONNEES = "coordinates"
    PHOTO_DE_COUVERTURE = "cover_photo"
    CATALOGUE = "catalog_item"
    OFFRE_DE_PALIER = "tier_offer"
    HORAIRES = "capacity_rule"


@dataclass(frozen=True, slots=True)
class Etape:
    cle: EtapeActivation
    done: bool
    #: Bloquante : l'activation est refusée tant qu'elle n'est pas faite.
    #: Non bloquante : l'activation passe, mais le commerce reste invisible ou
    #: incomplet. La distinction est rendue plutôt que devinée — une étape
    #: présentée comme obligatoire alors qu'elle ne l'est pas fait renoncer des
    #: commerces qui pouvaient déjà ouvrir.
    blocking: bool


#: Une étape bloquante non faite lève l'erreur que le routeur sait traduire.
#: La table est ici et non dans le routeur : c'est la même décision que la
#: liste, elle ne se sépare pas d'elle.
_REFUS_PAR_ETAPE = {
    EtapeActivation.ADRESSE: MissingAddress,
    EtapeActivation.COORDONNEES: MissingCoordinates,
}


async def etapes_activation(session: AsyncSession, *, business: Business) -> tuple[Etape, ...]:
    """Ce qui reste à faire, dans l'ordre où on le fait.

    Les trois dernières ne bloquent pas l'activation mais décident de la
    visibilité : un commerce actif sans offre de palier, sans item disponible
    ou sans règle de capacité n'apparaît dans aucun fil. Le taire produirait
    un commerce « activé » que personne ne voit et dont personne ne comprend
    pourquoi.
    """
    a_un_item = await session.scalar(
        sa.select(sa.literal(True))
        .where(CatalogItem.business_id == business.id, CatalogItem.is_available.is_(True))
        .limit(1)
    )
    a_une_offre = await session.scalar(
        sa.select(sa.literal(True))
        .select_from(TierOffer)
        .join(Tier, Tier.id == TierOffer.tier_id)
        .where(
            TierOffer.business_id == business.id,
            TierOffer.is_active.is_(True),
            Tier.is_active.is_(True),
        )
        .limit(1)
    )
    a_des_horaires = await session.scalar(
        sa.select(sa.literal(True)).where(CapacityRule.business_id == business.id).limit(1)
    )

    return (
        Etape(EtapeActivation.ADRESSE, business.address is not None, blocking=True),
        Etape(EtapeActivation.COORDONNEES, business.geo is not None, blocking=True),
        Etape(
            EtapeActivation.PHOTO_DE_COUVERTURE,
            business.cover_photo_key is not None,
            blocking=False,
        ),
        Etape(EtapeActivation.CATALOGUE, bool(a_un_item), blocking=False),
        Etape(EtapeActivation.OFFRE_DE_PALIER, bool(a_une_offre), blocking=False),
        Etape(EtapeActivation.HORAIRES, bool(a_des_horaires), blocking=False),
    )
