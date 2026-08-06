"""Schémas du profil commerce."""

import uuid
from datetime import datetime
from zoneinfo import available_timezones

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.integrations.geocoding import LATITUDE_RANGE, LONGITUDE_RANGE
from app.models.enums import BusinessCategory, BusinessStatus, Locale

DEFAULT_TIMEZONE = "America/New_York"


# Calculé une fois : `available_timezones()` parcourt la base de fuseaux.
_TIMEZONES = frozenset(available_timezones())


def _check_timezone(value: str | None) -> str | None:
    """Le fuseau est déclaré, jamais déduit des coordonnées ni de l'adresse.

    Validé contre la base de fuseaux du système, pas contre une liste recopiée
    qui prendrait du retard au prochain changement politique.
    """
    if value is None:
        return None
    if value not in _TIMEZONES:
        raise ValueError(f"fuseau inconnu de la base de fuseaux : {value}")
    return value


class CoordinatesPayload(BaseModel):
    longitude: float = Field(ge=LONGITUDE_RANGE[0], le=LONGITUDE_RANGE[1])
    latitude: float = Field(ge=LATITUDE_RANGE[0], le=LATITUDE_RANGE[1])


class BusinessCreate(BaseModel):
    """`extra="forbid"` : un champ inconnu est refusé plutôt qu'ignoré en silence."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    category: BusinessCategory
    currency: str = Field(min_length=3, max_length=3)
    address: str | None = Field(default=None, max_length=500)
    coordinates: CoordinatesPayload | None = None
    timezone: str = DEFAULT_TIMEZONE
    default_locale: Locale = Locale.EN
    phone: str | None = Field(default=None, max_length=40)

    @field_validator("currency")
    @classmethod
    def _iso_4217(cls, value: str) -> str:
        if not value.isalpha():
            raise ValueError("code devise ISO 4217 attendu, trois lettres")
        return value.upper()

    @field_validator("timezone")
    @classmethod
    def _timezone_exists(cls, value: str) -> str:
        return _check_timezone(value)  # type: ignore[return-value]


class BusinessUpdate(BaseModel):
    """La devise n'y figure pas, et `extra="forbid"` fait que l'envoyer est une erreur.

    Elle est déclarée à la création et ne bouge plus : des montants historiques
    changeraient de sens. Un trigger le garantit aussi côté base.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: BusinessCategory | None = None
    address: str | None = Field(default=None, max_length=500)
    coordinates: CoordinatesPayload | None = None
    timezone: str | None = None
    default_locale: Locale | None = None
    phone: str | None = Field(default=None, max_length=40)

    @field_validator("timezone")
    @classmethod
    def _timezone_exists(cls, value: str | None) -> str | None:
        return _check_timezone(value)


class BusinessRead(BaseModel):
    id: uuid.UUID
    name: str
    category: BusinessCategory
    address: str | None
    coordinates: CoordinatesPayload | None
    timezone: str
    default_locale: Locale
    phone: str | None
    currency: str
    status: BusinessStatus
    created_at: datetime
