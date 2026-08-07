"""Abonnement du commerce.

Le seul flux d'argent du produit, et il ne concerne jamais un créateur.
"""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, status

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.integrations.billing import BillingError, BillingProvider, get_billing_provider
from app.models import SubscriptionPlan
from app.schemas.subscription import AbonnementRead, PlanRead, SouscriptionDemandee
from app.services import subscription as service

router = APIRouter(prefix="/business", tags=["subscription"])


async def get_provider() -> BillingProvider:
    """Un client HTTP par requête, comme pour les plateformes sociales.

    Ouvert même en mode journal, où il ne sert pas : deux chemins d'ouverture
    différents finiraient par diverger sur les délais, et le mode de
    démonstration cesserait d'emprunter le même chemin.
    """
    async with httpx.AsyncClient() as client:
        yield get_billing_provider(client)


ProviderDep = Annotated[BillingProvider, Depends(get_provider)]


@router.get("/{business_id}/plans", response_model=list[PlanRead])
async def list_plans(business: CurrentBusiness, session: SessionDep) -> list[PlanRead]:
    """Les plans souscriptibles, pour la catégorie du commerce.

    Filtrés sur sa catégorie : proposer à un salon le plan d'un musée lui
    demanderait de comprendre une tarification qui ne le concerne pas.
    """
    import sqlalchemy as sa

    plans = await session.scalars(
        sa.select(SubscriptionPlan)
        .where(
            SubscriptionPlan.is_active.is_(True),
            SubscriptionPlan.category == business.category,
        )
        .order_by(SubscriptionPlan.price_cents)
    )
    return [PlanRead.model_validate(plan) for plan in plans]


@router.get("/{business_id}/subscription", response_model=AbonnementRead | None)
async def read_subscription(
    business: CurrentBusiness, session: SessionDep
) -> AbonnementRead | None:
    """L'abonnement en cours, ou `null`.

    `null` plutôt qu'un 404 : ne pas être abonné est un état normal du commerce,
    pas une ressource absente, et l'écran doit pouvoir proposer de souscrire.
    """
    ligne = await service.courant(session, business_id=business.id)
    return AbonnementRead.model_validate(ligne) if ligne else None


@router.post(
    "/{business_id}/subscription",
    response_model=AbonnementRead,
    status_code=status.HTTP_201_CREATED,
)
async def subscribe(
    payload: SouscriptionDemandee,
    business: CurrentBusiness,
    user: CurrentUser,
    session: SessionDep,
    provider: ProviderDep,
) -> AbonnementRead:
    try:
        ouvert = await service.souscrire(
            session, business=business, plan_id=payload.plan_id, actor=user, provider=provider
        )
    except service.AlreadySubscribed as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.SUBSCRIPTION_ALREADY_ACTIVE) from error
    except service.PlanNotFound as error:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.SUBSCRIPTION_PLAN_NOT_FOUND) from error
    except service.PlanInactive as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.SUBSCRIPTION_PLAN_INACTIVE) from error
    except BillingError as error:
        # Rien n'est écrit en base : le commerce peut réessayer sans laisser
        # d'abonnement fantôme derrière lui.
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, ErrorCode.BILLING_PROVIDER_UNAVAILABLE
        ) from error

    await session.commit()
    lue = AbonnementRead.model_validate(ouvert.subscription)
    return lue.model_copy(update={"checkout_url": ouvert.checkout_url})


@router.delete("/{business_id}/subscription", response_model=AbonnementRead)
async def unsubscribe(
    business: CurrentBusiness,
    user: CurrentUser,
    session: SessionDep,
    provider: ProviderDep,
) -> AbonnementRead:
    """Résilie. Le commerce garde sa place jusqu'à la fin de la période payée."""
    try:
        ligne = await service.resilier(session, business=business, actor=user, provider=provider)
    except service.NotSubscribed as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.SUBSCRIPTION_NOT_ACTIVE) from error
    except BillingError as error:
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, ErrorCode.BILLING_PROVIDER_UNAVAILABLE
        ) from error

    await session.commit()
    return AbonnementRead.model_validate(ligne)
