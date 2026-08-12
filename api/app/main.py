"""Point d'entrée de l'API BIND."""

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.encryption import build_keyring
from app.core.errors import ErrorCode
from app.integrations.billing import check_billing_configuration
from app.integrations.email import check_email_configuration
from app.integrations.geocoding import check_geocoder_configuration
from app.integrations.geoip import check_geoip_configuration
from app.integrations.menu_extraction import check_extraction_configuration
from app.integrations.object_store import check_object_store_configuration
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
    health,
    jobs,
    media,
    menu_import,
    notifications,
    plans,
    platform_assets,
    proof_media,
    proof_upload,
    redemption,
    reporting,
    social_accounts,
    subscription,
    tier_offers,
    tiers,
    tracking,
)


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

    application = FastAPI(
        title="BIND API",
        version="0.1.0",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
        docs_url=f"{settings.api_v1_prefix}/docs",
        redoc_url=None,
    )

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
    application.include_router(platform_assets.router, prefix=settings.api_v1_prefix)
    application.include_router(media.router, prefix=settings.api_v1_prefix)
    application.include_router(proof_media.router, prefix=settings.api_v1_prefix)
    application.include_router(proof_upload.router, prefix=settings.api_v1_prefix)
    application.include_router(notifications.router, prefix=settings.api_v1_prefix)
    application.include_router(tracking.creator_router, prefix=settings.api_v1_prefix)
    application.include_router(tracking.business_router, prefix=settings.api_v1_prefix)
    application.include_router(tracking.admin_router, prefix=settings.api_v1_prefix)
    # **Hors préfixe, délibérément.** Le lien voyage dans un sticker de story,
    # où il se lit et parfois se recopie à la main : « /r/k3f9x2 » tient,
    # « /api/v1/tracking/redirect/k3f9x2 » non.
    application.include_router(tracking.redirect_router)

    return application


app = create_app()
