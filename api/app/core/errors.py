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
    #: L'annuaire des créateurs est ce que l'abonnement achète. Un refus, et
    #: jamais une liste vide : le vide se lirait « aucun créateur », ce qui est
    #: faux et fait un argument contre le produit.
    SUBSCRIPTION_REQUIRED = "subscription_required"
    #: La galerie a un plafond de produit, pas une limite technique : au-delà,
    #: la fiche devient un catalogue et le commerce un photographe.
    GALLERY_FULL = "gallery_full"

    # Commerce
    BUSINESS_NOT_FOUND = "business_not_found"
    BUSINESS_ALREADY_ACTIVE = "business_already_active"
    #: Mettre en pause ce qui n'est pas ouvert n'a pas de sens.
    BUSINESS_NOT_ACTIVE = "business_not_active"
    BUSINESS_MISSING_ADDRESS = "business_missing_address"
    BUSINESS_MISSING_COORDINATES = "business_missing_coordinates"

    # Catalogue
    CATALOG_ITEM_NOT_FOUND = "catalog_item_not_found"
    CATALOG_DURATION_MISMATCH = "catalog_duration_mismatch"
    CATALOG_ITEM_HAS_BOOKINGS = "catalog_item_has_bookings"
    CATALOG_ITEM_LOCKED_BY_BOOKINGS = "catalog_item_locked_by_bookings"
    CATALOG_PARENT_NOT_FOUND = "catalog_parent_not_found"
    CATALOG_ITEM_NOT_BOOKABLE = "catalog_item_not_bookable"
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

    # Profil créateur
    CREATOR_PROFILE_NOT_FOUND = "creator_profile_not_found"
    CREATOR_PROFILE_ANONYMIZED = "creator_profile_anonymized"

    # Comptes sociaux
    OAUTH_STATE_INVALID = "oauth_state_invalid"
    SOCIAL_ACCOUNT_TAKEN = "social_account_taken"
    SOCIAL_PROVIDER_UNAVAILABLE = "social_provider_unavailable"
    #: Rattaché sous un autre fournisseur : aucun geste du créateur ne le
    #: récupérera. Distinct de « compte inactif », qui se reconnecte.
    SOCIAL_ACCOUNT_FROM_OTHER_PROVIDER = "social_account_from_other_provider"
    SOCIAL_ACCOUNT_NOT_FOUND = "social_account_not_found"
    SOCIAL_ACCOUNT_NOT_ACTIVE = "social_account_not_active"
    SOCIAL_TOKEN_EXPIRED = "social_token_expired"
    METRICS_REFRESH_TOO_SOON = "metrics_refresh_too_soon"
    VERIFICATION_TRANSITION_NOT_ALLOWED = "verification_transition_not_allowed"

    # Travail planifié
    JOB_NOT_FOUND = "job_not_found"
    JOB_NOT_EXHAUSTED = "job_not_exhausted"

    # Réservation
    BOOKING_OFFER_NOT_BOOKABLE = "booking_offer_not_bookable"
    BOOKING_TIER_NOT_ACCESSIBLE = "booking_tier_not_accessible"
    BOOKING_NAME_REQUIRED = "booking_name_required"
    BOOKING_SLOT_REQUIRED = "booking_slot_required"
    BOOKING_SLOT_NOT_ALLOWED = "booking_slot_not_allowed"
    BOOKING_SLOT_UNAVAILABLE = "booking_slot_unavailable"
    BOOKING_NOT_FOUND = "booking_not_found"
    BOOKING_TRANSITION_NOT_ALLOWED = "booking_transition_not_allowed"
    BOOKING_HOLD_EXPIRED = "booking_hold_expired"
    #: L'heure du rendez-vous est passée : il n'y a plus rien à accepter.
    BOOKING_SLOT_ELAPSED = "booking_slot_elapsed"
    BOOKING_NO_SHOW_NOT_APPLICABLE = "booking_no_show_not_applicable"

    # Retrait
    REDEMPTION_CODE_UNKNOWN = "redemption_code_unknown"
    REDEMPTION_CODE_ALREADY_CONSUMED = "redemption_code_already_consumed"
    REDEMPTION_BOOKING_NOT_REDEEMABLE = "redemption_booking_not_redeemable"
    REDEMPTION_TOO_MANY_ATTEMPTS = "redemption_too_many_attempts"

    # Contrepartie
    COLLABORATION_NOT_FOUND = "collaboration_not_found"
    COLLABORATION_TRANSITION_NOT_ALLOWED = "collaboration_transition_not_allowed"
    COLLABORATION_NOT_OPEN = "collaboration_not_open"
    COLLABORATION_NOT_IN_REVIEW = "collaboration_not_in_review"
    PROOF_NOTHING_ARCHIVED = "proof_nothing_archived"
    #: La capture dépasse le poids accepté.
    PROOF_TOO_LARGE = "proof_too_large"
    #: Un format qu'on ne sait pas relire ne sert pas de preuve.
    PROOF_UNSUPPORTED_TYPE = "proof_unsupported_type"
    #: Le dépôt d'objets n'a pas répondu. Distinct d'un refus métier.
    PROOF_STORAGE_UNAVAILABLE = "proof_storage_unavailable"
    PROOF_ALREADY_SUBMITTED = "proof_already_submitted"

    # Abonnement du commerce
    SUBSCRIPTION_ALREADY_ACTIVE = "subscription_already_active"
    SUBSCRIPTION_NOT_ACTIVE = "subscription_not_active"
    SUBSCRIPTION_PLAN_NOT_FOUND = "subscription_plan_not_found"
    SUBSCRIPTION_PLAN_INACTIVE = "subscription_plan_inactive"
    BILLING_PROVIDER_UNAVAILABLE = "billing_provider_unavailable"

    # Import de carte
    MENU_IMPORT_NOT_FOUND = "menu_import_not_found"
    MENU_IMPORT_TRANSITION_NOT_ALLOWED = "menu_import_transition_not_allowed"
    MENU_IMPORT_DURATION_REQUIRED = "menu_import_duration_required"

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
