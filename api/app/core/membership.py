"""Appartenance pour les ressources sans `business_id` dans le chemin.

`require_business_member` ne sait lire l'identifiant du commerce que dans
l'URL. Une réservation, une contrepartie, une preuve, un code de retrait n'y
portent pas le leur : leur route est `/bookings/{booking_id}`, pas
`/businesses/{business_id}/bookings/{booking_id}` — et l'imbriquer serait
mentir, puisque le créateur accède aux mêmes ressources sans passer par un
commerce.

Sans cette dépendance, chaque route de ce genre écrirait son propre contrôle en
ligne, et **c'est le point de fuite le plus probable du projet** : il suffit
d'un routeur où l'on a oublié le `WHERE business_id = …` pour qu'un membre du
commerce A lise les réservations du commerce B.

**Un résolveur par type de ressource**, chacun disant comment remonter jusqu'au
commerce. La chaîne est explicite et se relit :

    booking          → business_id
    collaboration    → booking → business_id
    proof            → collaboration → booking → business_id
    redemption_code  → booking → business_id

**403, jamais 404.** Une ressource inexistante et une ressource d'un autre
commerce reçoivent la même réponse. Distinguer les deux transformerait la route
en oracle : on lit l'existence d'une réservation en observant lequel des deux
codes revient.
"""

import uuid
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import sqlalchemy as sa
from fastapi import Depends, Path, status

from app.core.dependencies import CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.models import Booking, BusinessMember, Collaboration, Proof, RedemptionCode
from app.models.enums import UserRole

#: Comment remonter de chaque ressource à son commerce. Une requête par type,
#: écrite une fois : une route qui recopierait la jointure pourrait en oublier
#: un maillon sans que rien ne le dise.
CHEMINS_VERS_LE_COMMERCE: dict[str, Callable[[uuid.UUID], sa.Select]] = {
    "booking": lambda id_: sa.select(Booking.business_id).where(Booking.id == id_),
    "collaboration": lambda id_: (
        sa.select(Booking.business_id)
        .join(Collaboration, Collaboration.booking_id == Booking.id)
        .where(Collaboration.id == id_)
    ),
    "proof": lambda id_: (
        sa.select(Booking.business_id)
        .join(Collaboration, Collaboration.booking_id == Booking.id)
        .join(Proof, Proof.collaboration_id == Collaboration.id)
        .where(Proof.id == id_)
    ),
    "redemption_code": lambda id_: (
        sa.select(Booking.business_id)
        .join(RedemptionCode, RedemptionCode.booking_id == Booking.id)
        .where(RedemptionCode.id == id_)
    ),
}


def require_member_of(
    ressource: str, *, param: str
) -> Callable[..., Coroutine[Any, Any, BusinessMember]]:
    """Exige l'appartenance au commerce dont relève la ressource désignée.

    `param` est le nom du paramètre de chemin, qui doit correspondre à celui de
    la route. Le passer explicitement plutôt que le deviner évite le cas où la
    dépendance ne trouve rien et laisse passer tout le monde.
    """
    chemin = CHEMINS_VERS_LE_COMMERCE[ressource]

    async def dependency(
        user: CurrentUser,
        session: SessionDep,
        resource_id: Annotated[uuid.UUID, Path(alias=param)],
    ) -> BusinessMember:
        if user.role is not UserRole.BUSINESS_MEMBER:
            raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE)

        business_id = await session.scalar(chemin(resource_id))

        # Ressource inexistante : on ne le dit pas. Répondre 404 ici ferait de
        # la route un oracle d'existence pour le commerce d'en face.
        if business_id is None:
            raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_A_MEMBER)

        membership = await session.scalar(
            sa.select(BusinessMember).where(
                BusinessMember.business_id == business_id,
                BusinessMember.user_id == user.id,
            )
        )
        if membership is None:
            raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_A_MEMBER)

        return membership

    return dependency


def MembershipFor(ressource: str, *, param: str) -> Any:  # noqa: N802 - c'est un alias de type
    """Sucre : `Annotated[BusinessMember, Depends(require_member_of(...))]`."""
    return Annotated[BusinessMember, Depends(require_member_of(ressource, param=param))]
