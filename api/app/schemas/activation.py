"""Schémas des étapes d'activation d'un commerce."""

from pydantic import BaseModel, ConfigDict

from app.services.business import EtapeActivation


class EtapeRead(BaseModel):
    """Une étape, faite ou non, bloquante ou non.

    Pas de pourcentage : « 2 étapes sur 4 » se comprend, « 50 % » ne dit pas
    laquelle manque. Et une étape non bloquante n'est pas un demi-échec.
    """

    model_config = ConfigDict(from_attributes=True)

    cle: EtapeActivation
    done: bool
    blocking: bool
