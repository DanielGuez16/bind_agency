"""Machine à états de la réservation — `SPEC.md` §4.1.

```
held ──confirmation créateur──> confirmed ──scan du code──> consumed
 │                                  │
 │                                  ├──annulation > 24h avant──> cancelled
 │                                  ├──annulation < 24h ou absence──> no_show
 └──délai de garde dépassé──> expired
```

**Les transitions autorisées sont déclarées, pas déduites.** Une table explicite
se relit et se compare au diagramme ; une suite de `if` répartis dans le service
ne se compare à rien, et la transition qu'on a oublié d'interdire ne se voit
qu'au moment où quelqu'un l'emprunte.

**Tout passe par le point d'entrée du journal.** Aucune transition n'est écrite
sans sa ligne d'audit : une réservation qui change d'état sans qu'on sache qui
l'a décidé et pourquoi n'est pas opposable, et c'est exactement ce qu'un
commerce contestera.

**`no_show` n'existe pas pour un item sans créneau.** Il n'y a pas d'heure à
laquelle ne pas se présenter : le droit s'éteint tout seul à son échéance, et
l'expiration suffit. Le refuser explicitement évite qu'un commerce pénalise un
créateur pour une absence qui n'a pas de sens.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking
from app.models.enums import BookingStatus
from app.services import audit

#: Le diagramme, écrit une fois. Toute transition absente d'ici est refusée.
TRANSITIONS: dict[BookingStatus, frozenset[BookingStatus]] = {
    BookingStatus.HELD: frozenset(
        {BookingStatus.CONFIRMED, BookingStatus.CANCELLED, BookingStatus.EXPIRED}
    ),
    BookingStatus.CONFIRMED: frozenset(
        {BookingStatus.CONSUMED, BookingStatus.CANCELLED, BookingStatus.NO_SHOW}
    ),
    # Les quatre états terminaux. Déclarés vides plutôt qu'absents : un `get`
    # sur une clé manquante et un ensemble vide se ressemblent trop, et la
    # différence entre « terminal » et « oublié » doit se voir.
    BookingStatus.CONSUMED: frozenset(),
    BookingStatus.CANCELLED: frozenset(),
    BookingStatus.NO_SHOW: frozenset(),
    BookingStatus.EXPIRED: frozenset(),
}


class BookingStateError(Exception):
    """Base des refus de transition."""


class TransitionNotAllowed(BookingStateError):
    """Le diagramme n'a pas cette flèche."""


class HoldExpired(BookingStateError):
    """Le garde est passé : la place a été rendue, elle ne se confirme plus."""


class NotYours(BookingStateError):
    """Réservation d'un autre créateur."""


class NoShowNotApplicable(BookingStateError):
    """Un item sans créneau n'a pas d'heure à laquelle ne pas se présenter."""


async def transitionner(
    session: AsyncSession,
    *,
    booking: Booking,
    vers: BookingStatus,
    actor: audit.Actor,
    reason: str | None = None,
) -> Booking:
    """Le seul chemin. Vérifie la flèche, écrit l'état, écrit le journal."""
    depuis = booking.status

    if vers not in TRANSITIONS[depuis]:
        raise TransitionNotAllowed(f"{depuis.value} → {vers.value}")

    if vers is BookingStatus.NO_SHOW and not booking.requires_booking:
        raise NoShowNotApplicable(str(booking.id))

    booking.status = vers
    if vers in (BookingStatus.CANCELLED, BookingStatus.NO_SHOW):
        booking.cancelled_at = datetime.now(UTC)
    if vers is BookingStatus.CONSUMED:
        booking.consumed_at = datetime.now(UTC)

    # Le garde n'a plus d'objet dès qu'on quitte `held`. Le laisser en place
    # ferait mentir toute lecture qui s'y fie, à commencer par le calcul de
    # disponibilité.
    booking.hold_expires_at = None

    await session.flush()
    await audit.record_transition(
        session,
        entity=audit.AuditedEntity.BOOKING,
        entity_id=booking.id,
        from_status=depuis.value,
        to_status=vers.value,
        actor=actor,
        reason=reason,
    )
    return booking


