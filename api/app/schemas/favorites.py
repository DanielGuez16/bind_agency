"""Schémas des favoris d'une créatrice."""

import uuid

from pydantic import BaseModel, ConfigDict

from app.services.favorites import EtatDuFavori


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
