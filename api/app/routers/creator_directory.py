"""L'annuaire des créateurs, réservé aux commerces abonnés.

C'est ce que BIND vend : l'accès à un réseau. La barrière est donc la même que
la vente — un abonnement vivant — et non le simple fait d'être un commerce.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.dependencies import CurrentBusiness, SessionDep, require_role
from app.core.errors import ErrorCode
from app.models.enums import UserRole
from app.schemas.directory import CreateurVuRead
from app.services import directory as service
from app.services import subscription as subscription_service

router = APIRouter(
    prefix="/business/{business_id}/creators",
    tags=["directory"],
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))],
)


@router.get("", response_model=list[CreateurVuRead])
async def read_directory(business: CurrentBusiness, session: SessionDep) -> list[CreateurVuRead]:
    """**L'abonnement est vérifié ici et nulle part ailleurs.**

    Laisser l'écran décider s'il affiche l'annuaire mettrait la vente derrière
    une condition d'affichage : la route répondrait quand même, et il suffirait
    de la demander. Un commerce sans abonnement reçoit un refus, pas une liste
    vide — le vide se lit comme « aucun créateur », ce qui est un mensonge et un
    argument contre le produit.
    """
    abonnement = await subscription_service.courant(session, business_id=business.id)
    if abonnement is None:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=ErrorCode.SUBSCRIPTION_REQUIRED.value,
        )

    return [CreateurVuRead.model_validate(createur) for createur in await service.annuaire(session)]
