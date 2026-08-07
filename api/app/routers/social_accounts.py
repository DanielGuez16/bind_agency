"""Rattachement d'un compte social au créateur.

Le retour du fournisseur n'est pas authentifié : c'est une redirection de
navigateur, sans en-tête. L'état est donc la seule chose qui dit de qui il
s'agit — d'où son traitement, signé, à usage unique, et lié à celui qui a
démarré le parcours.
"""

import uuid
from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, Path, Query, status
from fastapi.responses import RedirectResponse

from app.core.config import ConfigurationError
from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.integrations import providers
from app.integrations.social import SocialProvider, SocialProviderError
from app.models.enums import Platform, UserRole
from app.schemas.social_accounts import (
    AutorisationDemarree,
    OuvertureDemandee,
    SocialAccountRead,
    SocialMetricsRead,
)
from app.services import metrics as metrics_service
from app.services import social_accounts as service

router = APIRouter(tags=["social-accounts"])


async def _fournir(platform: Platform) -> AsyncIterator[SocialProvider]:
    """Le fournisseur d'une plateforme, ou un 503 du catalogue.

    Le routeur ne nomme aucune implémentation : la fabrique décide sur la
    configuration. C'est ce qui permet d'ajouter une plateforme sans toucher
    ici, et de faire une démonstration sans mentir sur des identifiants Meta.
    """
    try:
        async for provider in providers.fournisseur_de(platform):
            yield provider
    except ConfigurationError as error:
        # Plateforme non branchée, ou configuration incomplète : la même
        # réponse. L'app affiche « réseau indisponible » dans les deux cas, et
        # distinguer les deux n'apprendrait rien à qui lit l'écran.
        raise api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE, ErrorCode.SOCIAL_PROVIDER_UNAVAILABLE
        ) from error


# Deux fonctions nommées plutôt qu'une fabrique de closures : une dépendance
# FastAPI se surcharge **par identité**, et une closure fabriquée à chaque
# import ne peut pas être visée par un test. La duplication de deux lignes est
# le prix d'un point de surcharge stable.
async def get_instagram_provider() -> AsyncIterator[SocialProvider]:
    async for provider in _fournir(Platform.INSTAGRAM):
        yield provider


async def get_tiktok_provider() -> AsyncIterator[SocialProvider]:
    async for provider in _fournir(Platform.TIKTOK):
        yield provider


InstagramDep = Annotated[SocialProvider, Depends(get_instagram_provider)]
TikTokDep = Annotated[SocialProvider, Depends(get_tiktok_provider)]


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
    user: CurrentUser,
    session: SessionDep,
    provider: InstagramDep,
    demande: OuvertureDemandee | None = None,
) -> AutorisationDemarree:
    return await _ouvrir(session, user=user, provider=provider, demande=demande)


@router.post(
    "/me/social-accounts/tiktok/connect",
    response_model=AutorisationDemarree,
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)
async def start_tiktok(
    user: CurrentUser,
    session: SessionDep,
    provider: TikTokDep,
    demande: OuvertureDemandee | None = None,
) -> AutorisationDemarree:
    """Jumelle de la route Instagram, et volontairement pas une route générique.

    Une route `/{platform}/connect` accepterait `snapchat` et rendrait un 503
    au lieu d'un 404 : le client aurait le droit de croire que la plateforme
    existe et qu'elle est en panne. Deux routes déclarées disent exactement ce
    qui est branché.
    """
    return await _ouvrir(session, user=user, provider=provider, demande=demande)


async def _ouvrir(
    session,
    *,
    user,
    provider: SocialProvider,
    demande: "OuvertureDemandee | None",
) -> AutorisationDemarree:
    """L'ouverture, identique pour les deux plateformes."""
    try:
        url = await service.start_authorization(
            session, user=user, provider=provider, retour=demande.return_url if demande else None
        )
    except service.AdresseDeRetourRefusee as error:
        # Refusé ici, avant d'envoyer qui que ce soit chez Meta : au retour, la
        # personne aurait déjà autorisé, et il n'y aurait plus rien à faire de
        # propre.
        raise api_error(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_FAILED) from error

    await session.commit()
    return AutorisationDemarree(authorization_url=url)


