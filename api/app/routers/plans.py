"""Plans d'abonnement, en lecture, côté administrateur."""

from fastapi import APIRouter, Depends

from app.core.dependencies import SessionDep, require_role
from app.models.enums import UserRole
from app.schemas.plans import PlanAdministrateurRead
from app.services import plans as service

router = APIRouter(
    prefix="/admin/plans",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)


@router.get("", response_model=list[PlanAdministrateurRead])
async def list_plans(session: SessionDep) -> list[PlanAdministrateurRead]:
    """Le seul écran du produit qui affiche des montants."""
    return [PlanAdministrateurRead.model_validate(plan) for plan in await service.lister(session)]
