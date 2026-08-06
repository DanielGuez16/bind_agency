"""Schémas du fil."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import BusinessCategory, ContentFormat, Platform
from app.services.eligibility import RaisonRefus


class ObstacleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    raison: RaisonRefus
    requis: Decimal | int | None
    constate: Decimal | int | None
    ecart: Decimal | int | None


class ItemDuFilRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tier_offer_id: uuid.UUID
    catalog_item_id: uuid.UUID
    tier_id: uuid.UUID
    #: Le compte qui ouvre ce palier. La réservation se fait au nom d'un compte
    #: précis, pas du créateur en général : le renvoyer ici évite à l'app de le
    #: redemander, et évite au créateur de choisir à l'aveugle.
    social_account_id: uuid.UUID
    name: str
    description: str | None
    price_cents: int
    currency: str
    duration_minutes: int | None
    requires_booking: bool
    platform: Platform
    content_format: ContentFormat
    value_ratio: Decimal | None


class CommerceDuFilRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    name: str
    category: BusinessCategory
    address: str | None
    distance_metres: float
    items: list[ItemDuFilRead]


class FilRead(BaseModel):
    """Le fil, et ce qui explique sa maigreur.

    `obstacles` accompagne toujours la réponse, même quand des commerces sont
    rendus : un créateur qui accède au palier story mais pas au palier reel doit
    savoir ce qui lui manque, sinon il croit avoir tout vu.
    """

    model_config = ConfigDict(from_attributes=True)

    commerces: list[CommerceDuFilRead]
    obstacles: list[ObstacleRead]
