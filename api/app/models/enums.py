"""Énumérations applicatives.

Toutes rendues en `VARCHAR` + `CHECK`, jamais en type ENUM natif Postgres.
Les valeurs stockées sont celles écrites ici, pas les noms des membres.
"""

from enum import StrEnum


class UserRole(StrEnum):
    CREATOR = "creator"
    BUSINESS_MEMBER = "business_member"
    ADMIN = "admin"


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    ANONYMIZED = "anonymized"


class Locale(StrEnum):
    EN = "en"
    ES = "es"


class Platform(StrEnum):
    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    SNAPCHAT = "snapchat"
    YOUTUBE = "youtube"


class SocialAccountStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"


class VerificationStatus(StrEnum):
    """Résultat du contrôle de cohérence de SPEC.md §3.2."""

    VERIFIED = "verified"
    NEEDS_REVIEW = "needs_review"
    REJECTED = "rejected"


class BusinessCategory(StrEnum):
    BEAUTY = "beauty"
    RESTAURANT = "restaurant"
    MUSEUM = "museum"
    FITNESS = "fitness"
    FAMILY_ACTIVITY = "family_activity"
    OTHER = "other"


class BusinessStatus(StrEnum):
    ONBOARDING = "onboarding"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class BusinessMemberRole(StrEnum):
    OWNER = "owner"
    STAFF = "staff"


class BillingInterval(StrEnum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class SubscriptionStatus(StrEnum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"


class CatalogItemSource(StrEnum):
    MANUAL = "manual"
    IMPORT = "import"


class MenuImportStatus(StrEnum):
    UPLOADED = "uploaded"
    EXTRACTED = "extracted"
    UNDER_REVIEW = "under_review"
    VALIDATED = "validated"
    FAILED = "failed"


class ContentFormat(StrEnum):
    STORY = "story"
    POST = "post"
    REEL = "reel"


class BookingStatus(StrEnum):
    HELD = "held"
    CONFIRMED = "confirmed"
    CONSUMED = "consumed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    EXPIRED = "expired"


class CollaborationStatus(StrEnum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    RESUBMIT_REQUESTED = "resubmit_requested"
    UNFULFILLED = "unfulfilled"


class CaptureMethod(StrEnum):
    """Niveau de capture de preuve, du plus fiable au moins fiable."""

    API = "api"
    URL_FETCH = "url_fetch"
    UPLOAD = "upload"


class ReliabilityEventType(StrEnum):
    COLLAB_COMPLETED = "collab_completed"
    PUBLISHED_ON_TIME = "published_on_time"
    PUBLISHED_LATE = "published_late"
    FIRST_PASS_COMPLIANT = "first_pass_compliant"
    RESUBMIT_REQUIRED = "resubmit_required"
    NO_SHOW = "no_show"
    UNFULFILLED = "unfulfilled"
    BUSINESS_RATING = "business_rating"


class ActorKind(StrEnum):
    SYSTEM = "system"
    CREATOR = "creator"
    BUSINESS_MEMBER = "business_member"
    ADMIN = "admin"


class CatalogItemAvailability(StrEnum):
    """État logique d'un item, déduit de `is_available`.

    Aucune colonne ne le porte : il n'existe que comme vocabulaire du journal
    d'audit, qui doit nommer les états qu'il décrit.
    """

    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"


class TierState(StrEnum):
    """État logique d'un palier, déduit de `is_active`.

    Aucune colonne ne le porte : vocabulaire du journal d'audit uniquement.
    """

    ACTIVE = "active"
    INACTIVE = "inactive"


class RefreshTokenState(StrEnum):
    """État logique d'un jeton de rafraîchissement.

    Aucune colonne ne le porte : il se déduit de `revoked_at`. Il n'existe que
    comme vocabulaire du journal d'audit, qui doit nommer les états qu'il décrit.
    """

    ISSUED = "issued"
    REVOKED = "revoked"
