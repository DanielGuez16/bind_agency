"""Capacité d'un commerce et disponibilité temps réel de son catalogue.

Modifier une règle de capacité n'a aucun effet sur les réservations déjà prises :
elles ne sont ni déplacées ni annulées. Ce que le commerce doit voir quand une
réservation tombe hors de ses nouveaux horaires se décidera en phase 5, quand la
disponibilité existera vraiment.
"""

import uuid
from datetime import date as date_type
from datetime import time as time_type

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CapacityException, CapacityRule, CatalogItem
from app.models.enums import CatalogItemAvailability
from app.schemas.capacity import (
    CapacityExceptionCreate,
    CapacityRuleCreate,
    CapacityRuleUpdate,
)
from app.services.audit import Actor, AuditedEntity, record_transition


class CapacityError(Exception):
    """Base des erreurs de capacité."""


class RuleNotFound(CapacityError):
    pass


class RuleOverlap(CapacityError):
    """Deux plages du même jour se recouvrent."""


class ExceptionNotFound(CapacityError):
    pass


class DuplicateExceptionDate(CapacityError):
    """Une seule exception par date et par commerce."""


# --------------------------------------------------------------------------
# règles hebdomadaires
# --------------------------------------------------------------------------


async def list_rules(session: AsyncSession, business_id: uuid.UUID) -> list[CapacityRule]:
    statement = (
        sa.select(CapacityRule)
        .where(CapacityRule.business_id == business_id)
        .order_by(CapacityRule.weekday, CapacityRule.start_time)
    )
    return list(await session.scalars(statement))


async def _overlaps(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    weekday: int,
    start_time: time_type,
    end_time: time_type,
    ignore_id: uuid.UUID | None = None,
) -> bool:
    """Deux plages se recouvrent si chacune commence avant que l'autre ne finisse.

    Les bornes qui se touchent — 12:00 puis 12:00 — ne se recouvrent pas : un
    commerce qui ferme et rouvre au même instant reste cohérent.
    """
    conditions = [
        CapacityRule.business_id == business_id,
        CapacityRule.weekday == weekday,
        CapacityRule.start_time < end_time,
        CapacityRule.end_time > start_time,
    ]
    if ignore_id is not None:
        conditions.append(CapacityRule.id != ignore_id)

    return bool(await session.scalar(sa.select(sa.exists().where(*conditions))))


async def create_rule(
    session: AsyncSession, *, business_id: uuid.UUID, payload: CapacityRuleCreate
) -> CapacityRule:
    if await _overlaps(
        session,
        business_id=business_id,
        weekday=payload.weekday,
        start_time=payload.start_time,
        end_time=payload.end_time,
    ):
        raise RuleOverlap((payload.weekday, payload.start_time, payload.end_time))

    rule = CapacityRule(
        business_id=business_id,
        weekday=payload.weekday,
        start_time=payload.start_time,
        end_time=payload.end_time,
        concurrent_slots=payload.concurrent_slots,
    )
    session.add(rule)
    await session.flush()
    return rule


async def get_rule(
    session: AsyncSession, business_id: uuid.UUID, rule_id: uuid.UUID
) -> CapacityRule:
    rule = await session.scalar(
        sa.select(CapacityRule).where(
            CapacityRule.id == rule_id, CapacityRule.business_id == business_id
        )
    )
    if rule is None:
        raise RuleNotFound(rule_id)
    return rule


async def update_rule(
    session: AsyncSession, *, rule: CapacityRule, payload: CapacityRuleUpdate
) -> CapacityRule:
    fields = payload.model_dump(exclude_unset=True)

    weekday = fields.get("weekday", rule.weekday)
    start_time = fields.get("start_time", rule.start_time)
    end_time = fields.get("end_time", rule.end_time)

    if start_time >= end_time:
        raise ValueError("l'heure de fin doit suivre l'heure de début")

    if await _overlaps(
        session,
        business_id=rule.business_id,
        weekday=weekday,
        start_time=start_time,
        end_time=end_time,
        ignore_id=rule.id,
    ):
        raise RuleOverlap((weekday, start_time, end_time))

    for name in ("weekday", "start_time", "end_time", "concurrent_slots"):
        if name in fields:
            setattr(rule, name, fields[name])

    await session.flush()
    return rule


async def delete_rule(session: AsyncSession, *, rule: CapacityRule) -> None:
    """Aucune réservation n'est touchée : elles gardent leur créneau."""
    await session.delete(rule)
    await session.flush()


# --------------------------------------------------------------------------
# exceptions ponctuelles
# --------------------------------------------------------------------------


async def list_exceptions(session: AsyncSession, business_id: uuid.UUID) -> list[CapacityException]:
    statement = (
        sa.select(CapacityException)
        .where(CapacityException.business_id == business_id)
        .order_by(CapacityException.date)
    )
    return list(await session.scalars(statement))


async def create_exception(
    session: AsyncSession, *, business_id: uuid.UUID, payload: CapacityExceptionCreate
) -> CapacityException:
    """`is_closed` est déduit de l'absence d'horaires, jamais saisi."""
    exception = CapacityException(
        business_id=business_id,
        date=payload.date,
        is_closed=payload.start_time is None,
        start_time=payload.start_time,
        end_time=payload.end_time,
        concurrent_slots=payload.concurrent_slots,
    )
    session.add(exception)

    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as error:
        raise DuplicateExceptionDate(payload.date) from error

    return exception


async def get_exception(
    session: AsyncSession, business_id: uuid.UUID, exception_id: uuid.UUID
) -> CapacityException:
    exception = await session.scalar(
        sa.select(CapacityException).where(
            CapacityException.id == exception_id,
            CapacityException.business_id == business_id,
        )
    )
    if exception is None:
        raise ExceptionNotFound(exception_id)
    return exception


async def delete_exception(session: AsyncSession, *, exception: CapacityException) -> None:
    await session.delete(exception)
    await session.flush()


async def exception_for(
    session: AsyncSession, business_id: uuid.UUID, day: date_type
) -> CapacityException | None:
    return await session.scalar(
        sa.select(CapacityException).where(
            CapacityException.business_id == business_id, CapacityException.date == day
        )
    )


# --------------------------------------------------------------------------
# disponibilité temps réel
# --------------------------------------------------------------------------


async def set_availability(
    session: AsyncSession, *, item: CatalogItem, is_available: bool, actor: Actor
) -> bool:
    """Bascule la disponibilité d'un item ou d'un parent. Renvoie faux si rien n'a changé.

    Un parent désactivé rend ses variantes indisponibles en lecture, sans que
    leur propre interrupteur ne bouge : l'état n'est pas propagé, il est calculé.
    Une seule ligne change donc ici, et une seule ligne de journal est écrite.
    """
    if item.is_available == is_available:
        return False

    previous = (
        CatalogItemAvailability.AVAILABLE
        if item.is_available
        else CatalogItemAvailability.UNAVAILABLE
    )
    current = (
        CatalogItemAvailability.AVAILABLE if is_available else CatalogItemAvailability.UNAVAILABLE
    )

    item.is_available = is_available
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.CATALOG_ITEM,
        entity_id=item.id,
        from_status=previous.value,
        to_status=current.value,
        actor=actor,
    )

    # `updated_at` a un `onupdate` côté serveur : sans rafraîchissement, le
    # relire déclencherait une IO implicite, interdite en async.
    await session.refresh(item)
    return True
