"""L'annuaire des créateurs, réservé aux commerces abonnés.

C'est ce que BIND vend : l'accès à un réseau. La barrière est donc la même que
la vente — un abonnement vivant — et non le simple fait d'être un commerce.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.dependencies import CurrentBusiness, SessionDep, require_role
from app.core.errors import ErrorCode
from app.models.enums import UserRole
from app.schemas.directory import AnnuaireRead, CreateurVuRead
from app.schemas.reporting import PorteeLocaleRead
from app.services import directory as service
from app.services import portee_locale
from app.services import subscription as subscription_service

router = APIRouter(
    prefix="/business/{business_id}/creators",
    tags=["directory"],
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))],
)


@router.get("", response_model=AnnuaireRead)
async def read_directory(
    business: CurrentBusiness,
    session: SessionDep,
    limite: Annotated[int, Query(ge=1, le=200)] = 50,
    decalage: Annotated[int, Query(ge=0)] = 0,
) -> AnnuaireRead:
    """**Sans abonnement, rien ne part.**

    Un refus, et non une liste dégradée. La différence n'est pas de sécurité —
    la donnée était déjà retenue par le service — elle est d'expérience : un
    salon non abonné recevait une grille de cartes sans nom et sans visage,
    sans une ligne qui explique pourquoi, parce que l'écran n'affiche son état
    « l'annuaire vient avec un abonnement » que sur un 402. Le chemin qui vend
    l'abonnement était mort.

    Une liste vidée que n'accompagne aucun écran ne vend rien et ne protège
    rien de plus qu'un refus. Le jour où l'état sans abonnement sera composé —
    le compte en grand, quelques aperçus floutés, ce que l'abonnement ouvre —
    la question se reposera, et la machinerie l'attend : le floutage serveur,
    la clé `@apercu` et son repli qui échoue plutôt que de servir la photo
    nette restent en place et éprouvés.

    **Un refus et non une liste vide** : le vide se lit « aucun créateur », ce
    qui est un mensonge et un argument contre le produit.

    L'abonnement est vérifié ici et nulle part ailleurs : laisser l'écran
    décider mettrait la vente derrière une condition d'affichage, et il
    suffirait de rappeler la route.
    """
    abonnement = await subscription_service.courant(session, business_id=business.id)
    if abonnement is None:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=ErrorCode.SUBSCRIPTION_REQUIRED.value,
        )

    page = await service.annuaire(session, business=business, limite=limite, decalage=decalage)
    return AnnuaireRead(
        portee=PorteeLocaleRead.model_validate(
            await portee_locale.autour_du_commerce(session, business=business)
        ),
        createurs=[CreateurVuRead.model_validate(vu) for vu in page.createurs],
        total=page.total,
    )
