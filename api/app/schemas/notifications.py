"""Schémas des terminaux et des préférences de notification."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import DevicePlatform, DeviceTokenStatus, NotificationKind


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


class PreferenceEcrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class PreferencesRead(BaseModel):
    """Les sept genres et leur état.

    Un dictionnaire complet plutôt qu'une liste de refus : l'app dessine ses
    sept lignes sans connaître la liste, et une absence ne se lit pas comme un
    genre inexistant.
    """

    preferences: dict[NotificationKind, bool]
