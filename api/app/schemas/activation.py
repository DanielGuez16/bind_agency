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
    #: Combien de créatrices peuvent réserver chez lui, aujourd'hui.
    #:
    #: **C'est ce qui rassure un salon qui vient d'apparaître.** « En ligne
    #: depuis trois jours » est vrai et ne dit rien ; « et 41 créatrices peuvent
    #: vous réserver » est la moitié de la phrase qui manquait.
    #:
    #: **Nul hors de la fenêtre de confirmation**, et alors pas même calculé :
    #: quatre requêtes et une boucle sur le quartier, sur l'écran le plus ouvert
    #: du produit, pour une ligne que personne ne regarde plus. Le délai est
    #: `confirmation_jours`, servi juste en dessous pour que la règle ait une
    #: seule origine.
    #:
    #: Nul aussi quand le salon n'est pas en ligne : la question ne se pose pas
    #: avant d'avoir paru.
    createurs_qui_peuvent_reserver: int | None
    #: Combien de jours la ligne de confirmation reste à l'écran. Servi parce
    #: que **c'est ce délai qui décide du champ au-dessus** : la règle vivait
    #: dans l'app seule, et deux copies d'un même délai finissent par diverger.
    confirmation_jours: int
