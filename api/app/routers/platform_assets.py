"""Les médias qui n'appartiennent à aucun commerce.

**Une seule route, et tout le lot.** Les six pastilles et le média d'accueil
sont demandés au même moment, à l'ouverture de Discovery ; deux routes auraient
fait deux allers-retours pour huit valeurs qui tiennent dans une réponse.

**Authentifiée, sans condition de rôle.** Les catégories ne sont pas
confidentielles, mais elles ne concernent personne qui ne soit pas entré ;
côté commerce comme côté créateur, un écran peut avoir à afficher une pastille.

Les clés rendues ici se servent par `/media/{clé}`, comme une couverture de
commerce — c'est la même route publique et le même dépôt.
"""

from fastapi import APIRouter

from app.core.dependencies import SessionDep
from app.schemas.platform_assets import (
    AccueilRead,
    CategoriePhotoRead,
    MediasPlateformeRead,
)
from app.services import platform_assets as service

router = APIRouter(prefix="/platform-media", tags=["platform-media"])


@router.get("", response_model=MediasPlateformeRead)
async def read_platform_media(session: SessionDep) -> MediasPlateformeRead:
    categories = await service.photos_de_categories(session)
    accueil = await service.media_d_accueil(session)
    return MediasPlateformeRead(
        categories=[
            CategoriePhotoRead(category=categorie, photo_key=cle)
            for categorie, cle in categories.items()
        ],
        home=AccueilRead(**accueil),
    )
