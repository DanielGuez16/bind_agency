"""Schémas de l'écran des paliers."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform
from app.schemas.obstacle import ObstacleRead


class PalierAccessibleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    min_followers: int
    min_completed_collabs: int
    min_reliability_score: Decimal | None
    value_ratio_hint: Decimal | None
    display_order: int
    accessible: bool
    social_account_id: uuid.UUID | None
    obstacles: list[ObstacleRead]


class VueDesPaliersRead(BaseModel):
    """Tous les paliers actifs, accessibles ou non.

    Les inaccessibles sont rendus avec leur obstacle : les masquer donnerait un
    écran vide à tout créateur qui débute, sans rien lui dire de ce qui
    l'attend. C'est l'inverse du fil, où un palier inaccessible ne doit
    justement pas apparaître.
    """

    model_config = ConfigDict(from_attributes=True)

    creator_id: uuid.UUID
    is_new_creator: bool
    paliers: list[PalierAccessibleRead]
