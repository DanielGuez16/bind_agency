"""Contrepartie : création, critères figés, échéances, boucle de relance.

**Les critères sont figés à la création**, pas relus au contrôle. Un commerce
qui change son exigence de format après coup changerait rétroactivement ce
qu'un créateur s'est engagé à faire — et ce qu'on lui reprochera de ne pas
avoir fait. Le palier, le format, la mention, la géolocalisation sont recopiés
sur la contrepartie et n'en bougent plus.

**Aucune validation automatique à l'expiration d'un délai.** Une échéance
dépassée produit un `unfulfilled`, jamais un `approved` par défaut. C'est la
seule direction défendable : accepter par lassitude ferait de l'échéance une
récompense pour qui ne répond pas, et le commerce a donné une prestation contre
une publication qui n'existe pas.

**Le refus de conformité rouvre, il ne clôt pas.** `resubmit_requested` avec une
**nouvelle échéance** : le créateur a une occasion de plus, pas un dossier
fermé. `needs_human_review` est un drapeau levé à la troisième tentative, il
sort le dossier de la boucle sans le trancher — il n'existe pas de statut
`disputed`, et c'est voulu : un litige nommé appelle un arbitre, un drapeau
appelle un regard.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, Collaboration, Tier, TierOffer
from app.models.enums import CollaborationStatus, ReliabilityEventType
from app.services import audit, reliability

#: Depuis ces états, une échéance dépassée fait tomber le dossier. `submitted`
#: n'en fait pas partie : le créateur a répondu, c'est à nous de contrôler.
EXPIRABLES = (CollaborationStatus.PENDING, CollaborationStatus.RESUBMIT_REQUESTED)

#: Transitions autorisées, comparées au diagramme de `SPEC.md` §4.2.
TRANSITIONS: dict[CollaborationStatus, frozenset[CollaborationStatus]] = {
    CollaborationStatus.PENDING: frozenset(
        {CollaborationStatus.SUBMITTED, CollaborationStatus.UNFULFILLED}
    ),
    CollaborationStatus.SUBMITTED: frozenset(
        {
            CollaborationStatus.UNDER_REVIEW,
            CollaborationStatus.APPROVED,
            CollaborationStatus.RESUBMIT_REQUESTED,
        }
    ),
    # `under_review` figure dans les statuts de `SPEC.md` §2.6 mais pas dans le
    # diagramme §4.2. Contradiction signalée ; en attendant, il est traité comme
    # ce que le diagramme appelle « contrôle » : une étape facultative entre la
    # soumission et son issue. Le contrôle automatique la saute, un regard
    # humain peut s'y arrêter. Le laisser hors de la table rendrait le
    # dictionnaire partiel et lèverait un `KeyError` en production.
    CollaborationStatus.UNDER_REVIEW: frozenset(
        {CollaborationStatus.APPROVED, CollaborationStatus.RESUBMIT_REQUESTED}
    ),
    CollaborationStatus.RESUBMIT_REQUESTED: frozenset(
        {CollaborationStatus.SUBMITTED, CollaborationStatus.UNFULFILLED}
    ),
    # Terminaux, déclarés vides plutôt qu'absents : la différence entre
    # « terminal » et « oublié » doit se voir.
    CollaborationStatus.APPROVED: frozenset(),
    CollaborationStatus.UNFULFILLED: frozenset(),
}


class CollaborationError(Exception):
    """Base des refus de contrepartie."""


class TransitionNotAllowed(CollaborationError):
    """Le diagramme n'a pas cette flèche."""


class AlreadyExists(CollaborationError):
    """Une consommation ne crée qu'une contrepartie."""


class BookingNotConsumed(CollaborationError):
    """`consumed` est le seul état qui crée la contrepartie."""


async def creer(session: AsyncSession, *, booking: Booking) -> Collaboration:
    """Créée à la consommation, jamais avant.

    Les critères sont recopiés depuis le palier de l'offre : c'est le contrat
    tel qu'il était au moment où le créateur a candidaté. Les relire au contrôle
    laisserait un commerce durcir ses exigences après coup.
    """
    settings = get_settings()

    ligne = (
        await session.execute(
            sa.select(Tier, TierOffer)
            .join(TierOffer, TierOffer.tier_id == Tier.id)
            .where(TierOffer.id == booking.tier_offer_id)
        )
    ).one_or_none()
    if ligne is None:
        raise BookingNotConsumed(str(booking.id))
    tier, offre = ligne

    collaboration = Collaboration(
        booking_id=booking.id,
        tier_id=tier.id,
        required_format=tier.content_format,
        required_mention=offre.required_mention,
        required_geotag=offre.required_geotag,
        deadline_at=datetime.now(UTC)
        + timedelta(seconds=settings.collaboration_publication_seconds),
        status=CollaborationStatus.PENDING,
    )

    try:
        async with session.begin_nested():
            session.add(collaboration)
            await session.flush()
    except IntegrityError as error:
        # `UNIQUE (booking_id)` : une consommation ne crée qu'une contrepartie.
        raise AlreadyExists(str(booking.id)) from error

    await audit.record_transition(
        session,
        entity=audit.AuditedEntity.COLLABORATION,
        entity_id=collaboration.id,
        to_status=CollaborationStatus.PENDING.value,
        actor=audit.Actor.system(),
        reason="prestation consommée, délai de publication ouvert",
    )
    return collaboration


