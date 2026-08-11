"""Schémas de l'écran des paliers."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform
from app.schemas.obstacle import ObstacleRead


class PalierAccessibleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    min_followers: int
    min_completed_collabs: int
    min_reliability_score: Decimal | None
    value_ratio_hint: Decimal | None
    display_order: int
    accessible: bool
    social_account_id: uuid.UUID | None
    obstacles: list[ObstacleRead]
    #: Ce que le palier ouvre. Zéro est une réponse, pas une absence : un palier
    #: qu'aucun commerce n'a encore composé se dit, il ne se masque pas.
    offres_disponibles: int


class FiabiliteRead(BaseModel):
    """Le score, et de combien de collaborations il est tiré.

    **Nul est une valeur, pas un manque.** L'app doit pouvoir distinguer « pas
    encore de score » de « score bas » : ce sont deux écrans différents, et
    répondre zéro à la première ferait d'un débutant quelqu'un de peu fiable.
    """

    model_config = ConfigDict(from_attributes=True)

    reliability_score: Decimal | None
    completed_collabs_count: int


class VueDesPaliersRead(BaseModel):
    """Tous les paliers actifs, accessibles ou non.

    Les inaccessibles sont rendus avec leur obstacle : les masquer donnerait un
    écran vide à tout créateur qui débute, sans rien lui dire de ce qui
    l'attend. C'est l'inverse du fil, où un palier inaccessible ne doit
    justement pas apparaître.
    """

    model_config = ConfigDict(from_attributes=True)

    creator_id: uuid.UUID
    is_new_creator: bool
    #: La condition que personne ne connaît. Elle ferme des paliers sans jamais
    #: s'être montrée : `reliability_score_too_low` cite un seuil que l'écran ne
    #: pouvait comparer à rien.
    fiabilite: FiabiliteRead
    paliers: list[PalierAccessibleRead]
