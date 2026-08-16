"""Schémas de réservation."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import BookingStatus


class BookingCreate(BaseModel):
    """`starts_at` est absent pour un item sans créneau, et obligatoire sinon.

    La règle n'est pas exprimée ici mais dans le service : elle dépend de
    l'item, que le schéma ne connaît pas. Deux refus distincts la portent, pour
    que l'app puisse dire lequel des deux s'applique.
    """

    model_config = ConfigDict(extra="forbid")

    tier_offer_id: uuid.UUID
    social_account_id: uuid.UUID
    starts_at: datetime | None = None


class BookingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    tier_offer_id: uuid.UUID
    catalog_item_id: uuid.UUID
    social_account_id: uuid.UUID
    requires_booking: bool
    duration_minutes: int | None
    starts_at: datetime | None
    ends_at: datetime | None
    valid_until: datetime
    status: BookingStatus
    #: L'échéance du garde. Rendue pour que l'app puisse afficher le compte à
    #: rebours : une place tenue sans qu'on sache jusqu'à quand est une place
    #: qu'on croit acquise.
    hold_expires_at: datetime | None
    #: L'échéance de l'accord du commerce. Nulle hors d'`awaiting_business`.
    approval_expires_at: datetime | None
    value_cents_snapshot: int
