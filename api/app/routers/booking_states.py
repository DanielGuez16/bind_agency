"""Transitions d'une réservation.

Le créateur confirme et annule sur ses propres réservations : l'appartenance se
lit sur `creator_id`, pas sur le chemin. Le commerce constate l'absence sur les
siennes, via le résolveur d'appartenance — c'est exactement le cas pour lequel
il a été écrit, une ressource sans `business_id` dans l'URL.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.core.membership import MembershipFor
from app.models import Booking
from app.models.enums import UserRole
from app.schemas.booking import BookingRead
from app.services import booking_states as service
from app.services.audit import Actor

router = APIRouter(prefix="/bookings", tags=["bookings"])

_CODES = {
    service.TransitionNotAllowed: (
        status.HTTP_409_CONFLICT,
        ErrorCode.BOOKING_TRANSITION_NOT_ALLOWED,
    ),
    service.HoldExpired: (status.HTTP_409_CONFLICT, ErrorCode.BOOKING_HOLD_EXPIRED),
    service.NoShowNotApplicable: (
        status.HTTP_409_CONFLICT,
        ErrorCode.BOOKING_NO_SHOW_NOT_APPLICABLE,
    ),
    # `NotYours` répond comme une réservation absente : distinguer les deux
    # dirait à un créateur quels identifiants appartiennent à un autre.
    service.NotYours: (status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND),
}


class MotifAbsence(BaseModel):
    """Constater une absence pénalise quelqu'un : le motif est obligatoire."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)


def _traduire(error: service.BookingStateError):
    http_status, code = _CODES[type(error)]
    return api_error(http_status, code)


async def _reservation(session: SessionDep, booking_id: uuid.UUID) -> Booking:
    reservation = await session.get(Booking, booking_id)
    if reservation is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND)
    return reservation


@router.post(
    "/{booking_id}/confirm",
    response_model=BookingRead,
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)
async def confirm(
    booking_id: Annotated[uuid.UUID, Path()], user: CurrentUser, session: SessionDep
) -> BookingRead:
    reservation = await _reservation(session, booking_id)
    try:
        await service.confirmer(session, booking=reservation, creator_id=user.id)
    except service.BookingStateError as error:
        raise _traduire(error) from error

    await session.commit()
    return BookingRead.model_validate(reservation)


@router.post(
    "/{booking_id}/cancel",
    response_model=BookingRead,
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)
async def cancel(
    booking_id: Annotated[uuid.UUID, Path()], user: CurrentUser, session: SessionDep
) -> BookingRead:
    """L'issue dépend du délai, pas de ce que demande l'appelant : au-delà de la
    fenêtre, une annulation est un `no_show`. Laisser choisir reviendrait à
    laisser échapper à la pénalité."""
    reservation = await _reservation(session, booking_id)
    try:
        await service.annuler(session, booking=reservation, creator_id=user.id)
    except service.BookingStateError as error:
        raise _traduire(error) from error

    await session.commit()
    return BookingRead.model_validate(reservation)


@router.post("/{booking_id}/no-show", response_model=BookingRead)
async def mark_no_show(
    booking_id: Annotated[uuid.UUID, Path()],
    payload: MotifAbsence,
    session: SessionDep,
    user: CurrentUser,
    membership: MembershipFor("booking", param="booking_id"),
) -> BookingRead:
    reservation = await _reservation(session, booking_id)
    try:
        await service.marquer_absent(
            session,
            booking=reservation,
            actor=Actor.from_user(user),
            reason=payload.reason,
        )
    except service.BookingStateError as error:
        raise _traduire(error) from error

    await session.commit()
    return BookingRead.model_validate(reservation)
