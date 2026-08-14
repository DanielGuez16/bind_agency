"""Schémas de la fiche publique d'un commerce."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import BusinessCategory, ContentFormat, Platform
from app.schemas.obstacle import ObstacleRead


class OffreDeLaFicheRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tier_offer_id: uuid.UUID
    catalog_item_id: uuid.UUID
    tier_id: uuid.UUID
    name: str
    description: str | None
    price_cents: int
    currency: str
    duration_minutes: int | None
    requires_booking: bool
    photo_key: str | None
    #: La prestation laisse-t-elle un choix au créateur. Vrai : il choisira sur
    #: place, et c'est la carte qui lui dit quoi.
    leaves_choice: bool
    platform: Platform
    content_format: ContentFormat
    #: Ce que le commerce attend dans la publication. Rappelé **avant** la
    #: réservation : le créateur s'engage en connaissance, et ne découvre pas
    #: l'exigence sur son écran de preuve.
    required_mention: str | None
    required_geotag: bool
    value_ratio: Decimal | None
    accessible: bool
    social_account_id: uuid.UUID | None
    obstacles: list[ObstacleRead]
    prochains_creneaux: list[datetime]


class FichePubliqueRead(BaseModel):
    """Profil, photos, offres, disponibilités. Rien d'autre.

    Ni les réservations, ni les membres, ni le reporting : ce sont les données
    du commerce, pas celles de sa vitrine.
    """

    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    name: str
    category: BusinessCategory
    address: str | None
    timezone: str
    phone: str | None
    cover_photo_key: str | None
    #: Les clés de la galerie, dans l'ordre du commerce. Jamais des adresses.
    photos: list[str]
    #: Les pages de la carte, dans l'ordre où elle se lit. **Un accès à part
    #: de la galerie** : montrer le lieu et consulter une carte sont deux
    #: gestes différents.
    menu_pages: list[str]
    #: L'adresse de la carte en ligne. Quand `menu_pages` est vide et que
    #: celle-ci est renseignée, l'écran doit **dire qu'on sortira de
    #: l'application** avant d'ouvrir le lien.
    menu_url: str | None
    offres: list[OffreDeLaFicheRead]
