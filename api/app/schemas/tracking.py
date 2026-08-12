"""Schémas du lien traqué et de l'audience mesurée.

**Aucun de ces schémas ne porte d'adresse IP**, et aucun n'en portera : elle
n'est jamais entrée en base, il n'y a donc rien à en sortir. Ce fichier est
aussi le dernier endroit où l'on pourrait la laisser fuir, d'où la mention.
"""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import DeviceFamily


class LienRead(BaseModel):
    """Le lien qu'un créateur place dans son sticker."""

    model_config = ConfigDict(from_attributes=True)

    collaboration_id: uuid.UUID
    slug: str
    #: L'adresse complète à copier. Assemblée par le serveur : l'app la
    #: recomposerait à partir d'une base qu'elle devrait connaître, et les deux
    #: divergeraient au premier changement de domaine.
    url: str
    is_active: bool


class LigneDePaysRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    country_code: str | None
    clics: int


class LigneDeVilleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    city: str | None
    region: str | None
    country_code: str | None
    clics: int


class LigneDeTerminalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    device_family: DeviceFamily
    clics: int


class LigneDeReferentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    referrer_host: str | None
    clics: int


class EcartesRead(BaseModel):
    """Ce qui n'a pas compté, et pourquoi.

    Rendu plutôt que tu : un compteur qui n'avance pas s'explique mieux avec
    « quatre-vingts préchargements » qu'avec le silence.
    """

    model_config = ConfigDict(from_attributes=True)

    robots: int
    prechargements: int
    doublons: int
    total: int


class SignalRead(BaseModel):
    """Un fait anormal, nommé, avec les deux nombres qui l'ont déclenché.

    Un code, jamais une phrase : la liste est fermée et se traduit à
    l'affichage, comme les motifs de refus et les codes d'obstacle.
    """

    model_config = ConfigDict(from_attributes=True)

    code: str
    constate: Decimal
    seuil: Decimal


class AudienceDesLiensRead(BaseModel):
    """L'audience réellement mesurée, par opposition à celle qu'on prédisait."""

    model_config = ConfigDict(from_attributes=True)

    clics: int
    clics_locaux: int
    #: Le rayon appliqué : sans lui, « 62 % de local » ne dit pas de quelle
    #: zone il parle.
    rayon_local_metres: int
    #: Nulle et non zéro quand rien n'a été cliqué. Zéro sur zéro n'est pas
    #: zéro, et l'afficher serait un reproche pour ce qui n'a pas eu lieu.
    part_locale: Decimal | None
    #: Pèse zéro tant que le poids est à zéro en configuration. Rendu quand
    #: même : la mécanique existe et doit pouvoir s'observer avant de peser.
    score_impact_local: Decimal | None
    par_pays: list[LigneDePaysRead]
    par_ville: list[LigneDeVilleRead]
    par_terminal: list[LigneDeTerminalRead]
    par_referent: list[LigneDeReferentRead]
    ecartes: EcartesRead


class AudienceArbitrableRead(AudienceDesLiensRead):
    """La même, plus les doutes. **Administration seulement.**

    Les signaux ne sortent pas vers le salon ni vers le créateur : un doute
    n'est pas un fait, et le montrer au commerce ferait refuser des
    publications sur une heuristique que personne n'a arbitrée.
    """

    signaux: list[SignalRead]
