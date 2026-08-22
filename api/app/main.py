"""Point d'entrée de l'API BIND."""

import logging

from fastapi import FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.config import get_settings
from app.core.encryption import build_keyring
from app.core.errors import ErrorCode
from app.integrations.billing import check_billing_configuration
from app.integrations.email import check_email_configuration
from app.integrations.geocoding import check_geocoder_configuration
from app.integrations.geoip import check_geoip_configuration
from app.integrations.menu_extraction import check_extraction_configuration
from app.integrations.object_store import check_object_store_configuration
from app.integrations.providers import check_social_configuration
from app.integrations.push import check_push_configuration
from app.routers import (
    account_verification,
    audience,
    auth,
    availability,
    booking,
    booking_history,
    booking_states,
    business,
    business_menu,
    business_photos,
    business_public,
    capacity,
    catalog,
    collaboration,
    counterpart_queue,
    creator_directory,
    creator_profile,
    creator_tiers,
    feed,
    handover,
    health,
    jobs,
    media,
    menu_import,
    notifications,
    plans,
    proof_media,
    proof_upload,
    redemption,
    reporting,
    social_accounts,
    subscription,
    support,
    tier_offers,
    tiers,
    tracking,
    venue_report,
)

logger = logging.getLogger(__name__)


async def _validation_error_handler(_: Request, error: RequestValidationError) -> JSONResponse:
    """Uniformise le 422 sur un code du catalogue, et n'y renvoie aucune valeur reçue.

    La réponse par défaut de FastAPI contient `input`, c'est-à-dire la valeur
    rejetée : un mot de passe trop court repartait tel quel vers l'appelant.
    Seuls le chemin du champ et la nature du défaut sont conservés, comme pour
    les erreurs de configuration.
    """
    champs = [
        {"loc": [str(part) for part in item["loc"]], "type": item["type"]}
        for item in error.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": ErrorCode.VALIDATION_FAILED.value, "fields": champs},
    )


