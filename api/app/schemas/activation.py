"""Schémas des étapes d'activation d'un commerce."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import BusinessStatus, SuspensionReason
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
    #: Pourquoi ce commerce est hors du fil. **Nul quand il n'y est pas** — la
    #: contrainte de la table le garantit : `(status = 'suspended') =
    #: (suspended_reason IS NOT NULL)`.
    #:
    #: **Un code, jamais du texte.** L'écran le traduit en anglais et en
    #: espagnol ; une phrase rendue par l'API ne passerait aucune des deux
    #: gardes de traduction, et le salon lirait l'anglais quoi qu'il ait choisi.
    #:
    #: **Deux valeurs, et ce sont les seules que le produit sache produire.**
    #: Un salon en pause l'a décidé lui-même, un salon dont la grâce a expiré
    #: n'a pas payé. Les deux se disent sans détour et n'appellent aucun message
    #: au support, ce qui est tout l'objet de ce champ.
    #:
    #: **La suspension punitive n'existe pas** — ni valeur, ni mécanisme qui y
    #: mène, ni arbitrage sur ce qui la déclencherait. Rendre `grace_expired`
    #: sous une phrase qui promet une sanction serait pire que le silence.
    #: Inscrite dans `TASKS.md` comme décision non prise, pas comme travail à
    #: venir.
    suspension_motif: SuspensionReason | None
    #: Depuis quand il est hors du fil. **La dernière sortie**, comme
    #: `en_ligne_depuis` est la dernière entrée : un salon qui s'est mis en
    #: pause deux étés de suite en a deux.
    #:
    #: Nulle quand il n'en est jamais sorti. Elle ne l'est pas quand il est
    #: revenu — c'est `status` qui dit s'il est dehors, celle-ci dit depuis
    #: quand, et l'écran ne la lit que sur un salon suspendu.
    suspendu_depuis: datetime | None
    #: Combien de jours la ligne de confirmation reste à l'écran. Servi parce
    #: que **c'est ce délai qui décide du champ au-dessus** : la règle vivait
    #: dans l'app seule, et deux copies d'un même délai finissent par diverger.
    confirmation_jours: int
