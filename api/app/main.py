"""Point d'entrée de l'API BIND."""

import logging

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
    handover,
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


async def _intercepter_les_erreurs(request: Request, appeler_la_suite):
    """Rend un 500 **qui traverse la pile de middlewares**, et non un mur de CORS.

    **Le défaut que ceci répare a coûté trois campagnes de test.** Une exception
    non rattrapée remonte jusqu'à `ServerErrorMiddleware`, qui est *au-dessus*
    de `CORSMiddleware` : sa réponse ne porte donc aucun en-tête d'origine. Le
    navigateur n'y voit pas un 500, il y voit une violation de CORS — et
    l'enquête part du mauvais côté, sur la configuration d'origines, pendant que
    la vraie erreur dort dans le journal du serveur.

    **Un gestionnaire d'exception n'y suffit pas**, et c'est le piège :
    `add_exception_handler(Exception, ...)` ne pose pas un gestionnaire de plus,
    il remplace celui de `ServerErrorMiddleware` — lequel reste au-dessus du
    CORS. Seul un middleware posé *sous* lui rend une réponse qui repasse par le
    CORS et en ressort avec ses en-têtes.

    **Aucun détail ne sort.** Le message d'une exception porte régulièrement une
    requête SQL, un identifiant, parfois une valeur reçue. La trace part au
    journal d'exploitation, lisible par ceux qui exploitent et par eux seuls.
    """
    try:
        return await appeler_la_suite(request)
    except Exception:
        logger.exception("erreur non rattrapée", extra={"chemin": request.url.path})
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

    application = FastAPI(
        title="BIND API",
        version="0.1.0",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
        docs_url=f"{settings.api_v1_prefix}/docs",
        redoc_url=None,
    )

    # **L'ordre de ces deux-là est tout le correctif.** `add_middleware` empile
    # vers l'extérieur : le dernier posé enveloppe les précédents. L'intercepteur
    # est donc posé **avant** le CORS, pour se retrouver **dessous** — sa réponse
    # repasse par lui et en ressort avec ses en-têtes.
    application.middleware("http")(_intercepter_les_erreurs)

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
