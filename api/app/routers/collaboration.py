"""Contrepartie : ce que le créateur soumet, ce que le commerce décide.

**Le commerce approuve ou redemande. Il ne rejette pas.** Il n'existe pas de
statut de litige : un refus de conformité rouvre avec une nouvelle échéance, et
la troisième tentative lève un drapeau de revue humaine sans trancher. Offrir
un bouton « rejeter » ferait fermer des dossiers qu'on ne saurait plus rouvrir.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.core.dependencies import CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.core.membership import require_member_of
from app.models import Booking, Collaboration
from app.models.enums import UserRole
from app.schemas.collaboration import (
    CollaborationRead,
    DecisionCommerce,
    PreuveSoumise,
)
from app.services import collaboration as service
from app.services import proof as proof_service
from app.services.audit import Actor
from app.services.storage import archiver_la_publication

router = APIRouter(tags=["collaborations"])

_CODES = {
    service.TransitionNotAllowed: (
        status.HTTP_409_CONFLICT,
        ErrorCode.COLLABORATION_TRANSITION_NOT_ALLOWED,
    ),
    proof_service.CollaborationNotOpen: (
        status.HTTP_409_CONFLICT,
        ErrorCode.COLLABORATION_NOT_OPEN,
    ),
    proof_service.NothingArchived: (
        status.HTTP_502_BAD_GATEWAY,
        ErrorCode.PROOF_NOTHING_ARCHIVED,
    ),
}


def _traduire(error: Exception):
    http_status, code = _CODES[type(error)]
    return api_error(http_status, code)


async def _sienne(session, collaboration_id: uuid.UUID, creator_id: uuid.UUID) -> Collaboration:
    """La contrepartie du créateur, ou un 404 indistinct.

    « Elle existe mais pas à vous » dirait à un créateur quels identifiants
    appartiennent à un autre.
    """
    ligne = await session.get(Collaboration, collaboration_id)
    if ligne is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.COLLABORATION_NOT_FOUND)

    booking = await session.get(Booking, ligne.booking_id)
    if booking is None or booking.creator_id != creator_id:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.COLLABORATION_NOT_FOUND)
    return ligne


async def _lire(session, ligne: Collaboration) -> CollaborationRead:
    return CollaborationRead.assembler(ligne, await proof_service.preuves_de(session, ligne.id))


@router.get("/collaborations/{collaboration_id}", response_model=CollaborationRead)
async def read_collaboration(
    collaboration_id: Annotated[uuid.UUID, Path()], user: CurrentUser, session: SessionDep
) -> CollaborationRead:
    """Lisible par le créateur. Le commerce a sa propre route, par appartenance."""
    if user.role is not UserRole.CREATOR:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE)

    return await _lire(session, await _sienne(session, collaboration_id, user.id))


@router.post("/collaborations/{collaboration_id}/proof", response_model=CollaborationRead)
async def submit_proof(
    collaboration_id: Annotated[uuid.UUID, Path()],
    payload: PreuveSoumise,
    user: CurrentUser,
    session: SessionDep,
) -> CollaborationRead:
    """Archive la publication au meilleur niveau atteignable.

    L'ordre de préférence est tenté ici et nulle part ailleurs : l'appelant ne
    choisit pas son niveau de preuve, sinon tout le monde enverrait une capture
    d'écran.
    """
    if user.role is not UserRole.CREATOR:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE)

    ligne = await _sienne(session, collaboration_id, user.id)
    booking = await session.get(Booking, ligne.booking_id)

    capture = await archiver_la_publication(
        session,
        social_account_id=booking.social_account_id,
        source_url=payload.source_url,
        screenshot_key=payload.screenshot_key,
    )
    if capture is None:
        raise api_error(status.HTTP_502_BAD_GATEWAY, ErrorCode.PROOF_NOTHING_ARCHIVED)

    if await proof_service.deja_soumise(
        session, collaboration_id=ligne.id, contenu=capture.contenu
    ):
        # Renvoyer la même capture après un refus n'est pas une correction.
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.PROOF_ALREADY_SUBMITTED)

    try:
        await proof_service.soumettre(
            session,
            collaboration=ligne,
            capture=capture,
            actor=Actor.from_user(user),
            note=(payload.note or "").strip() or None,
        )
    except (proof_service.ProofError, service.CollaborationError) as error:
        raise _traduire(error) from error

    await session.commit()
    return await _lire(session, ligne)


@router.post(
    "/business/collaborations/{collaboration_id}/decision", response_model=CollaborationRead
)
async def decide(
    collaboration_id: Annotated[uuid.UUID, Path()],
    payload: DecisionCommerce,
    user: CurrentUser,
    session: SessionDep,
    membership: Annotated[
        object, Depends(require_member_of("collaboration", param="collaboration_id"))
    ],
) -> CollaborationRead:
    """Approuver, ou redemander avec un motif.

    Le motif est exigé quand on redemande : un créateur à qui l'on dit
    « non conforme » sans dire pourquoi refera la même chose.
    """
    ligne = await session.get(Collaboration, collaboration_id)
    if ligne is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.COLLABORATION_NOT_FOUND)

    if not payload.approuve and not (payload.reason or "").strip():
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED)

    try:
        if payload.approuve:
            await service.approuver(session, collaboration=ligne, actor=Actor.from_user(user))
        else:
            await service.demander_une_nouvelle_soumission(
                session,
                collaboration=ligne,
                actor=Actor.from_user(user),
                reason=payload.reason,
                note=(payload.note or "").strip() or None,
            )
    except service.CollaborationError as error:
        raise _traduire(error) from error

    await session.commit()
    _ = membership
    return await _lire(session, ligne)
