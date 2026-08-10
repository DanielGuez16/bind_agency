"""Médias de la plateforme, en lecture."""

from pydantic import BaseModel

from app.models.enums import BusinessCategory


class CategoriePhotoRead(BaseModel):
    category: BusinessCategory
    #: `None` quand aucune photo n'a été posée : la pastille s'affiche quand
    #: même, avec le repli de l'app. Une catégorie sans image reste une
    #: catégorie sur laquelle on peut filtrer.
    photo_key: str | None


class AccueilRead(BaseModel):
    video_key: str | None
    poster_key: str | None


class MediasPlateformeRead(BaseModel):
    categories: list[CategoriePhotoRead]
    home: AccueilRead
