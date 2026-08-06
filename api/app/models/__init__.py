"""Modèles SQLAlchemy.

Tout modèle doit être importé ici : c'est ce que lit `alembic/env.py` pour
l'autogénération. Un modèle absent de ce fichier est invisible aux migrations.
"""

from app.models.audit import AuditLog
from app.models.auth import RefreshToken
from app.models.base import Base
from app.models.booking import Booking, CapacityException, CapacityRule, RedemptionCode
from app.models.business import Business, BusinessMember, Subscription, SubscriptionPlan
from app.models.catalog import CatalogItem, MenuImport
from app.models.collaboration import Collaboration, Proof
from app.models.identity import CreatorProfile, SocialAccount, SocialMetricsSnapshot, User
from app.models.oauth import OAuthState
from app.models.reliability import ReliabilityEvent
from app.models.tiers import Tier, TierOffer

__all__ = [
    "AuditLog",
    "Base",
    "Booking",
    "Business",
    "BusinessMember",
    "CapacityException",
    "CapacityRule",
    "CatalogItem",
    "Collaboration",
    "CreatorProfile",
    "MenuImport",
    "OAuthState",
    "Proof",
    "RedemptionCode",
    "RefreshToken",
    "ReliabilityEvent",
    "SocialAccount",
    "SocialMetricsSnapshot",
    "Subscription",
    "SubscriptionPlan",
    "Tier",
    "TierOffer",
    "User",
]