@router.get("/social-accounts/tiktok/callback", response_model=None)
async def tiktok_callback(
    session: SessionDep,
    provider: TikTokDep,
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
) -> SocialAccountRead | RedirectResponse:
    return await _terminer(session, provider=provider, code=code, state=state)


@router.get("/social-accounts/instagram/callback", response_model=None)
async def instagram_callback(
    session: SessionDep,
    provider: InstagramDep,
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
) -> SocialAccountRead | RedirectResponse:
    """Retour du fournisseur. Volontairement hors du préfixe `/me` : personne
    n'est authentifié ici, c'est l'état qui identifie."""
    return await _terminer(session, provider=provider, code=code, state=state)


def _retour_vers_l_app(retour: str, **parametres: str) -> RedirectResponse:
    """Renvoie vers l'application, avec l'issue en paramètres.

    **Jamais le jeton ni le code.** Ils ont été échangés côté serveur et le
    compte est déjà rattaché ; l'application n'a besoin que de savoir que c'est
    fait, elle relit ensuite ses comptes par une route authentifiée. Faire
    voyager un secret dans une adresse le déposerait dans l'historique du
    navigateur et dans les journaux du système.

    303 et non 302 : la méthode devient un GET, ce qui est ce qu'on veut d'un
    retour de navigateur.
    """
    separateur = "&" if urlsplit(retour).query else "?"
    return RedirectResponse(
        f"{retour}{separateur}{urlencode(parametres)}",
        status_code=status.HTTP_303_SEE_OTHER,
    )


async def _terminer(
    session, *, provider: SocialProvider, code: str, state: str
) -> SocialAccountRead | RedirectResponse:
    """Le retour, identique quelle que soit la plateforme.

    Écrit une fois : deux copies divergeraient au premier code d'erreur ajouté,
    et c'est la plateforme la moins utilisée qui garderait l'ancienne.

    **Deux façons de répondre, selon d'où l'on vient.** Ouvert depuis
    l'application, le parcours doit y revenir : le rappel arrive ici, sur le
    serveur, et l'application est ailleurs — sur un téléphone, à une autre
    adresse. Sans redirection, l'autorisation se termine sur du JSON affiché
    dans le navigateur, et l'app ne sait jamais que le compte est rattaché.
    Sans adresse de retour — un navigateur, un essai en ligne de commande — le
    JSON reste la bonne réponse.

    **L'échec revient aussi.** Un rappel qui échouerait en silence laisserait
    l'application attendre un retour qui n'arrive pas ; la redirection porte
    alors le code d'erreur, que l'app sait déjà traduire.
    """
    retour: str | None = None
    try:
        rattachement = await service.complete_authorization(
            session, state=state, code=code, provider=provider
        )
        retour = rattachement.retour
    except service.InvalidOAuthState as error:
        raise api_error(status.HTTP_400_BAD_REQUEST, ErrorCode.OAUTH_STATE_INVALID) from error
    except service.AccountTakenByAnotherCreator as error:
        adresse = await service.adresse_de_retour(session, state=state)
        if adresse:
            return _retour_vers_l_app(adresse, statut="erreur", code=ErrorCode.SOCIAL_ACCOUNT_TAKEN)
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.SOCIAL_ACCOUNT_TAKEN) from error
    except SocialProviderError as error:
        adresse = await service.adresse_de_retour(session, state=state)
        if adresse:
            return _retour_vers_l_app(
                adresse, statut="erreur", code=ErrorCode.SOCIAL_PROVIDER_UNAVAILABLE
            )
        raise api_error(
            status.HTTP_502_BAD_GATEWAY, ErrorCode.SOCIAL_PROVIDER_UNAVAILABLE
        ) from error

    await session.commit()

    if retour:
        return _retour_vers_l_app(
            retour, statut="rattache", handle=rattachement.compte.handle or ""
        )
    return SocialAccountRead.model_validate(rattachement.compte, from_attributes=True)


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
