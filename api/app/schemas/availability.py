"""Schémas de la disponibilité."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CreneauRead(BaseModel):
    """Un début possible, et ce qu'il reste de places.

    `places_restantes` est rendu plutôt que caché : l'app peut signaler
    « dernière place » sans redemander, et c'est une information que le créateur
    utilise pour décider.
    """

    model_config = ConfigDict(from_attributes=True)

    starts_at: datetime
    ends_at: datetime
    places_restantes: int
