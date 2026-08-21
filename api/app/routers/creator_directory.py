"""L'annuaire des créateurs, réservé aux commerces abonnés.

C'est ce que BIND vend : l'accès à un réseau. La barrière est donc la même que
la vente — un abonnement vivant — et non le simple fait d'être un commerce.
"""

from fastapi import APIRouter, Depends

from app.core.dependencies import CurrentBusiness, SessionDep, require_role
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
async def read_directory(business: CurrentBusiness, session: SessionDep) -> AnnuaireRead:
    """**L'abonnement décide de ce qui part, pas de ce qui s'affiche.**

    Un refus sec fermait la porte sans rien montrer, et une liste vide se lit
    « aucun créateur » — un mensonge et un argument contre le produit. La
    réponse est donc toujours servie, en deux qualités.

    Sans abonnement : ni pseudonyme, ni volume, ni lien de profil, ni photo
    nette. Un aperçu flouté **produit par le serveur**, les réseaux rattachés,
    la ville et les paliers ouverts. Ce qu'un écran prétend cacher doit être
    absent de la réponse — un masque visuel n'est pas un contrôle d'accès, et
    celui qui rappelle la route sans l'application ne doit rien gagner à le
    faire.

    Le drapeau est calculé ici et nulle part ailleurs : laisser l'écran décider
    mettrait la vente derrière une condition d'affichage.
    """
    abonnement = await subscription_service.courant(session, business_id=business.id)

    return AnnuaireRead(
        # Le compte est servi dans les deux cas : il n'identifie personne, et
        # c'est justement lui qui donne envie de payer. « 128 créatrices
        # autour de vous, 41 peuvent déjà réserver » est un argument ; une
        # liste de silhouettes sans nombre n'en est pas un.
        portee=PorteeLocaleRead.model_validate(
            await portee_locale.autour_du_commerce(session, business=business)
        ),
        createurs=[
            CreateurVuRead.model_validate(createur)
            for createur in await service.annuaire(session, abonne=abonnement is not None)
        ],
    )
