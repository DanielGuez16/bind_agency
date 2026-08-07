"""Ce que le créateur lit de son propre compte."""

from fastapi import APIRouter, Depends

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.models.enums import UserRole
from app.schemas.audience import AudienceDuCompteRead, VerificationDuCompteRead
from app.services import audience as service

router = APIRouter(
    prefix="/me",
    tags=["creator"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)


@router.get("/audience", response_model=list[AudienceDuCompteRead])
async def read_audience(user: CurrentUser, session: SessionDep) -> list[AudienceDuCompteRead]:
    """Ses abonnés, depuis le dernier relevé, datés. C'est sa donnée."""
    return [
        AudienceDuCompteRead.model_validate(compte)
        for compte in await service.audience(session, creator_id=user.id)
    ]


@router.get("/verification", response_model=list[VerificationDuCompteRead])
async def read_verification(
    user: CurrentUser, session: SessionDep
) -> list[VerificationDuCompteRead]:
    """L'état du contrôle : date de démarrage, signaux jugés, aucun délai promis."""
    return [
        VerificationDuCompteRead.model_validate(compte)
        for compte in await service.verification(session, creator_id=user.id)
    ]
