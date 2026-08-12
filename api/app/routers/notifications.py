"""Enregistrer un terminal, le révoquer, régler ses préférences.

Quatre routes, toutes sur `/me` : ce sont **ses** terminaux et **ses**
préférences. Aucune ne prend d'identifiant d'utilisateur — le porter dans le
chemin ouvrirait la question de qui a le droit de le lire, alors que la réponse
est « personne d'autre ».
"""

from typing import Annotated

from fastapi import APIRouter, Body

from app.core.dependencies import CurrentUser, SessionDep
from app.models.enums import DevicePlatform, NotificationKind
from app.schemas.notifications import (
    PreferenceEcrite,
    PreferencesRead,
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


@router.get("/notification-preferences", response_model=PreferencesRead)
async def read_preferences(user: CurrentUser, session: SessionDep) -> PreferencesRead:
    """Les sept genres et leur état.

    Tous les sept, y compris ceux que personne n'a touchés : un écran de
    réglages doit pouvoir se dessiner sans connaître la liste.
    """
    return PreferencesRead(preferences=await service.preferences(session, user_id=user.id))


@router.put("/notification-preferences/{kind}", response_model=PreferencesRead)
async def set_preference(
    kind: NotificationKind,
    payload: Annotated[PreferenceEcrite, Body()],
    user: CurrentUser,
    session: SessionDep,
) -> PreferencesRead:
    """Coupe ou rouvre un genre.

    Le genre est un membre de l'énumération : un genre inconnu est refusé par
    la validation, avec un 422 nommé, plutôt que d'écrire une ligne que
    personne ne lira jamais.
    """
    await service.regler(session, user_id=user.id, kind=kind, enabled=payload.enabled)
    await session.commit()
    return PreferencesRead(preferences=await service.preferences(session, user_id=user.id))


__all__ = ["router", "DevicePlatform"]
