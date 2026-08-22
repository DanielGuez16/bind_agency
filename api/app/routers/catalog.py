"""Catalogue d'un commerce.

L'appartenance est portée par `CurrentBusiness` : aucune vérification de droits
n'est écrite ici. Les routes traduisent les erreurs du service en codes du
catalogue, et rien d'autre.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.models import CatalogItem
from app.schemas.catalog import CatalogItemCreate, CatalogItemRead, CatalogItemUpdate
from app.services import catalog as catalog_service
from app.services.audit import Actor

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
    catalog_service.ItemDejaArchive: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CATALOG_ITEM_ALREADY_ARCHIVED,
    ),
}


def _translate(error: catalog_service.CatalogError):
    http_status, code = _ERROR_CODES[type(error)]
    return api_error(http_status, code)


def _to_read(
    item: CatalogItem, *, effectively_available: bool, reservations: int = 0
) -> CatalogItemRead:
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
        leaves_choice=item.leaves_choice,
        source=item.source,
        is_available=item.is_available,
        is_effectively_available=effectively_available,
        archived_at=item.archived_at,
        reservations_count=reservations,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


async def _read(session: AsyncSession, item: CatalogItem) -> CatalogItemRead:
    availability = await catalog_service.effective_availability(session, [item])
    reservations = await catalog_service.reservations_par_item(session, [item.id])
    return _to_read(
        item,
        effectively_available=availability[item.id],
        reservations=reservations.get(item.id, 0),
    )


@router.get("", response_model=list[CatalogItemRead])
async def list_items(
    business: CurrentBusiness,
    session: SessionDep,
    avec_archives: Annotated[bool, Query()] = False,
) -> list[CatalogItemRead]:
    """La liste que le salon travaille. **Sans les archives**, par défaut.

    Une archive n'a plus rien à recevoir, et la laisser ferait grossir l'écran
    de composition avec des prestations qu'on ne compose plus. Elle reste
    atteignable depuis la réservation qui la cite — c'est là qu'elle a encore
    quelque chose à dire — et `avec_archives` la ramène pour l'écran qui les
    montre exprès.
    """
    items = await catalog_service.list_items(session, business.id, avec_archives=avec_archives)
    availability = await catalog_service.effective_availability(session, items)
    reservations = await catalog_service.reservations_par_item(session, [i.id for i in items])
    return [
        _to_read(
            item,
            effectively_available=availability[item.id],
            reservations=reservations.get(item.id, 0),
        )
        for item in items
    ]


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


@router.post("/{item_id}/archive", response_model=CatalogItemRead)
async def archive_item(
    item_id: uuid.UUID,
    business: CurrentBusiness,
    user: CurrentUser,
    session: SessionDep,
) -> CatalogItemRead:
    """Retire la prestation du catalogue **pour de bon**.

    **Archiver n'est pas fermer.** `PATCH {is_available: false}` dit « pas en ce
    moment » — la prestation saisonnière qu'on rouvrira en septembre. Ceci dit
    « plus jamais », et l'écran a besoin des deux.

    Une archive quitte la liste de travail et tous les fils, reste atteignable
    depuis la réservation qui la cite, et **ne se rouvre pas**. Le salon qui
    veut la refaire en crée une neuve — ou emprunte `/replace`, qui fait les
    deux gestes d'un coup.

    C'est le seul chemin pour une prestation déjà réservée : `DELETE` la refuse,
    et il a raison — supprimer effacerait le texte d'un accord tenu.
    """
    try:
        item = await catalog_service.get_item(session, business.id, item_id)
        archivee = await catalog_service.archiver(session, item=item, actor=Actor.from_user(user))
    except catalog_service.CatalogError as error:
        raise _translate(error) from error

    await session.commit()
    return await _read(session, archivee)


@router.post("/{item_id}/replace", response_model=CatalogItemRead, status_code=201)
async def replace_item(
    item_id: uuid.UUID,
    payload: CatalogItemCreate,
    business: CurrentBusiness,
    user: CurrentUser,
    session: SessionDep,
) -> CatalogItemRead:
    """Crée la prestation qui succède, et archive celle qu'elle remplace.

    **Pour ce qui est l'accord et non la présentation.** La photo,
    l'orthographe et la description s'éditent en place par `PATCH` — elles ne
    changent rien à ce qui a été convenu. La durée, le palier et la contrepartie
    sont l'accord : douze réservations citent une prestation de quarante-cinq
    minutes, et la passer à soixante-quinze leur ferait dire ce qui n'a pas eu
    lieu.

    Les deux gestes dans une transaction, et c'est tout l'intérêt : les séparer
    laisserait un salon avec deux prestations vivantes s'il ferme l'écran entre
    les deux, ou aucune dans l'autre ordre.

    Rend la **nouvelle** prestation : c'est celle sur laquelle le salon
    continue, et celle dont il a besoin pour composer ses offres de palier.
    """
    try:
        ancienne = await catalog_service.get_item(session, business.id, item_id)
        nouvelle = await catalog_service.remplacer(
            session,
            business=business,
            item=ancienne,
            payload=payload,
            actor=Actor.from_user(user),
        )
    except catalog_service.CatalogError as error:
        raise _translate(error) from error

    await session.commit()
    return await _read(session, nouvelle)
