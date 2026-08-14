"""Schémas de la carte d'un commerce.

Jumeaux de ceux de la galerie, et séparés pour la même raison que les services :
les deux ont la même forme aujourd'hui et pas la même raison d'être.
"""

import uuid

from pydantic import BaseModel, ConfigDict, Field


class PageDeLaCarteRead(BaseModel):
    """Une page de la carte. La clé, jamais une adresse.

    L'URL se compose à la lecture, côté client, à partir de la route des médias.
    Rendre une adresse figée ici la ferait expirer avec le fournisseur.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    storage_key: str
    position: int
    alt_text: str | None


class PageAjoutee(BaseModel):
    """Ce que le commerce envoie après avoir téléversé le fichier."""

    storage_key: str = Field(min_length=1, max_length=512)
    alt_text: str | None = Field(default=None, max_length=280)


class OrdreDeLaCarte(BaseModel):
    """L'ordre complet, de la première page à la dernière.

    Complet et non partiel : une carte dont l'ordre ne cite qu'une partie des
    pages laisserait les autres à des positions arbitraires, et le commerce
    découvrirait des desserts avant les entrées.
    """

    pages: list[uuid.UUID] = Field(min_length=1)
