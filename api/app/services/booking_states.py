"""Machine à états de la réservation — `SPEC.md` §4.1.

```
held ──┬─confirmation créateur, commerce en automatique─────> confirmed
       │                                                        │
       └─confirmation créateur, commerce en validation──> awaiting_business
                                     │                          │
                                     ├──accord du commerce──────┘
                                     ├──refus du commerce──> cancelled
                                     └──sans réponse──────> expired

confirmed ──scan du code──> consumed
 │
 ├──annulation créateur > 24h avant──> cancelled
 ├──annulation créateur < 24h ou absence──> no_show
 └──annulation par le commerce, avec motif──> cancelled

held ──délai de garde dépassé──> expired
```

**Une annulation par le commerce ne dégrade jamais le score.** Elle mène à
`cancelled`, jamais à `no_show` : une technicienne absente ou une fermeture
imprévue n'est pas un manquement du créateur, et le lui faire porter serait la
façon la plus sûre de lui apprendre à se méfier du produit. Le motif est
obligatoire — une annulation sans raison est une annulation qu'on ne peut pas
contester.

**Le commerce tranche avant que le code n'existe.** `awaiting_business` tient la
place pendant qu'il regarde : la relâcher permettrait de la vendre deux fois. Et
le droit de consommer ne naît qu'à `confirmed`, ce qui rend impossible qu'un
code circule pour une réservation que le commerce n'a pas acceptée.

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
from app.models import Booking, Business
from app.models.enums import BookingStatus, ReliabilityEventType
from app.services import audit, collaboration, redemption, reliability

#: Le diagramme, écrit une fois. Toute transition absente d'ici est refusée.
TRANSITIONS: dict[BookingStatus, frozenset[BookingStatus]] = {
    BookingStatus.HELD: frozenset(
        {
            BookingStatus.AWAITING_BUSINESS,
            BookingStatus.CONFIRMED,
            BookingStatus.CANCELLED,
            BookingStatus.EXPIRED,
        }
    ),
    BookingStatus.AWAITING_BUSINESS: frozenset(
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


class MotifRequis(BookingStateError):
    """Le commerce annule ou refuse sans dire pourquoi.

    Exigé par le service et pas seulement par le schéma de la route : c'est une
    règle métier, et une seconde route ajoutée demain ne doit pas pouvoir s'en
    passer.
    """


class NotYourBusiness(BookingStateError):
    """Réservation d'un autre commerce."""


class CreneauDepasse(BookingStateError):
    """L'heure est passée : il n'y a plus rien à accepter.

    Accepter après coup produirait une réservation confirmée pour un rendez-vous
    qui n'aura pas lieu, et un code de retrait pour un créneau écoulé. Le
    créateur n'a rien à se reprocher : la décision n'est simplement plus
    possible.
    """


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

    # Le code naît de l'arrivée dans `confirmed`, quelle que soit la porte
    # empruntée. Il vivait dans `confirmer`, ce qui suffisait tant qu'il n'y
    # avait qu'un chemin ; depuis que le commerce peut confirmer à son tour, un
    # code accroché à une seule des deux portes aurait laissé la moitié des
    # réservations confirmées sans rien à montrer au comptoir.
    if vers is BookingStatus.CONFIRMED:
        await redemption.creer_code(session, booking=booking)

    # L'événement naît de la transition, pas d'un appel que quelqu'un pourrait
    # oublier. Une absence non enregistrée serait une absence gratuite.
    if vers is BookingStatus.NO_SHOW:
        await reliability.enregistrer(
            session,
            creator_id=booking.creator_id,
            type_=ReliabilityEventType.NO_SHOW,
            booking_id=booking.id,
        )

    return booking


async def confirmer(session: AsyncSession, *, booking: Booking, creator_id: uuid.UUID) -> Booking:
    """Le créateur confirme, dans le délai de garde.

    Le garde est relu ici, pas seulement au passage du job : entre l'échéance et
    le balayage, la place est déjà rendue — le calcul de disponibilité la
    propose à quelqu'un d'autre. Confirmer dans cet intervalle vendrait deux
    fois la même place.

    **Où cela mène dépend du commerce, pas du créateur.** Un commerce en
    validation reçoit la réservation en attente ; les autres la confirment tout
    de suite. Le créateur fait le même geste dans les deux cas — c'est l'écran
    qui lui dit ensuite ce qui se passe.
    """
    if booking.creator_id != creator_id:
        raise NotYours(str(booking.id))

    if booking.hold_expires_at is not None and booking.hold_expires_at <= datetime.now(UTC):
        raise HoldExpired(str(booking.id))

    a_valider = await session.scalar(
        sa.select(Business.requires_booking_approval).where(Business.id == booking.business_id)
    )

    return await transitionner(
        session,
        booking=booking,
        vers=BookingStatus.AWAITING_BUSINESS if a_valider else BookingStatus.CONFIRMED,
        actor=audit.Actor(kind=audit.ActorKind.CREATOR, user_id=creator_id),
    )


