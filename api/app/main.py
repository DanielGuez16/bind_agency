"""Point d'entrée de l'API BIND."""

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.encryption import build_keyring
from app.core.errors import ErrorCode
from app.integrations.geocoding import check_geocoder_configuration
from app.routers import (
    account_verification,
    auth,
    business,
    capacity,
    catalog,
    creator_profile,
    creator_tiers,
    health,
    jobs,
    social_accounts,
    tier_offers,
    tiers,
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
    application.include_router(catalog.router, prefix=settings.api_v1_prefix)
    application.include_router(capacity.router, prefix=settings.api_v1_prefix)
    application.include_router(tiers.router, prefix=settings.api_v1_prefix)
    application.include_router(tier_offers.router, prefix=settings.api_v1_prefix)
    application.include_router(creator_profile.router, prefix=settings.api_v1_prefix)
    application.include_router(creator_tiers.router, prefix=settings.api_v1_prefix)
    application.include_router(social_accounts.router, prefix=settings.api_v1_prefix)
    application.include_router(account_verification.router, prefix=settings.api_v1_prefix)
    application.include_router(jobs.router, prefix=settings.api_v1_prefix)

    return application


app = create_app()
