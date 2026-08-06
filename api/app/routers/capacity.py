"""Capacité et disponibilité temps réel."""

import uuid

from fastapi import APIRouter, status

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.schemas.capacity import (
    AvailabilityUpdate,
    CapacityExceptionCreate,
    CapacityExceptionRead,
    CapacityRuleCreate,
    CapacityRuleRead,
    CapacityRuleUpdate,
)
from app.services import capacity as capacity_service
from app.services import catalog as catalog_service
from app.services.audit import Actor

router = APIRouter(prefix="/business/{business_id}", tags=["capacity"])

_ERROR_CODES = {
    capacity_service.RuleNotFound: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.CAPACITY_RULE_NOT_FOUND,
    ),
    capacity_service.RuleOverlap: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CAPACITY_RULE_OVERLAP,
    ),
    capacity_service.ExceptionNotFound: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.CAPACITY_EXCEPTION_NOT_FOUND,
    ),
    capacity_service.DuplicateExceptionDate: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CAPACITY_EXCEPTION_DUPLICATE_DATE,
    ),
    catalog_service.ItemNotFound: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.CATALOG_ITEM_NOT_FOUND,
    ),
}


def _translate(error: Exception):
    http_status, code = _ERROR_CODES[type(error)]
    return api_error(http_status, code)


# --------------------------------------------------------------------------
# règles hebdomadaires
# --------------------------------------------------------------------------


@router.get("/capacity-rules", response_model=list[CapacityRuleRead])
async def list_rules(business: CurrentBusiness, session: SessionDep) -> list[CapacityRuleRead]:
    rules = await capacity_service.list_rules(session, business.id)
    return [CapacityRuleRead.model_validate(rule, from_attributes=True) for rule in rules]


@router.post(
    "/capacity-rules", response_model=CapacityRuleRead, status_code=status.HTTP_201_CREATED
)
async def create_rule(
    payload: CapacityRuleCreate, business: CurrentBusiness, session: SessionDep
) -> CapacityRuleRead:
    try:
        rule = await capacity_service.create_rule(session, business_id=business.id, payload=payload)
    except capacity_service.CapacityError as error:
        raise _translate(error) from error

    await session.commit()
    return CapacityRuleRead.model_validate(rule, from_attributes=True)


@router.patch("/capacity-rules/{rule_id}", response_model=CapacityRuleRead)
async def update_rule(
    rule_id: uuid.UUID,
    payload: CapacityRuleUpdate,
    business: CurrentBusiness,
    session: SessionDep,
) -> CapacityRuleRead:
    try:
        rule = await capacity_service.get_rule(session, business.id, rule_id)
        await capacity_service.update_rule(session, rule=rule, payload=payload)
    except capacity_service.CapacityError as error:
        raise _translate(error) from error
    except ValueError as error:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED
        ) from error

    await session.commit()
    return CapacityRuleRead.model_validate(rule, from_attributes=True)


@router.delete("/capacity-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: uuid.UUID, business: CurrentBusiness, session: SessionDep) -> None:
    try:
        rule = await capacity_service.get_rule(session, business.id, rule_id)
    except capacity_service.CapacityError as error:
        raise _translate(error) from error

    await capacity_service.delete_rule(session, rule=rule)
    await session.commit()


# --------------------------------------------------------------------------
# exceptions ponctuelles
# --------------------------------------------------------------------------


@router.get("/capacity-exceptions", response_model=list[CapacityExceptionRead])
async def list_exceptions(
    business: CurrentBusiness, session: SessionDep
) -> list[CapacityExceptionRead]:
    exceptions = await capacity_service.list_exceptions(session, business.id)
    return [
        CapacityExceptionRead.model_validate(exception, from_attributes=True)
        for exception in exceptions
    ]


@router.post(
    "/capacity-exceptions",
    response_model=CapacityExceptionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_exception(
    payload: CapacityExceptionCreate, business: CurrentBusiness, session: SessionDep
) -> CapacityExceptionRead:
    try:
        exception = await capacity_service.create_exception(
            session, business_id=business.id, payload=payload
        )
    except capacity_service.CapacityError as error:
        raise _translate(error) from error

    await session.commit()
    return CapacityExceptionRead.model_validate(exception, from_attributes=True)


@router.delete("/capacity-exceptions/{exception_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exception(
    exception_id: uuid.UUID, business: CurrentBusiness, session: SessionDep
) -> None:
    try:
        exception = await capacity_service.get_exception(session, business.id, exception_id)
    except capacity_service.CapacityError as error:
        raise _translate(error) from error

    await capacity_service.delete_exception(session, exception=exception)
    await session.commit()


# --------------------------------------------------------------------------
# disponibilité temps réel
# --------------------------------------------------------------------------


@router.put("/catalog-items/{item_id}/availability", status_code=status.HTTP_204_NO_CONTENT)
async def set_availability(
    item_id: uuid.UUID,
    payload: AvailabilityUpdate,
    business: CurrentBusiness,
    user: CurrentUser,
    session: SessionDep,
) -> None:
    """Route dédiée, et non un champ de la mise à jour générale.

    C'est une transition d'état : elle doit laisser une trace, et deux chemins
    pour la même transition finiraient par diverger sur ce point.
    """
    try:
        item = await catalog_service.get_item(session, business.id, item_id)
    except catalog_service.CatalogError as error:
        raise _translate(error) from error

    await capacity_service.set_availability(
        session, item=item, is_available=payload.is_available, actor=Actor.from_user(user)
    )
    await session.commit()
