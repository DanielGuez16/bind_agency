"""Signaler un déplacement pour rien, et l'arbitrer.

Deux côtés : le créateur signale sur **sa** réservation, l'administration
tranche. Le salon n'a pas de route ici — il n'a rien à faire d'un signalement
tant qu'il n'est pas arbitré, et le lui montrer avant ferait discuter d'une
allégation au lieu d'un fait.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models import Booking, VenueReport
from app.models.enums import UserRole
from app.schemas.venue_report import (
    DecisionDeSignalement,
    LigneDeSignalementRead,
    SignalementDemande,
    SignalementRead,
)
from app.services import venue_report as service

creator_router = APIRouter(
    prefix="/bookings",
    tags=["venue-reports"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)
admin_router = APIRouter(
    prefix="/admin",
    tags=["venue-reports"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)

#: Chaque refus a son code. Un 409 muet laisserait l'app écrire « quelque chose
#: s'est mal passé » à quelqu'un qui vient de se déplacer pour rien.
_CODES = {
    service.BookingNotReportable: (status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND),
    service.OutsideReportWindow: (
        status.HTTP_409_CONFLICT,
        ErrorCode.VENUE_REPORT_OUTSIDE_WINDOW,
    ),
    service.AlreadyReported: (status.HTTP_409_CONFLICT, ErrorCode.VENUE_REPORT_ALREADY_EXISTS),
    service.ReportNotPending: (status.HTTP_409_CONFLICT, ErrorCode.VENUE_REPORT_NOT_PENDING),
}


def _traduire(erreur: Exception):
    http_status, code = _CODES[type(erreur)]
    return api_error(http_status, code)


@creator_router.post("/{booking_id}/venue-report", response_model=SignalementRead)
async def report_venue(
    booking_id: Annotated[uuid.UUID, Path()],
    payload: SignalementDemande,
    user: CurrentUser,
    session: SessionDep,
) -> SignalementRead:
    """« Je me suis déplacé, c'était fermé. »

    **Ne pénalise jamais celui qui signale.** La réservation part en
    `cancelled`, jamais en `no_show` : c'est la règle de `SPEC.md` §4.1 pour
    toute défaillance qui ne vient pas du créateur, et un recours qui coûterait
    quelque chose ne serait pas un recours.
    """
    reservation = await session.get(Booking, booking_id)
    if reservation is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND)

    try:
        signalement = await service.signaler(
            session,
            booking=reservation,
            creator_id=user.id,
            note=(payload.note or "").strip() or None,
        )
    except service.VenueReportError as erreur:
        raise _traduire(erreur) from erreur

    await session.commit()
    return SignalementRead.model_validate(signalement)


@admin_router.get("/venue-reports", response_model=list[LigneDeSignalementRead])
async def read_queue(session: SessionDep) -> list[LigneDeSignalementRead]:
    """Ce qui attend une décision, du plus ancien au plus récent."""
    return [
        LigneDeSignalementRead.model_validate(ligne)
        for ligne in await service.file_d_arbitrage(session)
    ]


@admin_router.post("/venue-reports/{report_id}/decision", response_model=SignalementRead)
async def decide(
    report_id: Annotated[uuid.UUID, Path()],
    payload: DecisionDeSignalement,
    user: CurrentUser,
    session: SessionDep,
) -> SignalementRead:
    """Retenu, ou écarté. **Le seul endroit où un signalement compte.**

    Tant qu'il est en attente, il ne pèse ni contre le salon — qui n'a pas été
    entendu — ni contre le créateur, qui n'a fait que dire ce qu'il a vu.
    """
    signalement = await session.get(VenueReport, report_id)
    if signalement is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND)

    try:
        tranche = await service.arbitrer(
            session, signalement=signalement, retenu=payload.retenu, arbitre=user
        )
    except service.VenueReportError as erreur:
        raise _traduire(erreur) from erreur

    await session.commit()
    return SignalementRead.model_validate(tranche)