async def confirmer(session: AsyncSession, *, booking: Booking, creator_id: uuid.UUID) -> Booking:
    """Le créateur confirme, dans le délai de garde.

    Le garde est relu ici, pas seulement au passage du job : entre l'échéance et
    le balayage, la place est déjà rendue — le calcul de disponibilité la
    propose à quelqu'un d'autre. Confirmer dans cet intervalle vendrait deux
    fois la même place.
    """
    if booking.creator_id != creator_id:
        raise NotYours(str(booking.id))

    if booking.hold_expires_at is not None and booking.hold_expires_at <= datetime.now(UTC):
        raise HoldExpired(str(booking.id))

    return await transitionner(
        session,
        booking=booking,
        vers=BookingStatus.CONFIRMED,
        actor=audit.Actor(kind=audit.ActorKind.CREATOR, user_id=creator_id),
    )


async def annuler(session: AsyncSession, *, booking: Booking, creator_id: uuid.UUID) -> Booking:
    """Annulation par le créateur. L'issue dépend du délai, pas de son intention.

    Au-delà de la fenêtre, c'est un `no_show` : le commerce a bloqué un poste
    qu'il ne remplira plus, et le créateur en porte la conséquence. En deçà,
    c'est une annulation sans pénalité — un créateur qui prévient à temps rend
    la place, ce qu'on veut encourager.

    Un `held` s'annule toujours sans pénalité : rien n'a encore été promis, et
    le garde serait de toute façon tombé tout seul.
    """
    if booking.creator_id != creator_id:
        raise NotYours(str(booking.id))

    acteur = audit.Actor(kind=audit.ActorKind.CREATOR, user_id=creator_id)

    if booking.status is BookingStatus.HELD or not booking.requires_booking:
        return await transitionner(
            session, booking=booking, vers=BookingStatus.CANCELLED, actor=acteur
        )

    fenetre = timedelta(seconds=get_settings().booking_free_cancellation_seconds)
    tardive = booking.starts_at is not None and datetime.now(UTC) > booking.starts_at - fenetre

    return await transitionner(
        session,
        booking=booking,
        vers=BookingStatus.NO_SHOW if tardive else BookingStatus.CANCELLED,
        actor=acteur,
        reason="annulation dans la fenêtre de pénalité" if tardive else None,
    )


async def marquer_absent(
    session: AsyncSession, *, booking: Booking, actor: audit.Actor, reason: str
) -> Booking:
    """Le commerce constate l'absence. Toujours motivé : il pénalise quelqu'un."""
    return await transitionner(
        session, booking=booking, vers=BookingStatus.NO_SHOW, actor=actor, reason=reason
    )


async def consommer(session: AsyncSession, *, booking: Booking, actor: audit.Actor) -> Booking:
    """Le passage qui crée la contrepartie — celle-ci arrive en phase 6."""
    return await transitionner(session, booking=booking, vers=BookingStatus.CONSUMED, actor=actor)


async def expirer_les_gardes_depasses(session: AsyncSession, *, limite: int = 500) -> int:
    """Passe en `expired` les `held` dont le garde est tombé.

    Ne jamais se fier au client pour libérer une place : celui qui abandonne son
    parcours ne prévient pas. Le calcul de disponibilité ignore déjà ces lignes ;
    ce balayage met l'état en accord avec ce qui est déjà vrai.

    `SKIP LOCKED` pour la même raison que dans la file de jobs : deux passages
    concurrents se répartissent le travail au lieu de se le disputer.
    """
    expirables = list(
        await session.scalars(
            sa.select(Booking)
            .where(
                Booking.status == BookingStatus.HELD,
                Booking.hold_expires_at <= sa.func.clock_timestamp(),
            )
            .order_by(Booking.hold_expires_at)
            .limit(limite)
            .with_for_update(skip_locked=True)
        )
    )

    for reservation in expirables:
        await transitionner(
            session,
            booking=reservation,
            vers=BookingStatus.EXPIRED,
            actor=audit.Actor.system(),
            reason="délai de garde dépassé",
        )

    return len(expirables)
