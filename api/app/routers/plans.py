"""Plans d'abonnement, en lecture, côté administrateur."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app.core.dependencies import SessionDep, require_role
from app.models.enums import UserRole
from app.schemas.plans import AbonneDuPlanRead, PlanAdministrateurRead
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


@router.get("/{plan_id}/businesses", response_model=list[AbonneDuPlanRead])
async def list_subscribers(
    plan_id: Annotated[uuid.UUID, Path()], session: SessionDep
) -> list[AbonneDuPlanRead]:
    """Qui paie ce plan, du plus ancien au plus récent.

    **La suite du chiffre, pas un écran de plus.** La grille annonce « douze
    abonnés » et l'administration décidait d'un prix sur ce nombre seul, sans
    pouvoir regarder qui il recouvre — douze salons d'un même quartier et douze
    salons répartis sur la ville ne disent pas la même chose du prix.

    Aucun montant ici : le prix est sur la ligne du plan, au-dessus.
    """
    return [
        AbonneDuPlanRead.model_validate(abonne)
        for abonne in await service.abonnes_du_plan(session, plan_id=plan_id)
    ]
