"""File d'administration de la vérification de cohérence.

Tout est sous `require_role(ADMIN)`. C'est le seul chemin vers `rejected`, et le
seul qui puisse redescendre un compte déjà `verified` : la réexécution
automatique ne fait jamais ni l'un ni l'autre.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models import SocialAccount
from app.models.enums import UserRole
from app.schemas.account_verification import (
    CompteEnRevue,
    ConstatRead,
    VerdictAdministrateur,
    VerificationRead,
)
from app.services import account_verification as service
from app.services.audit import Actor

router = APIRouter(
    prefix="/admin/social-accounts",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)


@router.get("/review", response_model=list[CompteEnRevue])
async def review_queue(session: SessionDep) -> list[CompteEnRevue]:
    """Les comptes en attente, chacun avec la raison de son attente."""
    return [
        CompteEnRevue.depuis(compte, coherence)
        for compte, coherence in await service.file_d_administration(session)
    ]


@router.post("/{account_id}/verification", response_model=VerificationRead)
async def prononcer(
    account_id: Annotated[uuid.UUID, Path()],
    payload: VerdictAdministrateur,
    session: SessionDep,
    admin: CurrentUser,
) -> VerificationRead:
    compte = await session.get(SocialAccount, account_id)
    if compte is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.SOCIAL_ACCOUNT_NOT_FOUND)

    try:
        coherence = await service.prononcer(
            session,
            account=compte,
            vers=payload.status,
            actor=Actor.from_user(admin),
            reason=payload.reason,
        )
    except service.TransitionNotAllowed as error:
        raise api_error(
            status.HTTP_409_CONFLICT, ErrorCode.VERIFICATION_TRANSITION_NOT_ALLOWED
        ) from error

    await session.commit()

    return VerificationRead(
        social_account_id=compte.id,
        verification_status=compte.verification_status,
        verification_reviewed_at=compte.verification_reviewed_at,
        constats=[ConstatRead.model_validate(c, from_attributes=True) for c in coherence.constats],
    )
