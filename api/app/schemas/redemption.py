"""Schémas du retrait."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import BookingStatus


class CodeAffiche(BaseModel):
    """Ce que le créateur montre. Le secret n'en fait évidemment pas partie."""

    booking_id: uuid.UUID
    #: La charge du QR : `identifiant:chiffres`. Rendue prête à encoder plutôt
    #: que laissée à composer côté app — deux façons de la former finiraient par
    #: diverger, et c'est le scanner qui refuserait sans dire pourquoi.
    payload: str
    code: str
    manual_code: str
    #: Pour que l'app anime le compte à rebours au lieu de redemander. Un écran
    #: qui change sans prévenir fait douter de ce qu'on montre.
    seconds_remaining: int
    rotation_seconds: int


class VerificationDemande(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Le contenu du QR, ou le code de secours tapé à la main. Une seule entrée
    #: pour les deux : la caisse ne sait pas toujours lequel elle a reçu.
    code: str = Field(min_length=1, max_length=200)


class VerificationRead(BaseModel):
    """Ce que la caisse doit servir, avant d'avoir rien consommé."""

    booking_id: uuid.UUID
    redemption_code_id: uuid.UUID
    #: Le pseudonyme du compte de cette réservation. **Jamais un nom civil** :
    #: la caisse composait « Rebecca Alvarez » depuis le profil, et un salon n'a
    #: aucune raison de connaître le nom légal de quelqu'un. Ce n'est pas le nom
    #: qui autorise le retrait, c'est le code.
    creator_handle: str | None
    item_name: str
    item_photo_key: str | None
    starts_at: datetime | None
    valid_until: datetime
    status: BookingStatus
    #: Vrai si le code de secours a servi. Affiché à la caisse : c'est le
    #: chemin le moins fort des deux, et elle a le droit de le savoir.
    par_secours: bool


class ConsommationDemande(BaseModel):
    model_config = ConfigDict(extra="forbid")

    redemption_code_id: uuid.UUID


class ConsommationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    booking_id: uuid.UUID
    status: BookingStatus
    consumed_at: datetime | None
