"""Schémas des plans d'abonnement.

Le seul schéma du produit qui porte des montants, servi au seul rôle
administrateur.
"""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.enums import BillingInterval, BusinessCategory


class PlanAdministrateurRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    plan_id: uuid.UUID
    name: str
    category: BusinessCategory
    price_cents: int
    currency: str
    billing_interval: BillingInterval
    features: dict
    is_active: bool
    subscriptions_count: int
    active_subscriptions_count: int
    #: Ramené au mois par le service, pas par l'écran : un plan annuel et un
    #: plan mensuel n'ont pas la même unité, et la conversion est une règle de
    #: facturation, pas une décision de mise en page.
    mrr_cents: int
