"""Reprendre un compte commerce, et la liste que le salon en lit.

**Deux côtés, et le second est ce qui rend le premier acceptable.**
L'administration ouvre et referme ; le commerce lit l'historique de ce qui a
été fait chez lui. Sans la seconde route, la première serait un accès de
support silencieux — et le jour où un commerçant découvrirait qu'on est entré
chez lui, ce qu'il retiendrait n'est pas qu'on l'a aidé.
"""

import logging
import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Path, status

from app.core.dependencies import BusinessMembership, CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.integrations.email import get_sender
from app.integrations.push import get_push_sender
from app.models import Business
from app.models.enums import NotificationKind, UserRole
from app.schemas.support import BusinessSupportAccessRead, RepriseDemandee
from app.services import notifications
from app.services import push as push_service
from app.services import support as service

logger = logging.getLogger(__name__)

admin_router = APIRouter(
    prefix="/admin/businesses",
    tags=["support"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)

#: Côté commerce. L'appartenance est exigée : c'est **sa** liste, et le
#: résolveur ordinaire s'en charge.
business_router = APIRouter(prefix="/business", tags=["support"])

_CODES = {
    service.NotAnAdmin: (status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE),
    service.ReasonRequired: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.SUPPORT_REASON_REQUIRED,
    ),
    service.AlreadyOpen: (status.HTTP_409_CONFLICT, ErrorCode.SUPPORT_ACCESS_ALREADY_OPEN),
}


def _traduire(erreur: Exception):
    http_status, code = _CODES[type(erreur)]
    return api_error(http_status, code)


@admin_router.post(
    "/{business_id}/support-access",
    response_model=BusinessSupportAccessRead,
    status_code=status.HTTP_201_CREATED,
)
async def open_support_access(
    business_id: Annotated[uuid.UUID, Path()],
    payload: RepriseDemandee,
    user: CurrentUser,
    session: SessionDep,
) -> BusinessSupportAccessRead:
    """Ouvre une reprise, et **prévient le salon**.

    L'avertissement part après le commit et ne peut pas défaire la reprise :
    un serveur d'email en panne ne doit pas empêcher une intervention. Mais il
    part — c'est ce qui distingue un accès déclaré d'un accès qu'on découvre.
    """
    business = await session.get(Business, business_id)
    if business is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BUSINESS_NOT_FOUND)

    try:
        acces = await service.ouvrir(session, business=business, admin=user, motif=payload.reason)
    except (service.NotAnAdmin, service.ReasonRequired, service.AlreadyOpen) as erreur:
        raise _traduire(erreur) from erreur

    await session.commit()
    await _prevenir_le_salon(session, business=business, motif=acces.reason)
    return BusinessSupportAccessRead.model_validate(acces)


@admin_router.delete("/{business_id}/support-access", status_code=status.HTTP_204_NO_CONTENT)
async def close_support_access(
    business_id: Annotated[uuid.UUID, Path()],
    user: CurrentUser,
    session: SessionDep,
) -> None:
    """Referme la reprise en cours. Sans erreur s'il n'y en avait pas.

    « Il n'y avait rien à fermer » est le résultat voulu quand on veut être sûr
    d'être ressorti.
    """
    acces = await service.en_cours(session, business_id=business_id, admin_user_id=user.id)
    if acces is not None:
        await service.fermer(session, acces=acces, admin=user)
        await session.commit()


@admin_router.get("/{business_id}/support-access", response_model=list[BusinessSupportAccessRead])
async def list_support_accesses(
    business_id: Annotated[uuid.UUID, Path()], session: SessionDep
) -> list[BusinessSupportAccessRead]:
    """L'historique, côté administration."""
    return [
        BusinessSupportAccessRead.model_validate(acces)
        for acces in await service.historique(session, business_id=business_id)
    ]


@business_router.get(
    "/{business_id}/support-access", response_model=list[BusinessSupportAccessRead]
)
async def list_my_support_accesses(
    business_id: Annotated[uuid.UUID, Path()],
    membership: BusinessMembership,
    session: SessionDep,
) -> list[BusinessSupportAccessRead]:
    """**Ce que le salon lit de nous.**

    La même forme que la route d'administration : ce que le salon voit de nous
    est ce que nous voyons de nous-mêmes. Rendre une version allégée
    demanderait de choisir ce qu'on lui cache, et il n'y a rien ici qui se
    cache.
    """
    del membership  # l'appartenance est la condition, pas une donnée
    return [
        BusinessSupportAccessRead.model_validate(acces)
        for acces in await service.historique(session, business_id=business_id)
    ]


async def _prevenir_le_salon(session: SessionDep, *, business: Business, motif: str) -> None:
    """Dit au salon qu'on est entré, et pourquoi. Ne défait jamais la reprise."""
    try:
        async with httpx.AsyncClient() as client:
            await notifications.envoyer_au_commerce(
                session,
                business=business,
                cle="support.accessOpened",
                kind=NotificationKind.SUPPORT_ACCESS_STARTED,
                sender=get_sender(client),
                motif=motif,
            )
        await push_service.pour_le_commerce_seul(
            session,
            business_id=business.id,
            kind=NotificationKind.SUPPORT_ACCESS_STARTED,
            cle="support.accessOpened",
            sender=get_push_sender(),
            business=business.name,
            motif=motif,
        )
    except Exception:
        # La reprise est déjà écrite ; la seule chose qu'une exception ici
        # pourrait encore faire, c'est la défaire. L'échec part au journal
        # d'exploitation, où il se voit.
        logger.exception(
            "avertissement de reprise non envoyé", extra={"business_id": str(business.id)}
        )
