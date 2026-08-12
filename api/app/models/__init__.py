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
    BusinessPhoto,
    Subscription,
    SubscriptionPlan,
)
from app.models.catalog import CatalogItem, MenuImport
from app.models.collaboration import Collaboration, Proof
from app.models.identity import CreatorProfile, SocialAccount, SocialMetricsSnapshot, User
from app.models.jobs import Job
from app.models.notifications import DeviceToken, NotificationPreference
from app.models.oauth import OAuthState
from app.models.platform_asset import PlatformAsset
from app.models.reliability import ReliabilityEvent
from app.models.tiers import Tier, TierOffer
from app.models.tracking import CollaborationLink, LinkClick, LinkClickSalt

__all__ = [
    "AuditLog",
    "Base",
    "Booking",
    "Business",
    "BusinessPhoto",
    "BusinessMember",
    "CapacityException",
    "CapacityRule",
    "CatalogItem",
    "Collaboration",
    "CollaborationLink",
    "CreatorProfile",
    "DeviceToken",
    "MenuImport",
    "NotificationPreference",
    "OAuthState",
    "PlatformAsset",
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
]