async def trancher(
    session: AsyncSession,
    *,
    booking: Booking,
    business_id: uuid.UUID,
    user_id: uuid.UUID,
    accepte: bool,
    motif: str | None = None,
) -> Booking:
    """Le commerce accepte ou refuse une réservation en attente.

    Le refus exige un motif : c'est ce que le créateur lira, et une décision
    sans raison est une décision qu'il ne peut pas contester. L'accord n'en
    demande pas — il n'y a rien à justifier à dire oui.

    Refuser mène à `cancelled`, jamais à `no_show` : le créateur n'a rien fait.
    """
    if booking.business_id != business_id:
        raise NotYourBusiness(str(booking.id))

    if not accepte and not (motif or "").strip():
        raise MotifRequis(str(booking.id))

    # **Un accord ne rattrape pas une heure passée.** Le balayage finira par
    # l'expirer, mais il passe périodiquement : entre deux passages, l'écran
    # proposait encore d'accepter un rendez-vous de 10 h 45 à 11 h 35. Le refus
    # est ici, pas seulement dans l'écran — un second appelant l'ignorerait.
    #
    # Refuser reste possible : un commerce qui répond en retard dit quand même
    # ce qu'il en était, et le créateur lit son motif.
    if accepte and _est_depassee(booking):
        raise CreneauDepasse(str(booking.id))

    return await transitionner(
        session,
        booking=booking,
        vers=BookingStatus.CONFIRMED if accepte else BookingStatus.CANCELLED,
        actor=audit.Actor(kind=audit.ActorKind.BUSINESS_MEMBER, user_id=user_id),
        reason=None if accepte else motif,
    )


async def annuler_par_le_commerce(
    session: AsyncSession,
    *,
    booking: Booking,
    business_id: uuid.UUID,
    user_id: uuid.UUID,
    motif: str,
) -> Booking:
    """Technicienne absente, fermeture imprévue : le commerce rend la place.

    **Toujours `cancelled`, jamais `no_show`**, et sans regarder l'heure. La
    fenêtre de vingt-quatre heures existe pour départager un créateur qui
    prévient d'un créateur qui ne vient pas ; elle n'a rien à dire ici, où c'est
    le commerce qui se désiste. Lui appliquer la même règle ferait porter au
    créateur la conséquence d'une décision qui n'est pas la sienne.

    Le motif est obligatoire. Sans lui, le créateur reçoit une annulation qu'il
    ne peut ni comprendre ni contester.
    """
    if booking.business_id != business_id:
        raise NotYourBusiness(str(booking.id))

    if not motif.strip():
        raise MotifRequis(str(booking.id))

    return await transitionner(
        session,
        booking=booking,
        vers=BookingStatus.CANCELLED,
        actor=audit.Actor(kind=audit.ActorKind.BUSINESS_MEMBER, user_id=user_id),
        reason=motif,
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
    """Le seul passage qui crée la contrepartie et ouvre le délai de publication.

    Les deux écritures appartiennent à la même transaction : une prestation
    servie sans contrepartie ouverte serait une prestation offerte, et personne
    ne s'en apercevrait avant le reporting.
    """
    consomme = await transitionner(
        session, booking=booking, vers=BookingStatus.CONSUMED, actor=actor
    )
    await collaboration.creer(session, booking=consomme)
    return consomme


def _est_depassee(booking: Booking, *, maintenant: datetime | None = None) -> bool:
    """L'heure du rendez-vous est-elle passée.

    Sur un item sans créneau il n'y a pas d'heure : c'est la fenêtre de validité
    qui fait foi. Prendre `starts_at` seul y répondrait toujours non, et un
    droit périmé resterait acceptable indéfiniment.
    """
    instant = maintenant or datetime.now(UTC)
    echeance = booking.starts_at or booking.valid_until
    return echeance is not None and echeance <= instant


async def expirer_les_attentes_depassees(session: AsyncSession, *, limite: int = 500) -> int:
    """Passe en `expired` les demandes que le commerce n'a pas tranchées à temps.

    Une réservation en attente tient une place et bloque un créateur qui ne peut
    rien faire d'autre que patienter. Passé l'heure du rendez-vous, il n'y a
    plus rien à trancher : la laisser en attente donnerait une file qui
    s'allonge de dossiers morts, et un créateur qui attend une réponse qui n'a
    plus d'objet.

    Aucun événement de fiabilité : personne n'a manqué à rien.
    """
    depassees = list(
        await session.scalars(
            sa.select(Booking)
            .where(
                Booking.status == BookingStatus.AWAITING_BUSINESS,
                sa.func.coalesce(Booking.starts_at, Booking.valid_until)
                <= sa.func.clock_timestamp(),
            )
            .order_by(Booking.starts_at)
            .limit(limite)
            .with_for_update(skip_locked=True)
        )
    )

    for reservation in depassees:
        await transitionner(
            session,
            booking=reservation,
            vers=BookingStatus.EXPIRED,
            actor=audit.Actor.system(),
            reason="le commerce n'a pas tranché avant l'heure du rendez-vous",
        )

    return len(depassees)


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
