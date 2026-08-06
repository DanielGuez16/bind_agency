"""Réservation."""

from fastapi import APIRouter, Depends, status

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models.enums import UserRole
from app.schemas.booking import BookingCreate, BookingRead
from app.services import booking as service

router = APIRouter(
    prefix="/bookings",
    tags=["bookings"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)

_CODES = {
    service.OfferNotBookable: (status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_OFFER_NOT_BOOKABLE),
    service.TierNotAccessible: (status.HTTP_403_FORBIDDEN, ErrorCode.BOOKING_TIER_NOT_ACCESSIBLE),
    service.NameRequired: (status.HTTP_409_CONFLICT, ErrorCode.BOOKING_NAME_REQUIRED),
    service.SlotRequired: (status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.BOOKING_SLOT_REQUIRED),
    service.SlotNotAllowed: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.BOOKING_SLOT_NOT_ALLOWED,
    ),
    # 409 et non 404 : le créneau existait, il vient d'être pris. Le créateur
    # doit comprendre qu'il a perdu la course, pas que l'offre a disparu.
    service.SlotUnavailable: (status.HTTP_409_CONFLICT, ErrorCode.BOOKING_SLOT_UNAVAILABLE),
}


@router.post("", response_model=BookingRead, status_code=status.HTTP_201_CREATED)
async def create_booking(
    payload: BookingCreate, user: CurrentUser, session: SessionDep
) -> BookingRead:
    try:
        reservation = await service.creer(
            session,
            creator_id=user.id,
            demande=service.DemandeDeReservation(
                tier_offer_id=payload.tier_offer_id,
                social_account_id=payload.social_account_id,
                starts_at=payload.starts_at,
            ),
        )
    except service.BookingError as error:
        http_status, code = _CODES[type(error)]
        raise api_error(http_status, code) from error

    await session.commit()
    return BookingRead.model_validate(reservation)
