"""Schémas du fil."""

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import BusinessCategory, ContentFormat, Neighborhood, Platform
from app.schemas.obstacle import ObstacleRead
from app.services.feed import OrigineDesSuggestions

__all__ = [
    "CommerceDuFilRead",
    "CompteParCategorieRead",
    "CompteParQuartierRead",
    "CompteParRayonRead",
    "OrigineDesSuggestions",
    "SuggestionsRead",
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
    #: Le quartier déclaré par le commerce. `null` hors des quartiers ouverts.
    neighborhood: Neighborhood | None
    cover_photo_key: str | None
    distance_metres: float
    items: list[ItemDuFilRead]


class CompteParCategorieRead(BaseModel):
    """Ce qu'une catégorie ouvrirait, dans le rayon courant."""

    model_config = ConfigDict(from_attributes=True)

    categorie: BusinessCategory
    commerces: int
    prestations: int


class CompteParQuartierRead(BaseModel):
    """Un quartier du fil courant : ses salons, ses prestations, sa distance.

    La distance est celle du **salon le plus proche**, jamais une moyenne : un
    quartier se choisit pour s'y rendre, et une moyenne ne désignerait aucun
    salon existant.
    """

    model_config = ConfigDict(from_attributes=True)

    quartier: Neighborhood
    commerces: int
    prestations: int
    distance_metres: float


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
    #: Les quartiers du fil rendu, du plus proche au plus lointain.
    quartiers: list[CompteParQuartierRead]
    #: Le palier le plus proche, et ce qu'il ouvrirait. `null` quand tout est
    #: ouvert, qu'aucun n'est atteignable, ou qu'il n'ouvrirait aucun salon.


class SuggestionDePrestationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    catalog_item_id: uuid.UUID
    business_id: uuid.UUID
    nom: str
    nom_du_commerce: str
    neighborhood: Neighborhood | None
    distance_metres: float


class SuggestionDeSalonRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    nom: str
    category: BusinessCategory
    neighborhood: Neighborhood | None
    distance_metres: float
    prestations: int


class SuggestionsRead(BaseModel):
    """Deux groupes, et **d'où ils sortent**.

    `origine` n'est pas une donnée de journal : c'est ce qui décide de la phrase
    affichée. « Populaire à Wynwood » et « À côté de vous » ne disent pas la
    même chose, et un salon proche annoncé comme populaire est un mensonge que
    personne ne peut vérifier. L'application a deux phrases, pas une phrase et
    deux contenus.
    """

    model_config = ConfigDict(from_attributes=True)

    prestations: list[SuggestionDePrestationRead]
    salons: list[SuggestionDeSalonRead]
    #: Le quartier de la position, `null` hors des quartiers ouverts.
    quartier: Neighborhood | None
    origine: OrigineDesSuggestions
