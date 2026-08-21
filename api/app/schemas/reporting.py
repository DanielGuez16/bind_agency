"""Schémas du reporting commerce.

Le seul montant rendu à un commerce, et il est du côté de ce qu'il **donne** :
`valeur_offerte_cents`. Ce n'est pas un revenu, et le nom le dit.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform


class LigneDeSemaineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    #: Le lundi de la semaine, en date locale du commerce.
    debut: date
    publications: int


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


class PorteeLocaleRead(BaseModel):
    """Qui est autour du salon, et qui peut déjà réserver chez lui."""

    model_config = ConfigDict(from_attributes=True)

    #: Créatrices dans le rayon, avec au moins un réseau rattaché. Celles qui
    #: n'ont pas renseigné de position n'y sont pas : les compter ferait passer
    #: pour « autour de vous » quelqu'un qui est peut-être ailleurs.
    createurs: int
    #: Parmi elles, celles qui ouvrent au moins un palier du salon. **Jamais
    #: plus grand que `createurs`** — c'est la même population, filtrée. Zéro
    #: sur un total non nul dit que les paliers sont trop hauts, pas que le
    #: quartier est vide.
    peuvent_reserver: int
    #: Rendu avec les deux nombres : « 12 créatrices » ne veut rien dire sans
    #: « dans 10 km », et l'écran n'a pas à connaître un réglage du serveur.
    rayon_metres: int


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
    #: Signalements de déplacement pour rien retenus par l'arbitrage. Les
    #: signalements en attente n'y figurent pas : une allégation n'est pas un
    #: fait, et l'afficher ferait contester ce que personne n'a examiné.
    deplacements_pour_rien: int

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
    #: L'évolution, semaine par semaine. Un total ne dit pas s'il a été atteint
    #: régulièrement ou d'un seul coup.
    par_semaine: list[LigneDeSemaineRead]
    #: Le lundi de la semaine de la première réservation du salon, en date
    #: locale. **Calculé hors de la fenêtre demandée** : c'est une propriété du
    #: salon, et l'échelle du graphique peut commencer là plutôt que d'aligner
    #: trente jours de vide devant un compte ouvert la semaine dernière.
    #:
    #: Nul tant que rien ne s'est passé — et l'écran vide est alors le bon
    #: écran.
    premiere_semaine: date | None
    portee_locale: PorteeLocaleRead