class ErreurInattendueEnJson(BaseHTTPMiddleware):
    """Rend un 500 que l'app sait lire, et que le navigateur laisse passer.

    **Ce que ça répare, et ce que ça a coûté.** Une exception non rattrapée
    remontait jusqu'à uvicorn, qui répond `Internal Server Error` en texte brut,
    hors de toute la pile d'intergiciels — donc **sans en-tête CORS**. Le
    navigateur ne voyait plus une réponse, il voyait une origine interdite ;
    `fetch` levait `TypeError: Failed to fetch` ; l'app, qui ne peut pas
    distinguer cela d'un câble débranché, affichait « réessayez dans un
    instant » avec un bouton qui ne pouvait pas marcher. Le fil créateur est
    resté bloqué une journée sur cette phrase, pendant qu'on cherchait du côté
    des jetons.

    **Un 500 doit rester une réponse.** Rendu ici, il traverse `CORSMiddleware`
    en remontant, en ressort avec ses en-têtes, et arrive à l'app comme les
    autres erreurs : un code du catalogue, traduit dans les deux langues. La
    panne reste une panne — elle se lit enfin comme telle.

    **L'exception est journalisée entière, la réponse ne dit rien.** Une trace
    d'appels renvoyée à l'appelant nomme des fichiers, des tables et des
    versions. Le serveur la garde.

    **Placé sous `CORSMiddleware`, jamais au-dessus.** Starlette construit la
    pile de sorte que le dernier intergiciel ajouté soit le plus extérieur :
    celui-ci s'ajoute donc *avant* CORS pour se retrouver *dedans*. Au-dessus,
    il reproduirait exactement le défaut qu'il corrige.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            return await call_next(request)
        except Exception:
            logger.exception("exception non rattrapée sur %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": ErrorCode.INTERNAL_ERROR.value},
            )


def create_app() -> FastAPI:
    settings = get_settings()

    # Le trousseau est construit ici, pas au premier chiffrement : une clé
    # absente ou mal formée doit empêcher de démarrer, pas de fonctionner à
    # moitié jusqu'à la première connexion d'un compte social.
    build_keyring()

    # Même raison : découvrir au premier commerce créé que la clé de géocodage
    # manque signifierait un commerce placé nulle part, et personne pour le voir.
    check_geocoder_configuration()
    check_email_configuration()
    check_extraction_configuration()
    check_object_store_configuration()
    check_billing_configuration()
    check_geoip_configuration()
    check_push_configuration()
    check_social_configuration()

    application = FastAPI(
        title="BIND API",
        version="0.1.0",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
        docs_url=f"{settings.api_v1_prefix}/docs",
        redoc_url=None,
    )

    # **L'ordre compte, et il se lit à l'envers.** `add_middleware` empile : le
    # dernier ajouté est le plus extérieur. Celui-ci s'ajoute donc en premier
    # pour finir *sous* CORS, de sorte que sa réponse remonte à travers CORS et
    # en ressorte avec les en-têtes qu'un navigateur exige. Inverser ces deux
    # appels rendrait à nouveau les 500 illisibles depuis le web.
    application.add_middleware(ErreurInattendueEnJson)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.add_exception_handler(RequestValidationError, _validation_error_handler)

    application.include_router(health.router, prefix=settings.api_v1_prefix)
    application.include_router(auth.router, prefix=settings.api_v1_prefix)
    application.include_router(business.router, prefix=settings.api_v1_prefix)
    application.include_router(business.mes_commerces_router, prefix=settings.api_v1_prefix)
    application.include_router(business_photos.router, prefix=settings.api_v1_prefix)
    application.include_router(business_menu.router, prefix=settings.api_v1_prefix)
    application.include_router(catalog.router, prefix=settings.api_v1_prefix)
    application.include_router(creator_directory.router, prefix=settings.api_v1_prefix)
    application.include_router(capacity.router, prefix=settings.api_v1_prefix)
    application.include_router(tiers.router, prefix=settings.api_v1_prefix)
    application.include_router(tiers.business_router, prefix=settings.api_v1_prefix)
    application.include_router(tier_offers.router, prefix=settings.api_v1_prefix)
    application.include_router(availability.router, prefix=settings.api_v1_prefix)
    application.include_router(booking.router, prefix=settings.api_v1_prefix)
    application.include_router(booking_states.router, prefix=settings.api_v1_prefix)
    application.include_router(creator_profile.router, prefix=settings.api_v1_prefix)
    application.include_router(creator_tiers.router, prefix=settings.api_v1_prefix)
    application.include_router(feed.router, prefix=settings.api_v1_prefix)
    application.include_router(social_accounts.router, prefix=settings.api_v1_prefix)
    application.include_router(account_verification.router, prefix=settings.api_v1_prefix)
    application.include_router(jobs.router, prefix=settings.api_v1_prefix)
    application.include_router(redemption.router, prefix=settings.api_v1_prefix)
    application.include_router(collaboration.router, prefix=settings.api_v1_prefix)
    application.include_router(menu_import.router, prefix=settings.api_v1_prefix)
    application.include_router(business_public.router, prefix=settings.api_v1_prefix)
    application.include_router(booking_history.creator_router, prefix=settings.api_v1_prefix)
    application.include_router(booking_history.business_router, prefix=settings.api_v1_prefix)
    application.include_router(counterpart_queue.business_router, prefix=settings.api_v1_prefix)
    application.include_router(counterpart_queue.admin_router, prefix=settings.api_v1_prefix)
    application.include_router(plans.router, prefix=settings.api_v1_prefix)
    application.include_router(audience.router, prefix=settings.api_v1_prefix)
    application.include_router(reporting.router, prefix=settings.api_v1_prefix)
    application.include_router(subscription.router, prefix=settings.api_v1_prefix)
    application.include_router(media.router, prefix=settings.api_v1_prefix)
    application.include_router(proof_media.router, prefix=settings.api_v1_prefix)
    application.include_router(proof_upload.router, prefix=settings.api_v1_prefix)
    application.include_router(notifications.router, prefix=settings.api_v1_prefix)
    application.include_router(handover.admin_router, prefix=settings.api_v1_prefix)
    application.include_router(handover.public_router, prefix=settings.api_v1_prefix)
    application.include_router(support.admin_router, prefix=settings.api_v1_prefix)
    application.include_router(support.business_router, prefix=settings.api_v1_prefix)
    application.include_router(venue_report.creator_router, prefix=settings.api_v1_prefix)
    application.include_router(venue_report.admin_router, prefix=settings.api_v1_prefix)
    application.include_router(tracking.creator_router, prefix=settings.api_v1_prefix)
    application.include_router(tracking.business_router, prefix=settings.api_v1_prefix)
    application.include_router(tracking.admin_router, prefix=settings.api_v1_prefix)
    # **Hors préfixe, délibérément.** Le lien voyage dans un sticker de story,
    # où il se lit et parfois se recopie à la main : « /r/k3f9x2 » tient,
    # « /api/v1/tracking/redirect/k3f9x2 » non.
    application.include_router(tracking.redirect_router)

    return application


app = create_app()
