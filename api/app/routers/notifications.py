"""Enregistrer un terminal, et le révoquer.

Deux routes, toutes deux sur `/me` : ce sont **ses** terminaux. Aucune ne prend
d'identifiant d'utilisateur — le porter dans le chemin ouvrirait la question de
qui a le droit de le lire, alors que la réponse est « personne d'autre ».

**Les deux routes de préférences ont été retirées.** Le produit n'a plus de
réglage par genre : tout ce qu'il a à dire, il le dit. Ce qui reste ici n'est
pas une préférence mais un fait — un terminal existe ou non, et il se révoque
comme un jeton social.
"""

import uuid

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


@router.get("/devices", response_model=list[TerminalRead])
async def list_devices(user: CurrentUser, session: SessionDep) -> list[TerminalRead]:
    """Ses terminaux, le plus récemment vu en tête.

    **C'est ce qui rend la révocation utile.** Couper l'appareil qu'on tient est
    un confort ; couper celui qu'on a perdu est une mesure de sécurité, et elle
    demandait jusqu'ici de posséder un jeton qu'on n'a plus.

    `last_seen_at` est ce qui permet de choisir dans une liste de trois
    appareils du même modèle : sans elle, on ne distingue pas celui qu'on tient
    de celui qu'on a perdu il y a trois jours.

    Les révoqués y figurent : « cet appareil ne reçoit plus rien » est une
    réponse, et les faire disparaître laisserait croire qu'on a oublié de le
    couper.

    **Aucun jeton n'en sort.** Un identifiant opaque suffit à désigner, et
    rendre les jetons de tous les appareils d'un compte sur une seule réponse
    créerait une cible qui n'existait pas.
    """
    return [
        TerminalRead.model_validate(terminal)
        for terminal in await service.lister_les_terminaux(session, user_id=user.id)
    ]


@router.delete("/devices/{device_id}", status_code=204)
async def revoke_device(device_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> None:
    """Révoque **son** terminal, par son identifiant.

    **Par l'identifiant et non par le jeton**, et c'est un changement. Le jeton
    est un secret : le faire voyager dans une URL le dépose dans les journaux du
    serveur, ceux du mandataire et l'historique du client, pour désigner un
    objet qui a déjà un nom. Et on ne l'a pas quand l'appareil est perdu — ce
    qui est précisément le cas où l'on veut couper.

    Rend 204 dans tous les cas, y compris quand le terminal n'était pas le
    sien : distinguer « révoqué » de « pas à vous » dirait à qui essaie des
    identifiants lesquels existent. Il n'y a rien à apprendre d'un refus ici.
    """
    await service.revoquer_un_terminal(session, user_id=user.id, device_id=device_id)
    await session.commit()


__all__ = ["router", "DevicePlatform"]
