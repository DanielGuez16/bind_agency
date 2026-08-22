"""Schémas de composition des offres."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform


class TierOfferCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tier_id: uuid.UUID
    catalog_item_id: uuid.UUID


class TierOfferActivation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_active: bool


class TierOfferRead(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    tier_id: uuid.UUID
    catalog_item_id: uuid.UUID

    #: Rappelés en lecture pour éviter un aller-retour : l'écran de composition
    #: montre le palier et l'item, pas deux identifiants.
    platform: Platform
    content_format: ContentFormat
    item_name: str

    #: L'interrupteur propre à l'offre, celui que le commerce manipule.
    is_active: bool
    #: Calculé, jamais stocké. Une offre cesse d'être proposée si son palier est
    #: désactivé, ou si son item l'est — directement ou par son parent. Aucun de
    #: ces trois états n'est recopié sur l'offre.
    is_effectively_offered: bool

    created_at: datetime


class PalierPourUnePrestationRead(BaseModel):
    """Un palier vu depuis une prestation : combien de créatrices, et est-il déjà offert.

    **Nommée pour la prestation et non pour le compte**, à dessein : elle porte
    un champ de plus que `portee_locale.CreatricesDUnPalier` — `deja_offert`,
    que seul le routeur connaît. Le couple `X`/`XRead` que le dépôt utilise
    ailleurs suppose que les deux ont les mêmes champs, et une garde le vérifie ;
    lui donner le nom de la structure ferait croire qu'on peut valider l'une
    depuis l'autre, ce qui rendrait un 500 sur chaque appel.

    **Un total, pas un gain.** `portee.gains_par_palier` répond « combien en
    plus si j'ouvre ce palier » et ne liste que les paliers fermés. Celui-ci
    répond « combien à ce palier-là », pour tous — et c'est ce qui permet la
    phrase « ces 103 créatrices deviennent 12 si je monte cette prestation d'un
    palier », dont les deux paliers sont ouverts et dont aucun gain ne parle.

    Le compte ne dépend pas de la prestation : l'éligibilité regarde une
    créatrice et un palier. Ce qui en dépend, c'est `deja_offert`.
    """

    model_config = ConfigDict(from_attributes=True)

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    #: Créatrices du rayon qui ouvrent ce palier, quel que soit ce que le salon
    #: offre aujourd'hui.
    creatrices: int
    #: Vrai quand **cette prestation** porte déjà ce palier. C'est la seule
    #: chose que la prestation change, et sans elle l'écran ne saurait pas
    #: lequel des deux nombres est celui d'aujourd'hui.
    deja_offert: bool
