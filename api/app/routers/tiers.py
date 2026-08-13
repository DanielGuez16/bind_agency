"""Les paliers : leur administration, et leur lecture par un commerce.

Tout ce qui **écrit** est sous `require_role(ADMIN)`, sans dérogation : un
palier est une configuration de la plateforme, pas d'un commerce.

**Un commerce a besoin de les lire.** Composer une offre suppose de choisir un
palier ; sans cette liste, l'écran de catalogue n'aurait qu'un identifiant à
saisir à la main. Elle est en lecture seule et limitée aux paliers actifs — en
proposer un désactivé dessinerait une impasse : la composition le refuse, et
l'écran ne l'aurait appris qu'après coup.
"""

import uuid

from fastapi import APIRouter, Depends, status

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models.enums import UserRole
from app.schemas.tiers import (
    ConfigurationChangeRead,
    TierCreate,
    TierRead,
    TierUpdate,
)
from app.services import config_journal
from app.services import tiers as tier_service
from app.services.audit import Actor

router = APIRouter(
    prefix="/admin/tiers",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)

#: La lecture par le commerce. `CurrentBusiness` refuse déjà un membre d'un
#: autre commerce : la borne est celle de l'appartenance, pas d'un filtre écrit
#: dans la route.
business_router = APIRouter(prefix="/business/{business_id}", tags=["tiers"])


@business_router.get("/tiers", response_model=list[TierRead])
async def list_tiers_for_business(business: CurrentBusiness, session: SessionDep) -> list[TierRead]:
    """Les paliers qu'un commerce peut offrir, dans l'ordre d'affichage."""
    _ = business
    tiers = await tier_service.list_tiers(session)
    return [TierRead.model_validate(tier, from_attributes=True) for tier in tiers if tier.is_active]


_ERROR_CODES = {
    tier_service.TierNotFound: (status.HTTP_404_NOT_FOUND, ErrorCode.TIER_NOT_FOUND),
    tier_service.TierAlreadyExists: (status.HTTP_409_CONFLICT, ErrorCode.TIER_ALREADY_EXISTS),
    tier_service.TierInUse: (status.HTTP_409_CONFLICT, ErrorCode.TIER_IN_USE),
}


def _translate(error: tier_service.TierError):
    http_status, code = _ERROR_CODES[type(error)]
    return api_error(http_status, code)


@router.get("", response_model=list[TierRead])
async def list_tiers(session: SessionDep) -> list[TierRead]:
    tiers = await tier_service.list_tiers(session)
    return [TierRead.model_validate(tier, from_attributes=True) for tier in tiers]


@router.post("", response_model=TierRead, status_code=status.HTTP_201_CREATED)
async def create_tier(payload: TierCreate, session: SessionDep) -> TierRead:
    try:
        tier = await tier_service.create_tier(session, payload=payload)
    except tier_service.TierError as error:
        raise _translate(error) from error

    await session.commit()
    return TierRead.model_validate(tier, from_attributes=True)


@router.get("/{tier_id}", response_model=TierRead)
async def read_tier(tier_id: uuid.UUID, session: SessionDep) -> TierRead:
    try:
        tier = await tier_service.get_tier(session, tier_id)
    except tier_service.TierError as error:
        raise _translate(error) from error

    return TierRead.model_validate(tier, from_attributes=True)


@router.patch("/{tier_id}", response_model=TierRead)
async def update_tier(
    tier_id: uuid.UUID, payload: TierUpdate, user: CurrentUser, session: SessionDep
) -> TierRead:
    try:
        tier = await tier_service.get_tier(session, tier_id)
        await tier_service.update_tier(
            session, tier=tier, payload=payload, actor=Actor.from_user(user)
        )
    except tier_service.TierError as error:
        raise _translate(error) from error

    await session.commit()
    return TierRead.model_validate(tier, from_attributes=True)


@router.get("/{tier_id}/changes", response_model=list[ConfigurationChangeRead])
async def list_tier_changes(tier_id: uuid.UUID, session: SessionDep) -> list:
    """L'histoire d'un palier : qui a changé quoi, et depuis quelle valeur.

    **La question à laquelle elle répond.** Un créateur perd l'accès à un
    palier qu'il avait ; six semaines plus tard, on ne sait pas si son audience
    a baissé ou si le seuil a monté. Sans cette lecture, la seule façon de
    trancher est de croire quelqu'un sur parole.
    """
    return [
        ConfigurationChangeRead.model_validate(ligne)
        for ligne in await config_journal.historique(session, entity_id=tier_id)
    ]


@router.delete("/{tier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tier(tier_id: uuid.UUID, session: SessionDep) -> None:
    """Un palier référencé ne se supprime pas : il se désactive."""
    try:
        tier = await tier_service.get_tier(session, tier_id)
        await tier_service.delete_tier(session, tier=tier)
    except tier_service.TierError as error:
        raise _translate(error) from error

    await session.commit()
