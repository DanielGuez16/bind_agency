"""Catalogue d'un commerce.

L'appartenance est portée par `CurrentBusiness` : aucune vérification de droits
n'est écrite ici. Les routes traduisent les erreurs du service en codes du
catalogue, et rien d'autre.
"""

import uuid

from fastapi import APIRouter, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentBusiness, SessionDep
from app.core.errors import ErrorCode, api_error
from app.models import CatalogItem
from app.schemas.catalog import CatalogItemCreate, CatalogItemRead, CatalogItemUpdate
from app.services import catalog as catalog_service

router = APIRouter(prefix="/business/{business_id}/catalog-items", tags=["catalog"])

_ERROR_CODES = {
    catalog_service.ItemNotFound: (status.HTTP_404_NOT_FOUND, ErrorCode.CATALOG_ITEM_NOT_FOUND),
    catalog_service.DurationMismatch: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.CATALOG_DURATION_MISMATCH,
    ),
    catalog_service.ParentNotFound: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.CATALOG_PARENT_NOT_FOUND,
    ),
    catalog_service.ParentMustNotBeBookable: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CATALOG_PARENT_MUST_NOT_BE_BOOKABLE,
    ),
    catalog_service.VariantDepthExceeded: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.CATALOG_VARIANT_DEPTH_EXCEEDED,
    ),
    catalog_service.ItemLockedByBookings: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CATALOG_ITEM_LOCKED_BY_BOOKINGS,
    ),
    catalog_service.ItemHasBookings: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CATALOG_ITEM_HAS_BOOKINGS,
    ),
}


def _translate(error: catalog_service.CatalogError):
    http_status, code = _ERROR_CODES[type(error)]
    return api_error(http_status, code)


def _to_read(item: CatalogItem, *, effectively_available: bool) -> CatalogItemRead:
    return CatalogItemRead(
        id=item.id,
        business_id=item.business_id,
        parent_item_id=item.parent_item_id,
        name=item.name,
        description=item.description,
        price_cents=item.price_cents,
        duration_minutes=item.duration_minutes,
        requires_booking=item.requires_booking,
        photo_key=item.photo_key,
        source=item.source,
        is_available=item.is_available,
        is_effectively_available=effectively_available,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


async def _read(session: AsyncSession, item: CatalogItem) -> CatalogItemRead:
    availability = await catalog_service.effective_availability(session, [item])
    return _to_read(item, effectively_available=availability[item.id])


@router.get("", response_model=list[CatalogItemRead])
async def list_items(business: CurrentBusiness, session: SessionDep) -> list[CatalogItemRead]:
    items = await catalog_service.list_items(session, business.id)
    availability = await catalog_service.effective_availability(session, items)
    return [_to_read(item, effectively_available=availability[item.id]) for item in items]


@router.post("", response_model=CatalogItemRead, status_code=status.HTTP_201_CREATED)
async def create_item(
    payload: CatalogItemCreate, business: CurrentBusiness, session: SessionDep
) -> CatalogItemRead:
    try:
        item = await catalog_service.create_item(session, business=business, payload=payload)
    except catalog_service.CatalogError as error:
        raise _translate(error) from error

    await session.commit()
    return await _read(session, item)


@router.get("/{item_id}", response_model=CatalogItemRead)
async def read_item(
    item_id: uuid.UUID, business: CurrentBusiness, session: SessionDep
) -> CatalogItemRead:
    try:
        item = await catalog_service.get_item(session, business.id, item_id)
    except catalog_service.CatalogError as error:
        raise _translate(error) from error

    return await _read(session, item)


@router.patch("/{item_id}", response_model=CatalogItemRead)
async def update_item(
    item_id: uuid.UUID,
    payload: CatalogItemUpdate,
    business: CurrentBusiness,
    session: SessionDep,
) -> CatalogItemRead:
    try:
        item = await catalog_service.get_item(session, business.id, item_id)
        await catalog_service.update_item(session, item=item, payload=payload)
    except catalog_service.CatalogError as error:
        raise _translate(error) from error

    await session.commit()
    return await _read(session, item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: uuid.UUID, business: CurrentBusiness, session: SessionDep) -> None:
    try:
        item = await catalog_service.get_item(session, business.id, item_id)
        await catalog_service.delete_item(session, item=item)
    except catalog_service.CatalogError as error:
        raise _translate(error) from error

    await session.commit()
