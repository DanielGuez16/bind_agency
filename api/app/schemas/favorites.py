"""Schémas des favoris d'une créatrice."""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.enums import ContentFormat, Platform
from app.services.favorites import EtatDuFavori


class PalierDuFavoriRead(BaseModel):
    """Le palier qui ouvrirait cette prestation, et ce qui en sépare encore.

    **Le plus proche parmi les siens, pas le plus proche tout court.** La vue
    des paliers rend déjà « votre prochain palier » ; l'écrire ici ferait
    promettre « 18 000 abonnés, et il s'ouvre » d'un favori que ce palier
    n'ouvre pas — la seule promesse que cet écran est construit pour ne pas
    faire.
    """

    model_config = ConfigDict(from_attributes=True)

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    #: Combien d'abonnés il reste à faire sur le réseau de ce palier. **Nul
    #: quand ce n'est pas ce qui bloque** — un jeton mort, un relevé trop vieux,
    #: une revue en cours : « il vous manque 431 200 secondes » ne veut rien
    #: dire, et l'écran doit alors dire autre chose.
    abonnes_manquants: int | None


class FavoriDemande(BaseModel):
    """Ce qu'un cœur envoie : l'identifiant de la prestation, rien d'autre."""

    model_config = ConfigDict(extra="forbid")

    catalog_item_id: uuid.UUID


class FavoriRead(BaseModel):
    """Un favori, et ce qu'on peut en faire aujourd'hui.

    **De quoi rendre une carte sans second appel.** Le nom du salon, la durée,
    la contrepartie : la liste des favoris est un écran à part entière, pas un
    index d'identifiants que l'app irait résoudre un par un.
    """

    model_config = ConfigDict(from_attributes=True)

    catalog_item_id: uuid.UUID
    business_id: uuid.UUID
    business_name: str
    name: str
    description: str | None
    duration_minutes: int | None
    price_cents: int
    currency: str
    photo_key: str | None
    #: **Une prestation qui n'est plus réservable reste dans la liste.** La
    #: retirer sans un mot ferait croire à un mauvais appui ; les quatre états
    #: appellent quatre conduites — attendre la réouverture, monter d'un palier,
    #: choisir autre chose, ou réserver.
    etat: EtatDuFavori
    #: **Servi seulement quand `etat` vaut `hors_palier`.** C'est le seul cas où
    #: la question se pose, et le seul état sur lequel la créatrice peut agir :
    #: un salon en pause ne se débloque pas en gagnant des abonnés.
    palier_requis: PalierDuFavoriRead | None
