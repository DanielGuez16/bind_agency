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
    """Les quatre médias de l'accueil, chacun pouvant manquer séparément.

    L'app choisit l'orientation qui lui va et se replie sur l'autre : c'est elle
    qui connaît son format, et rendre « la bonne » depuis le serveur reviendrait
    à décider d'ici d'une chose qu'on ne peut pas y savoir.
    """

    video_key: str | None
    poster_key: str | None
    video_portrait_key: str | None
    poster_portrait_key: str | None


class MediasPlateformeRead(BaseModel):
    categories: list[CategoriePhotoRead]
    home: AccueilRead
