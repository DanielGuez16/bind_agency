"""Schémas des étapes d'activation d'un commerce."""

from datetime import datetime

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
    #: Depuis quand ce commerce est en ligne. **Nulle tant qu'il ne l'a jamais
    #: été**, ce qui n'est pas une mise en pause — l'écran ne doit pas les
    #: confondre.
    #:
    #: Ici plutôt que sur la composition, où elle vivait sans lecteur : la
    #: journée charge déjà cette vue, donc la date arrive sans requête de plus.
    #: Un salon en ligne depuis huit jours n'a pas les mêmes questions qu'un
    #: salon en ligne depuis huit mois, et c'est l'écran du matin qui le voit.
    en_ligne_depuis: datetime | None
