"""Schémas de la galerie photos d'un commerce."""

import uuid

from pydantic import BaseModel, ConfigDict, Field


class PhotoDuCommerceRead(BaseModel):
    """Une photo de la galerie. La clé, jamais une adresse.

    L'URL se compose à la lecture, côté client, à partir de la route des médias.
    Rendre une adresse figée ici la ferait expirer avec le fournisseur.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    storage_key: str
    position: int
    alt_text: str | None


class PhotoAjoutee(BaseModel):
    """Ce que le commerce envoie après avoir téléversé le fichier."""

    storage_key: str = Field(min_length=1, max_length=512)
    alt_text: str | None = Field(default=None, max_length=280)


class OrdreDeLaGalerie(BaseModel):
    """L'ordre complet, du premier au dernier.

    Complet et non partiel : un ordre qui ne cite qu'une partie des photos
    laisserait les autres à des positions arbitraires, et le commerce
    découvrirait un ordre qu'il n'a pas choisi.
    """

    photos: list[uuid.UUID] = Field(min_length=1)
