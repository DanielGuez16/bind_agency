"""Composition des offres d'un commerce."""

import uuid

from fastapi import APIRouter, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.models import TierOffer
from app.schemas.tier_offers import TierOfferActivation, TierOfferCreate, TierOfferRead
from app.services import tier_offers as offer_service
from app.services.audit import Actor

router = APIRouter(prefix="/business/{business_id}/tier-offers", tags=["tier-offers"])

_ERROR_CODES = {
    offer_service.OfferNotFound: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.TIER_OFFER_NOT_FOUND,
    ),
    offer_service.OfferAlreadyExists: (
        status.HTTP_409_CONFLICT,
        ErrorCode.TIER_OFFER_ALREADY_EXISTS,
    ),
    offer_service.ParentNotAllowed: (
        status.HTTP_409_CONFLICT,
        ErrorCode.TIER_OFFER_PARENT_NOT_ALLOWED,
    ),
    offer_service.TierInactive: (
        status.HTTP_409_CONFLICT,
        ErrorCode.TIER_OFFER_TIER_INACTIVE,
    ),
    offer_service.OfferHasBookings: (
        status.HTTP_409_CONFLICT,
        ErrorCode.TIER_OFFER_HAS_BOOKINGS,
    ),
    offer_service.CarteManquante: (
        status.HTTP_409_CONFLICT,
        ErrorCode.TIER_OFFER_MENU_REQUIRED,
    ),
}


def _translate(error: offer_service.TierOfferError):
    http_status, code = _ERROR_CODES[type(error)]
    return api_error(http_status, code)


async def _read(session: AsyncSession, offers: list[TierOffer]) -> list[TierOfferRead]:
    details = await offer_service.describe(session, offers)
    return [
        TierOfferRead(
            id=offer.id,
            business_id=offer.business_id,
            tier_id=offer.tier_id,
            catalog_item_id=offer.catalog_item_id,
            is_active=offer.is_active,
            created_at=offer.created_at,
            **details[offer.id],
        )
        for offer in offers
    ]


@router.get("", response_model=list[TierOfferRead])
async def list_offers(business: CurrentBusiness, session: SessionDep) -> list[TierOfferRead]:
    offers = await offer_service.list_offers(session, business.id)
    return await _read(session, offers)


@router.post("", response_model=TierOfferRead, status_code=status.HTTP_201_CREATED)
async def create_offer(
    payload: TierOfferCreate, business: CurrentBusiness, session: SessionDep
) -> TierOfferRead:
    try:
        offer = await offer_service.create_offer(session, business_id=business.id, payload=payload)
    except offer_service.TierOfferError as error:
        raise _translate(error) from error

    await session.commit()
    return (await _read(session, [offer]))[0]


@router.put("/{offer_id}/activation", response_model=TierOfferRead)
async def set_activation(
    offer_id: uuid.UUID,
    payload: TierOfferActivation,
    business: CurrentBusiness,
    user: CurrentUser,
    session: SessionDep,
) -> TierOfferRead:
    """Retirer sans supprimer : la seule voie possible quand l'offre est réservée."""
    try:
        offer = await offer_service.get_offer(session, business.id, offer_id)
    except offer_service.TierOfferError as error:
        raise _translate(error) from error

    await offer_service.set_active(
        session, offer=offer, is_active=payload.is_active, actor=Actor.from_user(user)
    )
    await session.commit()
    return (await _read(session, [offer]))[0]


@router.delete("/{offer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_offer(offer_id: uuid.UUID, business: CurrentBusiness, session: SessionDep) -> None:
    try:
        offer = await offer_service.get_offer(session, business.id, offer_id)
        await offer_service.delete_offer(session, offer=offer)
    except offer_service.TierOfferError as error:
        raise _translate(error) from error

    await session.commit()