async def transitionner(
    session: AsyncSession,
    *,
    collaboration: Collaboration,
    vers: CollaborationStatus,
    actor: audit.Actor,
    reason: str | None = None,
) -> Collaboration:
    """Le seul chemin. Vérifie la flèche, écrit l'état, écrit le journal."""
    depuis = collaboration.status

    if vers not in TRANSITIONS[depuis]:
        raise TransitionNotAllowed(f"{depuis.value} → {vers.value}")

    collaboration.status = vers
    if vers is CollaborationStatus.APPROVED:
        collaboration.approved_at = datetime.now(UTC)

    await session.flush()
    await audit.record_transition(
        session,
        entity=audit.AuditedEntity.COLLABORATION,
        entity_id=collaboration.id,
        from_status=depuis.value,
        to_status=vers.value,
        actor=actor,
        reason=reason,
    )
    await _emettre_les_evenements(session, collaboration=collaboration, vers=vers)
    return collaboration


#: Ce que chaque issue produit comme événements de fiabilité. Déclaré plutôt que
#: dispersé dans les branches : une issue ajoutée sans son événement se verrait
#: ici, pas au troisième mois d'exploitation.
EVENEMENTS_PAR_ISSUE: dict[CollaborationStatus, tuple[ReliabilityEventType, ...]] = {
    CollaborationStatus.APPROVED: (
        ReliabilityEventType.COLLAB_COMPLETED,
        ReliabilityEventType.PUBLISHED_ON_TIME,
    ),
    CollaborationStatus.RESUBMIT_REQUESTED: (ReliabilityEventType.RESUBMIT_REQUIRED,),
    CollaborationStatus.UNFULFILLED: (ReliabilityEventType.UNFULFILLED,),
}


async def _emettre_les_evenements(
    session: AsyncSession, *, collaboration: Collaboration, vers: CollaborationStatus
) -> None:
    """Les événements naissent de la transition, jamais d'un appel séparé.

    Un appel séparé finit par être oublié sur une branche, et c'est exactement
    la branche qui pénalise quelqu'un qu'on oublie.
    """
    types = list(EVENEMENTS_PAR_ISSUE.get(vers, ()))
    if not types:
        return

    # Approuvée du premier coup : le créateur a fait ce qu'il fallait sans
    # qu'on ait à le lui redemander. Cela se distingue d'une approbation
    # obtenue au troisième essai.
    if vers is CollaborationStatus.APPROVED and collaboration.attempts_count == 0:
        types.append(ReliabilityEventType.FIRST_PASS_COMPLIANT)

    creator_id = await session.scalar(
        sa.select(Booking.creator_id).where(Booking.id == collaboration.booking_id)
    )
    if creator_id is None:
        return

    for type_ in types:
        await reliability.enregistrer(
            session,
            creator_id=creator_id,
            type_=type_,
            booking_id=collaboration.booking_id,
        )


async def demander_une_nouvelle_soumission(
    session: AsyncSession,
    *,
    collaboration: Collaboration,
    actor: audit.Actor,
    reason: str,
) -> Collaboration:
    """Non conforme : on rouvre, on ne ferme pas.

    Une **nouvelle** échéance est posée. Sans elle, le créateur se verrait
    demander autre chose sans avoir le temps de le faire, et tomberait en
    `unfulfilled` pour un délai déjà écoulé — ce qui reviendrait à refuser en
    faisant semblant de laisser une chance.

    `attempts_count` monte à chaque passage. À la troisième,
    `needs_human_review` se lève : le dossier sort de la boucle automatique sans
    être tranché. Il n'existe pas de statut `disputed` — un litige nommé appelle
    un arbitre, un drapeau appelle un regard.
    """
    settings = get_settings()

    collaboration.attempts_count += 1
    collaboration.deadline_at = datetime.now(UTC) + timedelta(
        seconds=settings.collaboration_resubmit_seconds
    )
    if collaboration.attempts_count >= settings.collaboration_max_attempts:
        collaboration.needs_human_review = True

    return await transitionner(
        session,
        collaboration=collaboration,
        vers=CollaborationStatus.RESUBMIT_REQUESTED,
        actor=actor,
        reason=reason,
    )


async def approuver(
    session: AsyncSession, *, collaboration: Collaboration, actor: audit.Actor
) -> Collaboration:
    """Le seul chemin vers `approved`, et il est toujours volontaire.

    Il n'existe **aucune** approbation automatique, ni à l'échéance ni ailleurs.
    Accepter par lassitude ferait de l'échéance une récompense pour qui ne
    répond pas.
    """
    return await transitionner(
        session, collaboration=collaboration, vers=CollaborationStatus.APPROVED, actor=actor
    )


async def expirer_les_echeances(session: AsyncSession, *, limite: int = 500) -> int:
    """Fait tomber en `unfulfilled` ce qui a dépassé son échéance.

    Jamais en `approved` : une échéance dépassée signifie qu'aucune publication
    n'a été apportée, et le commerce a donné une prestation contre elle.

    `submitted` est épargné : le créateur a répondu, la balle est de notre côté.
    Le faire tomber pour un contrôle en retard punirait quelqu'un de notre
    propre lenteur.
    """
    en_retard = list(
        await session.scalars(
            sa.select(Collaboration)
            .where(
                Collaboration.status.in_(EXPIRABLES),
                Collaboration.deadline_at <= sa.func.clock_timestamp(),
            )
            .order_by(Collaboration.deadline_at)
            .limit(limite)
            .with_for_update(skip_locked=True)
        )
    )

    for collaboration in en_retard:
        await transitionner(
            session,
            collaboration=collaboration,
            vers=CollaborationStatus.UNFULFILLED,
            actor=audit.Actor.system(),
            reason="échéance de publication dépassée sans preuve conforme",
        )

    return len(en_retard)


async def du_booking(session: AsyncSession, booking_id: uuid.UUID) -> Collaboration | None:
    return await session.scalar(
        sa.select(Collaboration).where(Collaboration.booking_id == booking_id)
    )
