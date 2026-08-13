"""Schémas des paliers.

Configuration globale de la plateforme, jamais modifiée par un commerce.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ContentFormat, Platform


class TierCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: Platform
    content_format: ContentFormat
    min_followers: int = Field(ge=0)
    min_completed_collabs: int = Field(default=0, ge=0)
    min_reliability_score: Decimal | None = Field(default=None, ge=0, le=100)
    value_ratio_hint: Decimal | None = Field(default=None, ge=0)
    display_order: int = Field(ge=0)
    is_active: bool = True


class TierUpdate(BaseModel):
    """`platform` et `content_format` n'y figurent pas.

    Ce couple identifie le palier. Le changer ferait qu'une offre composée pour
    « story Instagram » se retrouverait sur « reel TikTok » sans que le commerce
    ait rien demandé. Créer un palier est la bonne réponse.
    """

    model_config = ConfigDict(extra="forbid")

    min_followers: int | None = Field(default=None, ge=0)
    min_completed_collabs: int | None = Field(default=None, ge=0)
    min_reliability_score: Decimal | None = Field(default=None, ge=0, le=100)
    value_ratio_hint: Decimal | None = Field(default=None, ge=0)
    display_order: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class TierRead(BaseModel):
    id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    min_followers: int
    min_completed_collabs: int
    #: Nul veut dire « aucune condition de score », pas « score zéro exigé ».
    min_reliability_score: Decimal | None
    #: Ratio de valeur indicatif. Son usage d'affichage viendra avec le fil.
    value_ratio_hint: Decimal | None
    display_order: int
    is_active: bool


class ConfigurationChangeRead(BaseModel):
    """Une modification de configuration, telle qu'on la relit.

    Les valeurs sont du texte : c'est ce qui a été écrit, et un journal qui les
    retyperait se tromperait le jour où la colonne change de type — c'est-à-dire
    précisément le jour où l'on vient le relire.
    """

    model_config = ConfigDict(from_attributes=True)

    entity_type: str
    entity_id: uuid.UUID
    field: str
    value_before: str | None
    value_after: str | None
    actor_user_id: uuid.UUID
    changed_at: datetime
