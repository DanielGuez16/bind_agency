"""Disponibilité d'un item.

Route publique au sens où elle n'exige pas d'appartenance au commerce : c'est
le créateur qui la consulte avant de réserver. Elle reste authentifiée — la
disponibilité d'un commerce n'a pas à être lisible par un robot anonyme.
"""

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Path, Query, status

from app.core.dependencies import CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.schemas.availability import CreneauRead
from app.services import availability as service

router = APIRouter(tags=["availability"])


@router.get("/businesses/{business_id}/availability", response_model=list[CreneauRead])
async def read_availability(
    session: SessionDep,
    user: CurrentUser,
    business_id: Annotated[uuid.UUID, Path()],
    catalog_item_id: Annotated[uuid.UUID, Query()],
    jours: Annotated[int | None, Query(ge=1, le=90)] = None,
) -> list[CreneauRead]:
    try:
        creneaux = await service.creneaux_libres(
            session,
            business_id=business_id,
            catalog_item_id=catalog_item_id,
            horizon=timedelta(days=jours) if jours else None,
        )
    except service.ItemNotFound as error:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.CATALOG_ITEM_NOT_FOUND) from error
    except service.ItemNotBookable as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.CATALOG_ITEM_NOT_BOOKABLE) from error

    return [CreneauRead.model_validate(c) for c in creneaux]
