"""Schémas du reporting commerce.

Le seul montant rendu à un commerce, et il est du côté de ce qu'il **donne** :
`valeur_offerte_cents`. Ce n'est pas un revenu, et le nom le dit.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform


class LigneDePalierRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    publications: int
    valeur_offerte_cents: int


class LigneDItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    catalog_item_id: uuid.UUID
    name: str
    reservations: int
    consommations: int
    publications: int
    valeur_offerte_cents: int


class ReportingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    business_id: uuid.UUID
    currency: str
    #: Les bornes réellement employées. Rendues pour que le commerce puisse
    #: vérifier ce qui a été compté comme « son » mois.
    debut: datetime
    fin: datetime
    timezone: str

    reservations: int
    consommations: int
    annulations: int
    absences: int

    publications: int
    publications_attendues: int
    non_honorees: int

    valeur_offerte_cents: int
    #: Ordre de grandeur, jamais une audience atteinte. Le nom du champ le
    #: rappelle à qui le lit sans avoir lu la documentation.
    portee_approximative: int
    #: Nul quand rien n'a été consommé : zéro sur zéro n'est pas zéro, et
    #: afficher 0 % à un commerce qui n'a encore servi personne serait un
    #: reproche pour quelque chose qu'il n'a pas fait.
    taux_d_honoration: float | None

    par_palier: list[LigneDePalierRead]
    par_item: list[LigneDItemRead]
