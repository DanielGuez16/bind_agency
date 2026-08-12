"""Schémas du signalement de déplacement pour rien."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import VenueReportStatus


class SignalementDemande(BaseModel):
    """Ce que le créateur envoie. Rien d'obligatoire au-delà du geste."""

    model_config = ConfigDict(extra="forbid")

    #: Ce qu'il a vu. Facultatif : « c'était fermé » n'a pas toujours de détail
    #: à donner, et exiger une phrase pour signaler ajouterait un obstacle sur
    #: le recours qu'on essaie d'ouvrir.
    note: str | None = Field(default=None, max_length=500)


class SignalementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    booking_id: uuid.UUID
    status: VenueReportStatus
    reported_at: datetime
    note: str | None


class DecisionDeSignalement(BaseModel):
    """L'arbitrage. Retenu, ou écarté."""

    model_config = ConfigDict(extra="forbid")

    retenu: bool


class LigneDeSignalementRead(BaseModel):
    """Ce que l'arbitre lit. **Administration seulement.**

    Les deux compteurs ne sortent pas vers le salon ni vers le créateur : ce
    sont des éléments de décision, pas des faits établis, et les montrer
    ailleurs ferait juger sans arbitrage.
    """

    model_config = ConfigDict(from_attributes=True)

    report_id: uuid.UUID
    booking_id: uuid.UUID
    status: VenueReportStatus
    reported_at: datetime
    note: str | None
    starts_at: datetime | None
    business_id: uuid.UUID
    business_name: str
    creator_id: uuid.UUID
    signalements_ecartes_du_createur: int
    signalements_confirmes_du_salon: int
