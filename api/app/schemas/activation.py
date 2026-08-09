"""Schémas des étapes d'activation d'un commerce."""

from pydantic import BaseModel, ConfigDict

from app.models.enums import BusinessStatus
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


class VueDActivationRead(BaseModel):
    """Les étapes, **et où en est le commerce**.

    Le statut manquait : l'écran voyait six étapes faites et proposait
    « ouvrir mon commerce » à un commerce déjà ouvert depuis des semaines. Les
    étapes disent ce qui est prêt, elles ne disent pas ce qui a été décidé.
    """

    model_config = ConfigDict(from_attributes=True)

    status: BusinessStatus
    etapes: list[EtapeRead]
