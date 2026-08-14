"""Catalogue en saisie manuelle.

Trois règles que la base ne porte pas encore et que ce service est seul à tenir :
un parent n'est jamais réservable, il n'y a pas de variante de variante, et la
durée d'un item déjà réservé ne bouge plus. Elles sont signalées comme telles
dans DECISIONS.md — le service n'est pas le bon endroit pour une invariante,
c'est seulement le seul disponible aujourd'hui.

Là où la base pose un filet — bascule de `requires_booking` et suppression d'un
item réservé — le service vérifie quand même avant d'écrire, et rattrape la
violation si elle survient. Une contrainte brute ne doit jamais atteindre
l'appelant : elle ne lui dit pas quoi faire.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Booking, Business, CatalogItem
from app.schemas.catalog import CatalogItemCreate, CatalogItemUpdate

MAX_DEPTH = 2


class CatalogError(Exception):
    """Base des erreurs de catalogue."""


class ItemNotFound(CatalogError):
    pass


class ParentNotFound(CatalogError):
    pass


class ParentMustNotBeBookable(CatalogError):
    """Un parent regroupe des variantes, c'est la variante qui se réserve."""


class VariantDepthExceeded(CatalogError):
    """Deux niveaux au maximum : pas de variante de variante."""


class ItemLockedByBookings(CatalogError):
    """Nature ou durée figées par des réservations existantes."""


class ItemHasBookings(CatalogError):
    """Un item réservé ne se supprime pas, il se désactive."""


class DurationMismatch(CatalogError):
    """Durée obligatoire si et seulement si l'item est réservable."""


def _ensure_duration_coherence(*, requires_booking: bool, duration_minutes: int | None) -> None:
    """Vérifie l'état résultant, jamais la seule charge utile.

    Un schéma ne peut pas trancher : une mise à jour partielle qui ne change que
    `requires_booking` produit un état incohérent sans qu'aucun champ envoyé ne
    soit invalide. Seul le service connaît l'état après fusion — et le CHECK en
    base, qui ne dit rien d'exploitable à l'appelant.
    """
    if requires_booking != (duration_minutes is not None):
        raise DurationMismatch((requires_booking, duration_minutes))


# --------------------------------------------------------------------------
# lecture
# --------------------------------------------------------------------------


async def list_items(session: AsyncSession, business_id: uuid.UUID) -> list[CatalogItem]:
    statement = (
        sa.select(CatalogItem)
        .where(CatalogItem.business_id == business_id)
        .order_by(CatalogItem.parent_item_id.nulls_first(), CatalogItem.name)
    )
    return list(await session.scalars(statement))


async def get_item(
    session: AsyncSession, business_id: uuid.UUID, item_id: uuid.UUID
) -> CatalogItem:
    """La requête est bornée au commerce : un item d'ailleurs est simplement absent.

    Répondre 404 ici ne dit rien d'un autre commerce — l'appelant a déjà prouvé
    son appartenance à celui-ci, et la réponse ne parle que de son catalogue.
    """
    item = await session.scalar(
        sa.select(CatalogItem).where(
            CatalogItem.id == item_id, CatalogItem.business_id == business_id
        )
    )
    if item is None:
        raise ItemNotFound(item_id)
    return item


async def effective_availability(
    session: AsyncSession, items: list[CatalogItem]
) -> dict[uuid.UUID, bool]:
    """Disponibilité réelle, calculée et jamais recopiée sur les enfants.

    Une valeur dupliquée est une valeur qui divergera : il suffit d'un chemin
    d'écriture qui oublie de la propager.
    """
    parent_ids = {item.parent_item_id for item in items if item.parent_item_id is not None}

    parents: dict[uuid.UUID, bool] = {}
    if parent_ids:
        rows = await session.execute(
            sa.select(CatalogItem.id, CatalogItem.is_available).where(
                CatalogItem.id.in_(parent_ids)
            )
        )
        parents = dict(rows.all())

    return {item.id: item.is_available and parents.get(item.parent_item_id, True) for item in items}


# --------------------------------------------------------------------------
# état des réservations
# --------------------------------------------------------------------------


async def _has_bookings(session: AsyncSession, item_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(sa.select(sa.exists().where(Booking.catalog_item_id == item_id)))
    )


