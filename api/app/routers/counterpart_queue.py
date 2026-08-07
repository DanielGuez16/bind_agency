"""Les deux files de contreparties : celle du commerce, celle de l'arbitre."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import CurrentBusiness, SessionDep, require_role
from app.models.enums import UserRole
from app.schemas.counterpart_queue import LigneDeFileRead
from app.services import collaboration as service

business_router = APIRouter(prefix="/business", tags=["collaborations"])

admin_router = APIRouter(
    prefix="/admin/collaborations",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)


@business_router.get("/{business_id}/collaborations", response_model=list[LigneDeFileRead])
async def list_for_business(
    business: CurrentBusiness,
    session: SessionDep,
    filtre: Annotated[service.FiltreDeContrepartie | None, Query()] = None,
    limite: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[LigneDeFileRead]:
    """Les contreparties du commerce, triées par échéance.

    L'isolation ne tient pas à un filtre écrit ici : `business` vient du
    résolveur d'appartenance, qui a déjà refusé un membre d'un autre commerce.

    Sans `filtre`, la liste rend tout. C'est délibéré : les trois onglets ne
    couvrent pas `unfulfilled`, et lier la lecture aux onglets ferait
    disparaître de l'interface un statut qui existe en base.
    """
    lignes = await service.lister_pour_le_commerce(
        session, business_id=business.id, filtre=filtre, limite=limite
    )
    return [LigneDeFileRead.model_validate(ligne) for ligne in lignes]


@admin_router.get("/review", response_model=list[LigneDeFileRead])
async def list_human_review(
    session: SessionDep,
    limite: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[LigneDeFileRead]:
    """Les dossiers sortis de la boucle automatique, échéance la plus proche en tête."""
    lignes = await service.file_de_revue_humaine(session, limite=limite)
    return [LigneDeFileRead.model_validate(ligne) for ligne in lignes]
