"""Les favoris d'une créatrice : poser un cœur, le retirer, relire la liste.

**Sur `/me` et réservées au créateur.** Un favori est une préférence
personnelle : il n'existe que pour celui qui le pose, et aucune route ne permet
de lire ceux d'un autre. Le commerce ne les voit pas — savoir qui vous garde
sous la main sans vous avoir réservé changerait la nature du geste.

**Sans coordonnées, et c'est le point.** Le fil est borné par une position et un
rayon ; un favori posé à Wynwood doit se relire depuis Kendall. Le brancher sur
le fil en aurait fait un filtre, c'est-à-dire une liste qui ne s'ouvre qu'à
l'endroit où on l'a remplie.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models.enums import UserRole
from app.schemas.favorites import FavoriDemande, FavoriRead
from app.services import favorites as service

router = APIRouter(
    prefix="/me/favorites",
    tags=["favorites"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)


@router.get("", response_model=list[FavoriRead])
async def read_favorites(user: CurrentUser, session: SessionDep) -> list[FavoriRead]:
    """La liste, la plus récente d'abord, chacune avec son état du jour."""
    return [
        FavoriRead.model_validate(favori)
        for favori in await service.lister(session, creator_id=user.id)
    ]


@router.post("", response_model=None, status_code=status.HTTP_204_NO_CONTENT)
async def add_favorite(payload: FavoriDemande, user: CurrentUser, session: SessionDep) -> None:
    """Pose le favori. **Le second appui ne fait rien et ne se plaint pas.**

    Le geste est un interrupteur : répondre 409 au second appui obligerait
    l'écran à traiter comme une erreur ce qui est le résultat voulu — la
    prestation est en favori. Et 204 plutôt que la ligne créée : l'écran sait
    déjà ce qu'il vient de mettre de côté, et le fil porte l'état du cœur.
    """
    try:
        await service.ajouter(session, creator_id=user.id, catalog_item_id=payload.catalog_item_id)
    except service.PrestationIntrouvable as erreur:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.CATALOG_ITEM_NOT_FOUND) from erreur
    await session.commit()


@router.delete("/{catalog_item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite(
    catalog_item_id: Annotated[uuid.UUID, Path()], user: CurrentUser, session: SessionDep
) -> None:
    """Retire le favori. Sans erreur s'il n'y en avait pas.

    « Il n'y avait rien à retirer » est le résultat voulu par quelqu'un qui
    appuie sur un cœur déjà vide — un double appui, un écran en retard.
    """
    await service.retirer(session, creator_id=user.id, catalog_item_id=catalog_item_id)
    await session.commit()
