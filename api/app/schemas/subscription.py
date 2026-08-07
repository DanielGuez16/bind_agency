"""Schémas de l'abonnement commerce."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import BillingInterval, SubscriptionStatus


class SouscriptionDemandee(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_id: uuid.UUID


class PlanRead(BaseModel):
    """Le plan tel qu'un commerce le voit avant de souscrire.

    C'est le seul endroit du produit où un **commerce** lit un montant, et il
    s'agit de ce qu'il va payer — pas d'une valeur de prestation.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    price_cents: int
    currency: str
    billing_interval: BillingInterval
    features: dict


class AbonnementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plan_id: uuid.UUID
    status: SubscriptionStatus
    current_period_end: datetime | None
    #: Où saisir la carte. Nulle en mode journal, et nulle une fois le paiement
    #: abouti : offrir un lien mort serait pire que n'en offrir aucun.
    checkout_url: str | None = None
