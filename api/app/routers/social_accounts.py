"""Rattachement d'un compte social au créateur.

Le retour du fournisseur n'est pas authentifié : c'est une redirection de
navigateur, sans en-tête. L'état est donc la seule chose qui dit de qui il
s'agit — d'où son traitement, signé, à usage unique, et lié à celui qui a
démarré le parcours.
"""

import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Path, Query, status

from app.core.config import ConfigurationError
from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.integrations.instagram import InstagramProvider
from app.integrations.social import SocialProvider, SocialProviderError
from app.models.enums import UserRole
from app.schemas.social_accounts import (
    AutorisationDemarree,
    SocialAccountRead,
    SocialMetricsRead,
)
from app.services import metrics as metrics_service
from app.services import social_accounts as service

router = APIRouter(tags=["social-accounts"])


async def get_instagram_provider() -> SocialProvider:
    """Un client HTTP par requête : pas d'état partagé entre parcours."""
    try:
        async with httpx.AsyncClient() as client:
            yield InstagramProvider(client)
    except ConfigurationError as error:
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE, ErrorCode.SOCIAL_PROVIDER_UNAVAILABLE
        ) from error


InstagramDep = Annotated[SocialProvider, Depends(get_instagram_provider)]


@router.get("/me/social-accounts", response_model=list[SocialAccountRead])
async def list_accounts(user: CurrentUser, session: SessionDep) -> list[SocialAccountRead]:
    comptes = await service.list_accounts(session, user.id)
    return [SocialAccountRead.model_validate(compte, from_attributes=True) for compte in comptes]


@router.post(
    "/me/social-accounts/instagram/connect",
    response_model=AutorisationDemarree,
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)
async def start_instagram(
    user: CurrentUser, session: SessionDep, provider: InstagramDep
) -> AutorisationDemarree:
    url = await service.start_authorization(session, user=user, provider=provider)
    await session.commit()
    return AutorisationDemarree(authorization_url=url)


@router.get("/social-accounts/instagram/callback", response_model=SocialAccountRead)
async def instagram_callback(
    session: SessionDep,
    provider: InstagramDep,
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
) -> SocialAccountRead:
    """Retour du fournisseur. Volontairement hors du préfixe `/me` : personne
    n'est authentifié ici, c'est l'état qui identifie."""
    try:
        compte = await service.complete_authorization(
            session, state=state, code=code, provider=provider
        )
    except service.InvalidOAuthState as error:
        raise api_error(status.HTTP_400_BAD_REQUEST, ErrorCode.OAUTH_STATE_INVALID) from error
    except service.AccountTakenByAnotherCreator as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.SOCIAL_ACCOUNT_TAKEN) from error
    except SocialProviderError as error:
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, ErrorCode.SOCIAL_PROVIDER_UNAVAILABLE
        ) from error

    await session.commit()
    return SocialAccountRead.model_validate(compte, from_attributes=True)


@router.post(
    "/me/social-accounts/{account_id}/metrics/refresh",
    response_model=SocialMetricsRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)
async def refresh_metrics(
    user: CurrentUser,
    session: SessionDep,
    provider: InstagramDep,
    account_id: Annotated[uuid.UUID, Path()],
) -> SocialMetricsRead:
    """Relevé à la demande. 201 parce qu'il crée une ligne : deux appels
    réussis créent deux snapshots, jamais un seul mis à jour."""
    try:
        compte = await metrics_service.get_owned_account(
            session, account_id=account_id, creator_id=user.id
        )
    except metrics_service.SocialAccountNotFound as error:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.SOCIAL_ACCOUNT_NOT_FOUND) from error

    try:
        snapshot = await metrics_service.refresh_profile_metrics(
            session, account=compte, provider=provider
        )
    except metrics_service.SocialAccountNotActive as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.SOCIAL_ACCOUNT_NOT_ACTIVE) from error
    except metrics_service.RefreshTooSoon as error:
        raise api_error(
            status.HTTP_429_TOO_MANY_REQUESTS, ErrorCode.METRICS_REFRESH_TOO_SOON
        ) from error
    except metrics_service.SocialTokenExpired as error:
        # Un appel réellement passé est toujours enregistré, quelle qu'en soit
        # l'issue : la tentative a consommé le quota, et ici le compte a en plus
        # basculé en `expired`. Annuler renverrait bien l'erreur au créateur
        # mais laisserait le compte affiché comme actif, et le relevé suivant
        # irait redécouvrir la même chose chez Meta.
        await session.commit()
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.SOCIAL_TOKEN_EXPIRED) from error
    except SocialProviderError as error:
        # Même raison, en plus discret : seule la trace de la tentative est
        # validée. Aucun snapshot n'a été écrit, le service s'en est assuré.
        await session.commit()
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, ErrorCode.SOCIAL_PROVIDER_UNAVAILABLE
        ) from error

    await session.commit()
    return SocialMetricsRead.model_validate(snapshot, from_attributes=True)
