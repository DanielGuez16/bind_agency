"""Composition des offres par palier.

Le commerce place des items de son catalogue à un palier, et retire. C'est tout :
l'éligibilité et le fil relèvent des phases suivantes.

Un même item peut être placé à plusieurs paliers — l'unicité porte sur le
triplet. Un créateur éligible à plusieurs paliers verra donc le même item
plusieurs fois ; ce n'est pas un doublon à écraser ici, c'est au fil de la
phase 5 de présenter le meilleur palier accessible. Rien ici ne l'empêche.

Deux règles que le service tient seul, la base ne les portant pas encore :
un parent ne se place pas dans une offre, et une offre ne se crée pas sur un
palier inactif. Voir DECISIONS.md.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Booking, CatalogItem, Tier, TierOffer
from app.models.enums import TierOfferState
from app.schemas.tier_offers import TierOfferCreate
from app.services.audit import Actor, AuditedEntity, record_transition


class TierOfferError(Exception):
    """Base des erreurs de composition."""


class OfferNotFound(TierOfferError):
    pass


class OfferAlreadyExists(TierOfferError):
    """Le triplet commerce, palier, item est unique."""


class ParentNotAllowed(TierOfferError):
    """Un parent regroupe des variantes : c'est la variante qui se propose."""


class TierInactive(TierOfferError):
    """On ne compose pas sur un palier fermé."""


class OfferHasBookings(TierOfferError):
    """Une offre réservée ne se supprime pas, elle se désactive."""


# --------------------------------------------------------------------------
# lecture
# --------------------------------------------------------------------------


async def list_offers(session: AsyncSession, business_id: uuid.UUID) -> list[TierOffer]:
    statement = (
        sa.select(TierOffer)
        .where(TierOffer.business_id == business_id)
        .order_by(TierOffer.created_at)
    )
    return list(await session.scalars(statement))


async def get_offer(
    session: AsyncSession, business_id: uuid.UUID, offer_id: uuid.UUID
) -> TierOffer:
    offer = await session.scalar(
        sa.select(TierOffer).where(TierOffer.id == offer_id, TierOffer.business_id == business_id)
    )
    if offer is None:
        raise OfferNotFound(offer_id)
    return offer


async def describe(session: AsyncSession, offers: list[TierOffer]) -> dict[uuid.UUID, dict]:
    """Palier, item, et disponibilité effective, en une requête pour toute la liste.

    « Effectivement proposée » se calcule à partir de trois interrupteurs — celui
    de l'offre, celui du palier, celui de l'item corrigé par son parent — et
    n'est recopié nulle part. Trois valeurs dupliquées, ce serait trois façons
    de diverger.
    """
    if not offers:
        return {}

    parent = sa.orm.aliased(CatalogItem)
    rows = (
        await session.execute(
            sa.select(
                TierOffer.id,
                Tier.platform,
                Tier.content_format,
                Tier.is_active.label("tier_active"),
                CatalogItem.name.label("item_name"),
                CatalogItem.is_available.label("item_available"),
                parent.is_available.label("parent_available"),
            )
            .join(Tier, Tier.id == TierOffer.tier_id)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
            .where(TierOffer.id.in_([offer.id for offer in offers]))
        )
    ).all()

    par_offre = {row.id: row for row in rows}
    return {
        offer.id: {
            "platform": par_offre[offer.id].platform,
            "content_format": par_offre[offer.id].content_format,
            "item_name": par_offre[offer.id].item_name,
            "is_effectively_offered": (
                offer.is_active
                and par_offre[offer.id].tier_active
                and par_offre[offer.id].item_available
                and (par_offre[offer.id].parent_available is not False)
            ),
        }
        for offer in offers
    }


# --------------------------------------------------------------------------
# écriture
# --------------------------------------------------------------------------


async def _has_variants(session: AsyncSession, item_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(sa.select(sa.exists().where(CatalogItem.parent_item_id == item_id)))
    )


async def create_offer(
    session: AsyncSession, *, business_id: uuid.UUID, payload: TierOfferCreate
) -> TierOffer:
    """Compose une offre. `requires_booking` ne conditionne rien ici.

    Un item sans réservation se propose comme un autre : le créateur obtient un
    droit valable sur une fenêtre au lieu d'un créneau, et ça ne regarde pas la
    composition.
    """
    tier = await session.get(Tier, payload.tier_id)
    if tier is None:
        raise OfferNotFound(payload.tier_id)

    # Refusé à la création seulement. Désactiver un palier ensuite laisse les
    # offres en place — ce sont deux règles différentes, elles ne se
    # contredisent pas.
    if not tier.is_active:
        raise TierInactive(tier.id)

    item = await session.scalar(
        sa.select(CatalogItem).where(
            CatalogItem.id == payload.catalog_item_id,
            CatalogItem.business_id == business_id,
        )
    )
    if item is None:
        raise OfferNotFound(payload.catalog_item_id)

    if await _has_variants(session, item.id):
        raise ParentNotAllowed(item.id)

    offer = TierOffer(business_id=business_id, tier_id=tier.id, catalog_item_id=item.id)

    try:
        # `add` est à l'intérieur du bloc : `begin_nested` vide les objets en
        # attente AVANT d'ouvrir le point de sauvegarde, un `add` placé au-dessus
        # échapperait donc à sa protection et laisserait la session inutilisable.
        async with session.begin_nested():
            session.add(offer)
            await session.flush()
    except IntegrityError as error:
        raise OfferAlreadyExists((business_id, tier.id, item.id)) from error

    return offer


async def set_active(
    session: AsyncSession, *, offer: TierOffer, is_active: bool, actor: Actor
) -> bool:
    """Retrait sans suppression. Renvoie faux si rien n'a changé."""
    if offer.is_active == is_active:
        return False

    precedent = TierOfferState.ACTIVE if offer.is_active else TierOfferState.INACTIVE
    courant = TierOfferState.ACTIVE if is_active else TierOfferState.INACTIVE

    offer.is_active = is_active
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.TIER_OFFER,
        entity_id=offer.id,
        from_status=precedent.value,
        to_status=courant.value,
        actor=actor,
    )
    return True


async def delete_offer(session: AsyncSession, *, offer: TierOffer) -> None:
    """Une offre réservée ne se supprime pas : elle se désactive."""
    reservee = bool(
        await session.scalar(sa.select(sa.exists().where(Booking.tier_offer_id == offer.id)))
    )
    if reservee:
        raise OfferHasBookings(offer.id)

    try:
        async with session.begin_nested():
            await session.delete(offer)
            await session.flush()
    except IntegrityError as error:
        # Filet du RESTRICT posé par `booking`.
        raise OfferHasBookings(offer.id) from error
