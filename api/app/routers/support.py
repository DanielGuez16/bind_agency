"""Reprendre un compte commerce, et la liste que le salon en lit.

**Deux côtés, et le second est ce qui rend le premier acceptable.**
L'administration ouvre et referme ; le commerce lit l'historique de ce qui a
été fait chez lui. Sans la seconde route, la première serait un accès de
support silencieux — et le jour où un commerçant découvrirait qu'on est entré
chez lui, ce qu'il retiendrait n'est pas qu'on l'a aidé.
"""

import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Path, status

from app.core.dependencies import BusinessMembership, CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models import Business
from app.models.enums import UserRole
from app.schemas.support import BusinessSupportAccessRead, RepriseDemandee
from app.services import outbox
from app.services import support as service

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

    L'avertissement est déposé dans la même transaction que la reprise : ou les
    deux existent, ou aucun. C'est ce qui distingue un accès déclaré d'un accès
    qu'on découvre — et ce qui empêche qu'une panne d'envoi laisse l'accès
    ouvert sans que personne ne l'ait dit.
    """
    business = await session.get(Business, business_id)
    if business is None:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.BUSINESS_NOT_FOUND)

    try:
        acces = await service.ouvrir(session, business=business, admin=user, motif=payload.reason)
    except (service.NotAnAdmin, service.ReasonRequired, service.AlreadyOpen) as erreur:
        raise _traduire(erreur) from erreur

    await _prevenir_le_salon(session, business=business, motif=acces.reason)
    await session.commit()
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


async def _prevenir_le_salon(session, *, business: Business, motif: str) -> None:
    """Dépose l'avertissement pour tous les membres, **avant le commit**.

    Le salon apprend qu'on est entré chez lui par le même chemin que tout le
    reste : la boîte d'envoi, vidée par le travail de fond. C'est aussi ce qui
    garantit qu'il l'apprendra — le message est écrit dans la transaction qui
    ouvre la reprise, et un processus qui meurt entre les deux ne peut plus
    faire disparaître l'avertissement en laissant l'accès.
    """
    from app.models import BusinessMember

    membres = await session.scalars(
        sa.select(BusinessMember.user_id).where(BusinessMember.business_id == business.id)
    )
    for user_id in membres:
        await outbox.deposer(
            session,
            user_id=user_id,
            cle="support.accessOpened",
            business=business.name,
            motif=motif,
        )
