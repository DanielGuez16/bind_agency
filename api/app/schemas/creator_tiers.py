"""Schémas de l'écran des paliers."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Neighborhood, Platform
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
    #: Combien de **prestations** ce palier ouvre dans le rayon demandé — la
    #: même grandeur qu'`offres_disponibles`, restreinte à la distance.
    offres_dans_le_rayon: int | None
    #: Combien de **commerces** proposent ce palier dans le rayon demandé.
    #: `null` quand aucune position n'a été fournie — une absence, pas un zéro :
    #: l'écran distingue « on n'a pas demandé » de « il n'y en a aucun ».
    commerces_dans_le_rayon: int | None


class FiabiliteRead(BaseModel):
    """Le score, et de combien de collaborations il est tiré.

    **Nul est une valeur, pas un manque.** L'app doit pouvoir distinguer « pas
    encore de score » de « score bas » : ce sont deux écrans différents, et
    répondre zéro à la première ferait d'un débutant quelqu'un de peu fiable.
    """

    model_config = ConfigDict(from_attributes=True)

    reliability_score: Decimal | None
    completed_collabs_count: int


class ProchainPalierRead(BaseModel):
    """Le palier fermé le plus proche.

    Le classement est fait par le serveur — on classe sur le **nombre** de
    conditions qui manquent, jamais sur leur ampleur — parce que le recopier
    côté écran en ferait une seconde vérité.
    """

    model_config = ConfigDict(from_attributes=True)

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    #: Le premier obstacle, celui que l'écran affiche.
    obstacle: ObstacleRead
    #: Combien de commerces le proposent à portée. `null` sans position — une
    #: absence, jamais un zéro.
    commerces_dans_le_rayon: int | None


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
    #: Le palier fermé le plus proche, et ce qu'il ouvrirait. **Venu du fil**,
    #: où il était servi à chaque chargement et lu nulle part depuis que
    #: l'écran qui le montre consulte cette route-ci.
    prochain_palier: ProchainPalierRead | None


class OffreDuPalierRead(BaseModel):
    """Une prestation ouverte à ce palier, où qu'elle soit.

    Rendue par `GET /me/tiers/{tier_id}/offres`, **sans borne de distance** : le
    fil est borné par un rayon par construction, et la bascule « près de vous /
    les douze » a besoin des objets, pas d'un nombre.
    """

    model_config = ConfigDict(from_attributes=True)

    tier_offer_id: uuid.UUID
    catalog_item_id: uuid.UUID
    business_id: uuid.UUID
    nom: str
    nom_du_commerce: str
    neighborhood: Neighborhood | None
    price_cents: int
    currency: str
    duration_minutes: int | None
    photo_key: str | None
    #: La distance, quand une position a été fournie. `null` sinon — ce qui
    #: distingue « loin » de « on ne sait pas d'où ».
    distance_metres: float | None
