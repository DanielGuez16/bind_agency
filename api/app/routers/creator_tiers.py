"""Écran des paliers accessibles."""

from fastapi import APIRouter, Depends

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.models.enums import UserRole
from app.schemas.creator_tiers import VueDesPaliersRead
from app.services import creator_tiers as service

router = APIRouter(
    prefix="/me/tiers",
    tags=["creator-tiers"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)


@router.get("", response_model=VueDesPaliersRead)
async def read_tiers(user: CurrentUser, session: SessionDep) -> VueDesPaliersRead:
    """Le résultat n'est pas mis en cache : il dépend de l'âge des relevés,
    donc du moment. Le cacher ressusciterait les chiffres périmés que la
    condition de fraîcheur cherche à écarter."""
    return VueDesPaliersRead.model_validate(await service.vue_des_paliers(session, user.id))
