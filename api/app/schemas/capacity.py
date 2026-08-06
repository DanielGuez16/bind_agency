"""Schémas de capacité.

Les horaires sont des heures locales du commerce, pas des instants. Ils sont
saisis et stockés tels quels, sans conversion : une ouverture à neuf heures
reste neuf heures quel que soit le changement d'heure. La conversion n'a lieu
qu'au calcul de disponibilité, en phase 5.
"""

import uuid
from datetime import date as date_type
from datetime import time as time_type

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: Lundi vaut 0, comme `date.weekday()` en Python. Choix documenté ici parce que
#: `SPEC.md` dit seulement « 0-6 » et que Postgres, lui, compte dimanche à 0.
MONDAY = 0
SUNDAY = 6


class CapacityRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weekday: int = Field(ge=MONDAY, le=SUNDAY)
    start_time: time_type
    end_time: time_type
    concurrent_slots: int = Field(gt=0)

    @model_validator(mode="after")
    def _ordered(self) -> "CapacityRuleCreate":
        if self.start_time >= self.end_time:
            raise ValueError("l'heure de fin doit suivre l'heure de début")
        return self


class CapacityRuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weekday: int | None = Field(default=None, ge=MONDAY, le=SUNDAY)
    start_time: time_type | None = None
    end_time: time_type | None = None
    concurrent_slots: int | None = Field(default=None, gt=0)


class CapacityRuleRead(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    weekday: int
    start_time: time_type
    end_time: time_type
    concurrent_slots: int


class CapacityExceptionCreate(BaseModel):
    """Sans horaires, c'est une fermeture. Avec horaires, ils remplacent la règle du jour."""

    model_config = ConfigDict(extra="forbid")

    date: date_type
    start_time: time_type | None = None
    end_time: time_type | None = None
    concurrent_slots: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _coherent(self) -> "CapacityExceptionCreate":
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("les deux horaires vont ensemble, ou aucun")

        if self.start_time is None:
            if self.concurrent_slots is not None:
                raise ValueError("un jour fermé n'a pas de postes")
        else:
            if self.end_time is not None and self.start_time >= self.end_time:
                raise ValueError("l'heure de fin doit suivre l'heure de début")
            if self.concurrent_slots is None:
                raise ValueError("une journée aménagée doit dire combien de postes")

        return self


class CapacityExceptionRead(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    date: date_type
    #: Déduit de l'absence d'horaires, jamais saisi : deux façons de dire la
    #: même chose divergeraient.
    is_closed: bool
    start_time: time_type | None
    end_time: time_type | None
    concurrent_slots: int | None


class AvailabilityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_available: bool
