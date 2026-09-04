"""Schémas de composition des offres."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ContentFormat, Platform

#: Longueur maximale d'une mention. Un pseudonyme Instagram tient en trente
#: caractères, TikTok en vingt-quatre ; le double laisse la place à une phrase
#: courte — « @salon et @sa.marque » — sans ouvrir la porte à un paragraphe qui
#: ne tiendrait sur aucun écran.
MENTION_MAX = 60


class TierOfferCreate(BaseModel):
    """Ce qu'on pose en composant une offre.

    **Les critères de publication sont ici depuis qu'ils s'écrivent.** Ils
    existaient en base et dans toutes les lectures — fiche, contrepartie, file du
    commerce — sans qu'aucun schéma d'écriture ne les accepte : `extra="forbid"`
    sur ce modèle refusait le champ, et il n'existait pas d'`Update`. Le résultat
    tenait en une phrase : `required_mention` valait `NULL` sur chaque ligne de
    chaque environnement, et toute l'interface qui l'affiche était gardée
    derrière un test qui ne passait jamais.

    `SPEC.md` §2.5 dit « le commerce exprime ce qu'il attend d'une
    publication ». La surface d'expression manquait.
    """

    model_config = ConfigDict(extra="forbid")

    tier_id: uuid.UUID
    catalog_item_id: uuid.UUID

    #: Le compte à citer. Texte libre et non un identifiant : le salon écrit ce
    #: qu'il veut voir apparaître, et personne ne peut vérifier qu'un pseudonyme
    #: existe chez la plateforme sans le lui demander.
    required_mention: str | None = Field(default=None, max_length=MENTION_MAX)
    #: Le lieu attendu sur la publication. Sans le nom du salon, la consigne ne
    #: veut rien dire — c'est la contrepartie qui le sert, pas ce champ.
    required_geotag: bool = False


class TierOfferUpdate(BaseModel):
    """Ce qu'on corrige sur une offre déjà composée.

    **Seulement les critères.** Changer le palier ou la prestation d'une offre
    n'est pas une correction, c'est une autre offre : la clé unique porte les
    trois, et la déplacer laisserait les contreparties déjà nées pointer sur une
    composition qui n'a plus jamais existé.

    `required_geotag` est nullable ici et pas à la création : `exclude_unset`
    distingue « posé à faux » de « pas touché », et un `bool` non nullable ne
    permettrait plus de laisser le champ tranquille.
    """

    model_config = ConfigDict(extra="forbid")

    required_mention: str | None = Field(default=None, max_length=MENTION_MAX)
    required_geotag: bool | None = None


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

    #: Les critères de publication, relus. Sans eux l'écran de composition ne
    #: saurait pas ce qu'il vient d'enregistrer, et n'aurait aucune valeur à
    #: montrer au retour.
    required_mention: str | None
    required_geotag: bool

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
