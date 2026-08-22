"""Médias de la plateforme, en lecture."""

from pydantic import BaseModel

from app.models.enums import BusinessCategory


class CategoriePhotoRead(BaseModel):
    category: BusinessCategory
    #: `None` quand aucune photo n'a été posée : la pastille s'affiche quand
    #: même, avec le repli de l'app. Une catégorie sans image reste une
    #: catégorie sur laquelle on peut filtrer.
    photo_key: str | None


class MediasPlateformeRead(BaseModel):
    """Les photos de catégorie, et rien d'autre.

    **Le média d'accueil est parti avec l'écran qui le montrait.** La vidéo de
    fond servait à donner envie sur un écran dont le seul travail est de faire
    choisir un rôle, et elle coûtait six mécanismes — repli sur l'affiche,
    choix d'orientation, hors-ligne, reprise au premier plan, relance après
    montage, boucle garantie deux fois. La planche v3 l'a retirée ; le
    manifeste continuait de la servir à personne.

    Les fichiers restent dans le dépôt d'objets : ce qu'on retire ici est un
    champ servi sans lecteur, pas des médias qu'on jette.
    """

    categories: list[CategoriePhotoRead]
