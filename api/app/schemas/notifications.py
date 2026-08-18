"""Schémas des terminaux et des préférences de notification."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import DevicePlatform, DeviceTokenStatus


class TerminalEnregistre(BaseModel):
    """Ce que l'app envoie au démarrage."""

    model_config = ConfigDict(extra="forbid")

    #: Le jeton Expo, opaque. Borné parce qu'un champ de texte sans borne est
    #: une invitation ; sa forme réelle fait une centaine de caractères.
    token: str = Field(min_length=8, max_length=512)
    #: Rendue par l'app, pas déduite du jeton : déduire reviendrait à lire un
    #: format qui ne nous appartient pas et qu'Expo peut changer.
    platform: DevicePlatform


class TerminalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    platform: DevicePlatform
    status: DeviceTokenStatus
    last_seen_at: datetime
