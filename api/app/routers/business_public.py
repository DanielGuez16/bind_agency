"""Fiche publique d'un commerce, lue par un créateur authentifié.

Sur `/businesses/{id}` et non `/business/{id}` : le second est l'espace du
commerçant, protégé par le résolveur d'appartenance. Les deux n'ont pas les
mêmes règles d'accès et n'ont rien à faire sur le même chemin.
"""

import uuid

from fastapi import APIRouter, Depends, status

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models.enums import UserRole
from app.schemas.business_public import FichePubliqueRead
from app.services import business_public as service

router = APIRouter(
    prefix="/businesses",
    tags=["feed"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)


@router.get("/{business_id}", response_model=FichePubliqueRead)
async def read_public(
    business_id: uuid.UUID, user: CurrentUser, session: SessionDep
) -> FichePubliqueRead:
    try:
        fiche = await service.fiche(session, business_id=business_id, creator_id=user.id)
    except service.BusinessNotPublic as error:
        # 404 et non 403 : il n'y a pas de droit à refuser, la ressource n'est
        # pas publiée. Le commerce absent et le commerce inactif se répondent
        # pareil, ce qui ne divulgue aucun identifiant.
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BUSINESS_NOT_FOUND) from error
    return FichePubliqueRead.model_validate(fiche)
