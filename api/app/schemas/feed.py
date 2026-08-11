"""Schémas du fil."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import BusinessCategory, ContentFormat, Platform
from app.schemas.obstacle import ObstacleRead

__all__ = [
    "CommerceDuFilRead",
    "CompteParCategorieRead",
    "CompteParRayonRead",
    "FilRead",
    "ItemDuFilRead",
    "ObstacleRead",
]


class ItemDuFilRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tier_offer_id: uuid.UUID
    catalog_item_id: uuid.UUID
    tier_id: uuid.UUID
    #: Le compte qui ouvre ce palier. La réservation se fait au nom d'un compte
    #: précis, pas du créateur en général : le renvoyer ici évite à l'app de le
    #: redemander, et évite au créateur de choisir à l'aveugle.
    social_account_id: uuid.UUID
    name: str
    description: str | None
    price_cents: int
    currency: str
    duration_minutes: int | None
    requires_booking: bool
    photo_key: str | None
    platform: Platform
    content_format: ContentFormat
    value_ratio: Decimal | None


class CommerceDuFilRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    name: str
    category: BusinessCategory
    address: str | None
    cover_photo_key: str | None
    distance_metres: float
    items: list[ItemDuFilRead]


class CompteParCategorieRead(BaseModel):
    """Ce qu'une catégorie ouvrirait, dans le rayon courant."""

    model_config = ConfigDict(from_attributes=True)

    categorie: BusinessCategory
    commerces: int
    prestations: int


class CompteParRayonRead(BaseModel):
    """Ce qu'un élargissement ouvrirait, filtre de catégorie conservé."""

    model_config = ConfigDict(from_attributes=True)

    rayon_metres: int
    commerces: int
    prestations: int


class FilRead(BaseModel):
    """Le fil, ce qui explique sa maigreur, et ce que chaque issue rapporterait.

    `obstacles` accompagne toujours la réponse, même quand des commerces sont
    rendus : un créateur qui accède au palier story mais pas au palier reel doit
    savoir ce qui lui manque, sinon il croit avoir tout vu.

    `categories` et `rayons` sortent **du même tamis que la liste** : mêmes
    paliers, mêmes items disponibles, même contrôle de créneau. Un compte
    calculé plus vite promettrait des salons que l'écran suivant ne rendrait
    pas, et « Élargir à 5 km · 9 salons » deviendrait un mensonge chiffré.
    """

    model_config = ConfigDict(from_attributes=True)

    commerces: list[CommerceDuFilRead]
    obstacles: list[ObstacleRead]
    #: Le rayon réellement appliqué, demandé ou par défaut. L'app ne le devine
    #: pas : c'est lui qui s'écrit dans « Wynwood · rayon 3 km ».
    rayon_metres: int
    total_prestations: int
    categories: list[CompteParCategorieRead]
    rayons: list[CompteParRayonRead]