async def _has_bookings_including_variants(session: AsyncSession, item_id: uuid.UUID) -> bool:
    """La suppression d'un parent emporte ses variantes : leurs réservations comptent."""
    concerned = sa.select(CatalogItem.id).where(
        sa.or_(CatalogItem.id == item_id, CatalogItem.parent_item_id == item_id)
    )
    return bool(
        await session.scalar(sa.select(sa.exists().where(Booking.catalog_item_id.in_(concerned))))
    )


async def _has_variants(session: AsyncSession, item_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(sa.select(sa.exists().where(CatalogItem.parent_item_id == item_id)))
    )


# --------------------------------------------------------------------------
# écriture
# --------------------------------------------------------------------------


async def create_item(
    session: AsyncSession, *, business: Business, payload: CatalogItemCreate
) -> CatalogItem:
    if payload.parent_item_id is not None:
        parent = await session.scalar(
            sa.select(CatalogItem).where(
                CatalogItem.id == payload.parent_item_id,
                CatalogItem.business_id == business.id,
            )
        )
        if parent is None:
            raise ParentNotFound(payload.parent_item_id)
        if parent.parent_item_id is not None:
            raise VariantDepthExceeded(payload.parent_item_id)
        if parent.requires_booking:
            raise ParentMustNotBeBookable(parent.id)

    _ensure_duration_coherence(
        requires_booking=payload.requires_booking, duration_minutes=payload.duration_minutes
    )

    item = CatalogItem(
        business_id=business.id,
        parent_item_id=payload.parent_item_id,
        name=payload.name,
        description=payload.description,
        price_cents=payload.price_cents,
        duration_minutes=payload.duration_minutes,
        requires_booking=payload.requires_booking,
        photo_key=payload.photo_key,
        leaves_choice=payload.leaves_choice,
        is_available=payload.is_available,
    )
    session.add(item)
    await session.flush()
    return item


async def update_item(
    session: AsyncSession, *, item: CatalogItem, payload: CatalogItemUpdate
) -> CatalogItem:
    fields = payload.model_dump(exclude_unset=True)

    nature_change = (
        "requires_booking" in fields and fields["requires_booking"] != item.requires_booking
    )
    duration_change = (
        "duration_minutes" in fields and fields["duration_minutes"] != item.duration_minutes
    )

    # La durée n'a aucun filet en base : une réservation à venir garde son
    # créneau figé dans starts_at et ends_at, mais la capacité serait recalculée
    # sur une durée que personne n'a décidé de changer.
    if (nature_change or duration_change) and await _has_bookings(session, item.id):
        raise ItemLockedByBookings(item.id)

    if nature_change and fields["requires_booking"] and await _has_variants(session, item.id):
        raise ParentMustNotBeBookable(item.id)

    _ensure_duration_coherence(
        requires_booking=fields.get("requires_booking", item.requires_booking),
        duration_minutes=fields.get("duration_minutes", item.duration_minutes),
    )

    # Le prix ne demande aucune vérification : `value_cents_snapshot` fige la
    # valeur au moment de la réservation, c'est exactement à ça qu'il sert.
    for name in (
        "name",
        "description",
        "price_cents",
        "duration_minutes",
        "requires_booking",
        "photo_key",
        "leaves_choice",
    ):
        if name in fields:
            setattr(item, name, fields[name])

    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as error:
        # Filet de la clé étrangère composite. Il ne devrait jamais servir : la
        # vérification ci-dessus l'a déjà couvert. S'il sert, l'appelant reçoit
        # quand même un message qui lui dit quoi faire.
        raise ItemLockedByBookings(item.id) from error

    # `updated_at` a un `onupdate` côté serveur : l'attribut est expiré après
    # l'UPDATE, et le relire déclencherait une IO implicite, interdite en async.
    await session.refresh(item)
    return item


async def delete_item(session: AsyncSession, *, item: CatalogItem) -> None:
    """Un item réservé ne se supprime pas. Il se désactive."""
    if await _has_bookings_including_variants(session, item.id):
        raise ItemHasBookings(item.id)

    try:
        async with session.begin_nested():
            await session.delete(item)
            await session.flush()
    except IntegrityError as error:
        # Filet du RESTRICT posé par `booking`.
        raise ItemHasBookings(item.id) from error
