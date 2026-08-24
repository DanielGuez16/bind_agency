"""Modèles SQLAlchemy.

Tout modèle doit être importé ici : c'est ce que lit `alembic/env.py` pour
l'autogénération. Un modèle absent de ce fichier est invisible aux migrations.
"""

from app.models.audit import AuditLog
from app.models.auth import RefreshToken
from app.models.base import Base
from app.models.booking import Booking, CapacityException, CapacityRule, RedemptionCode
from app.models.business import (
    Business,
    BusinessMember,
    BusinessMenuPage,
    BusinessPhoto,
    Subscription,
    SubscriptionPlan,
)
from app.models.catalog import CatalogItem, MenuImport
from app.models.collaboration import Collaboration, Proof
from app.models.config_journal import ConfigurationChange
from app.models.email_verification import EmailVerification
from app.models.favorites import CreatorFavorite
from app.models.handover import BusinessHandover
from app.models.identity import CreatorProfile, SocialAccount, SocialMetricsSnapshot, User
from app.models.jobs import Job
from app.models.notifications import DeviceToken
from app.models.oauth import OAuthState
from app.models.outbox import OutboundMessage
from app.models.reliability import ReliabilityEvent
from app.models.support import BusinessSupportAccess
from app.models.tiers import Tier, TierOffer
from app.models.tracking import CollaborationLink, LinkClick, LinkClickSalt
from app.models.venue_report import VenueReport

__all__ = [
    "CreatorFavorite",
    "AuditLog",
    "Base",
    "Booking",
    "Business",
    "BusinessHandover",
    "BusinessMenuPage",
    "BusinessPhoto",
    "BusinessSupportAccess",
    "BusinessMember",
    "CapacityException",
    "CapacityRule",
    "CatalogItem",
    "Collaboration",
    "ConfigurationChange",
    "CollaborationLink",
    "CreatorProfile",
    "DeviceToken",
    "EmailVerification",
    "MenuImport",
    "OAuthState",
    "OutboundMessage",
    "Proof",
    "RedemptionCode",
    "RefreshToken",
    "ReliabilityEvent",
    "Job",
    "LinkClick",
    "LinkClickSalt",
    "SocialAccount",
    "SocialMetricsSnapshot",
    "Subscription",
    "SubscriptionPlan",
    "Tier",
    "TierOffer",
    "User",
    "VenueReport",
]
