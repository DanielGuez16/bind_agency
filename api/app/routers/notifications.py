"""Enregistrer un terminal, et le révoquer.

Deux routes, toutes deux sur `/me` : ce sont **ses** terminaux. Aucune ne prend
d'identifiant d'utilisateur — le porter dans le chemin ouvrirait la question de
qui a le droit de le lire, alors que la réponse est « personne d'autre ».

**Les deux routes de préférences ont été retirées.** Le produit n'a plus de
réglage par genre : tout ce qu'il a à dire, il le dit. Ce qui reste ici n'est
pas une préférence mais un fait — un terminal existe ou non, et il se révoque
comme un jeton social.
"""

from fastapi import APIRouter

from app.core.dependencies import CurrentUser, SessionDep
from app.models.enums import DevicePlatform
from app.schemas.notifications import (
    TerminalEnregistre,
    TerminalRead,
)
from app.services import push as service

router = APIRouter(prefix="/me", tags=["notifications"])


@router.put("/devices", response_model=TerminalRead)
async def register_device(
    payload: TerminalEnregistre, user: CurrentUser, session: SessionDep
) -> TerminalRead:
    """Inscrit ou réactive un terminal. **Idempotent, et volontairement `PUT`.**

    L'app le rappelle à chaque démarrage : un jeton Expo change quand
    l'application est réinstallée, et une route qui créerait une ligne par appel
    en accumulerait une par ouverture. `PUT` dit ce qu'elle fait — poser un
    état, pas empiler des lignes.
    """
    terminal = await service.enregistrer_un_terminal(
        session, user_id=user.id, token=payload.token, platform=payload.platform
    )
    await session.commit()
    return TerminalRead.model_validate(terminal)


@router.delete("/devices/{token}", status_code=204)
async def revoke_device(token: str, user: CurrentUser, session: SessionDep) -> None:
    """Révoque **son** terminal.

    Rend 204 dans tous les cas, y compris quand le jeton n'était pas le sien :
    distinguer « révoqué » de « pas à vous » dirait à qui essaie des jetons
    lesquels existent. Il n'y a rien à apprendre d'un refus ici.
    """
    await service.revoquer_un_terminal(session, user_id=user.id, token=token)
    await session.commit()


__all__ = ["router", "DevicePlatform"]
