"""Transitions d'une réservation.

Le créateur confirme et annule sur ses propres réservations : l'appartenance se
lit sur `creator_id`, pas sur le chemin. Le commerce tranche, se désiste et
constate l'absence sur les siennes, via le résolveur d'appartenance — c'est
exactement le cas pour lequel il a été écrit, une ressource sans `business_id`
dans l'URL.

**Trois routes distinctes pour le commerce, pas une seule avec un verbe en
corps.** Accepter, refuser et se désister n'ont ni les mêmes conditions
d'entrée, ni les mêmes exigences, ni les mêmes conséquences : une route unique
demanderait de lire le corps pour savoir ce qui est permis, et le jour où l'une
gagne une règle, les trois la porteraient.
"""

import logging
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
from app.services import notifications, outbox
from app.services.audit import Actor

logger = logging.getLogger(__name__)

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
    service.AbsenceTropTot: (
        status.HTTP_409_CONFLICT,
        ErrorCode.BOOKING_NO_SHOW_TOO_EARLY,
    ),
    # `NotYours` répond comme une réservation absente : distinguer les deux
    # dirait à un créateur quels identifiants appartiennent à un autre.
    service.NotYours: (status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND),
    service.NotYourBusiness: (status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND),
    service.MotifRequis: (status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED),
    service.CreneauDepasse: (
        status.HTTP_409_CONFLICT,
        ErrorCode.BOOKING_SLOT_ELAPSED,
    ),
}


class MotifDuCommerce(BaseModel):
    """Refuser ou se désister : le créateur lira ce motif, il est obligatoire.

    Exigé ici **et** dans le service. Le schéma protège la route, le service
    protège la règle — une seconde route ajoutée demain ne doit pas pouvoir
    s'en passer.
    """

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)


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


async def _deposer_l_annonce(session, reservation: Booking, cle: str, *, motif: str = "") -> None:
    """Dépose l'annonce dans la boîte d'envoi, **avant le commit**.

    C'est tout l'intérêt : le commit qui écrit la décision écrit le message. Ou
    les deux existent, ou aucun — il n'y a plus de fenêtre où un créateur est
    refusé sans jamais l'apprendre parce que le processus est mort entre les
    deux, ni de requête qui attend vingt secondes un service d'envoi dont celui
    qui tranche n'a rien à faire.

    Un échec ici est une erreur de programmation — une clé sans genre — et non
    une panne réseau : il n'y a rien à avaler.
    """
    contexte = await notifications.contexte_de_reservation(session, reservation, motif=motif)
    if contexte is None:
        # Compte anonymisé : il n'y a personne à prévenir, et déposer un
        # message pour un destinataire qui n'existe plus remplirait la boîte de
        # lignes qu'aucun balayage ne pourrait fermer autrement qu'en les
        # écartant.
        return

    await outbox.deposer(
        session,
        user_id=contexte.user_id,
        cle=cle,
        creator=contexte.creator,
        business=contexte.business,
        item=contexte.item,
        quand=contexte.quand,
        motif=contexte.motif,
    )


@router.post("/{booking_id}/approve", response_model=BookingRead)
async def approve(
    booking_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: CurrentUser,
    membership: MembershipFor("booking", param="booking_id"),
) -> BookingRead:
    """Le commerce accepte. Aucun motif : il n'y a rien à justifier à dire oui."""
    reservation = await _reservation(session, booking_id)
    try:
        await service.trancher(
            session,
            booking=reservation,
            business_id=membership.business_id,
            user_id=user.id,
            accepte=True,
        )
    except service.BookingStateError as error:
        raise _traduire(error) from error

    await _deposer_l_annonce(session, reservation, "booking.approved")
    await session.commit()
    return BookingRead.model_validate(reservation)


@router.post("/{booking_id}/decline", response_model=BookingRead)
async def decline(
    booking_id: Annotated[uuid.UUID, Path()],
    payload: MotifDuCommerce,
    session: SessionDep,
    user: CurrentUser,
    membership: MembershipFor("booking", param="booking_id"),
) -> BookingRead:
    """Le commerce refuse. Le créateur lira ce motif."""
    reservation = await _reservation(session, booking_id)
    try:
        await service.trancher(
            session,
            booking=reservation,
            business_id=membership.business_id,
            user_id=user.id,
            accepte=False,
            motif=payload.reason,
        )
    except service.BookingStateError as error:
        raise _traduire(error) from error

    await _deposer_l_annonce(session, reservation, "booking.declined", motif=payload.reason)
    await session.commit()
    return BookingRead.model_validate(reservation)


@router.post("/{booking_id}/cancel-by-business", response_model=BookingRead)
async def cancel_by_business(
    booking_id: Annotated[uuid.UUID, Path()],
    payload: MotifDuCommerce,
    session: SessionDep,
    user: CurrentUser,
    membership: MembershipFor("booking", param="booking_id"),
) -> BookingRead:
    """Technicienne absente, fermeture imprévue.

    Distincte de `/no-show` et ce n'est pas une nuance de vocabulaire : l'une
    pénalise le créateur, l'autre non. Les confondre dans une route unique
    ferait de la pénalité une case à cocher.
    """
    reservation = await _reservation(session, booking_id)
    try:
        await service.annuler_par_le_commerce(
            session,
            booking=reservation,
            business_id=membership.business_id,
            user_id=user.id,
            motif=payload.reason,
        )
    except service.BookingStateError as error:
        raise _traduire(error) from error

    await _deposer_l_annonce(
        session, reservation, "booking.cancelledByBusiness", motif=payload.reason
    )
    await session.commit()
    return BookingRead.model_validate(reservation)
