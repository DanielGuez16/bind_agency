"""Schémas de composition des offres."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform


class TierOfferCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tier_id: uuid.UUID
    catalog_item_id: uuid.UUID


class TierOfferActivation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_active: bool


class TierOfferRead(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    tier_id: uuid.UUID
    catalog_item_id: uuid.UUID

    #: Rappelés en lecture pour éviter un aller-retour : l'écran de composition
    #: montre le palier et l'item, pas deux identifiants.
    platform: Platform
    content_format: ContentFormat
    item_name: str

    #: L'interrupteur propre à l'offre, celui que le commerce manipule.
    is_active: bool
    #: Calculé, jamais stocké. Une offre cesse d'être proposée si son palier est
    #: désactivé, ou si son item l'est — directement ou par son parent. Aucun de
    #: ces trois états n'est recopié sur l'offre.
    is_effectively_offered: bool

    created_at: datetime
