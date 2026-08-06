"""Catalogue des codes d'erreur. Source de vérité unique.

L'API ne renvoie jamais de texte destiné à l'affichage. Elle renvoie un code
stable, et c'est l'application qui le traduit : une API qui renvoie des phrases
localisées oblige à redéployer le backend pour corriger une virgule.

Tout code ajouté ici doit l'être aussi dans les catalogues de l'application,
`app/src/i18n/en.ts` et `app/src/i18n/es.ts`. Deux tests tiennent la chaîne :
l'un refuse un code renvoyé par une route qui ne figurerait pas ici, l'autre
refuse un catalogue de l'app auquel il manquerait une clé.
"""

from enum import StrEnum

from fastapi import HTTPException


class ErrorCode(StrEnum):
    # Authentification
    AUTHENTICATION_REQUIRED = "authentication_required"
    INVALID_CREDENTIALS = "invalid_credentials"
    ACCOUNT_NOT_ACTIVE = "account_not_active"
    INVALID_REFRESH_TOKEN = "invalid_refresh_token"
    EMAIL_ALREADY_USED = "email_already_used"

    # Autorisation
    INSUFFICIENT_ROLE = "insufficient_role"
    NOT_A_MEMBER = "not_a_member"

    # Commerce
    BUSINESS_ALREADY_ACTIVE = "business_already_active"
    BUSINESS_MISSING_ADDRESS = "business_missing_address"
    BUSINESS_MISSING_COORDINATES = "business_missing_coordinates"

    # Catalogue
    CATALOG_ITEM_NOT_FOUND = "catalog_item_not_found"
    CATALOG_DURATION_MISMATCH = "catalog_duration_mismatch"
    CATALOG_ITEM_HAS_BOOKINGS = "catalog_item_has_bookings"
    CATALOG_ITEM_LOCKED_BY_BOOKINGS = "catalog_item_locked_by_bookings"
    CATALOG_PARENT_NOT_FOUND = "catalog_parent_not_found"
    CATALOG_PARENT_MUST_NOT_BE_BOOKABLE = "catalog_parent_must_not_be_bookable"
    CATALOG_VARIANT_DEPTH_EXCEEDED = "catalog_variant_depth_exceeded"

    # Capacité
    CAPACITY_RULE_NOT_FOUND = "capacity_rule_not_found"
    CAPACITY_RULE_OVERLAP = "capacity_rule_overlap"
    CAPACITY_EXCEPTION_NOT_FOUND = "capacity_exception_not_found"
    CAPACITY_EXCEPTION_DUPLICATE_DATE = "capacity_exception_duplicate_date"

    # Paliers
    TIER_NOT_FOUND = "tier_not_found"
    TIER_ALREADY_EXISTS = "tier_already_exists"
    TIER_IN_USE = "tier_in_use"

    # Offres par palier
    TIER_OFFER_NOT_FOUND = "tier_offer_not_found"
    TIER_OFFER_ALREADY_EXISTS = "tier_offer_already_exists"
    TIER_OFFER_PARENT_NOT_ALLOWED = "tier_offer_parent_not_allowed"
    TIER_OFFER_TIER_INACTIVE = "tier_offer_tier_inactive"
    TIER_OFFER_HAS_BOOKINGS = "tier_offer_has_bookings"

    # Comptes sociaux
    OAUTH_STATE_INVALID = "oauth_state_invalid"
    SOCIAL_ACCOUNT_TAKEN = "social_account_taken"
    SOCIAL_PROVIDER_UNAVAILABLE = "social_provider_unavailable"
    SOCIAL_ACCOUNT_NOT_FOUND = "social_account_not_found"
    SOCIAL_ACCOUNT_NOT_ACTIVE = "social_account_not_active"
    SOCIAL_TOKEN_EXPIRED = "social_token_expired"
    METRICS_REFRESH_TOO_SOON = "metrics_refresh_too_soon"
    VERIFICATION_TRANSITION_NOT_ALLOWED = "verification_transition_not_allowed"

    # Travail planifié
    JOB_NOT_FOUND = "job_not_found"
    JOB_NOT_EXHAUSTED = "job_not_exhausted"

    # Transverses
    VALIDATION_FAILED = "validation_failed"
    NOT_FOUND = "not_found"
    INTERNAL_ERROR = "internal_error"


def api_error(
    status_code: int, code: ErrorCode, *, headers: dict[str, str] | None = None
) -> HTTPException:
    """Seule fabrique d'erreur HTTP autorisée.

    Le type du paramètre interdit qu'un code hors catalogue parte vers l'app.
    """
    return HTTPException(status_code=status_code, detail=code.value, headers=headers)
