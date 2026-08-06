"""Fiabilité : événements, score, compteur de collaborations.

**Rien n'est écrit à la main.** Le score et le compteur sont des **caches**,
tous deux entièrement recalculables depuis `reliability_event`. C'est ce qui
rend un ajustement de pondération rétroactif sans migration — et c'est aussi ce
qui protège du pire défaut d'un cache : diverger sans qu'on le sache. Un test
recalcule et compare.

**Les pondérations vivent en configuration.** Changer le poids d'une absence ne
demande ni migration ni réécriture d'historique : les événements portent leur
poids *au moment où ils sont créés*, et `recalculer` les relit avec la grille du
jour. Les deux lectures existent parce qu'elles répondent à deux questions
différentes — « que valait cet événement quand il s'est produit » et « que vaut
cet historique aujourd'hui ».

**Un créateur sans événement garde un score nul.** Nul veut dire neutre, jamais
zéro : c'est ce null qui déclenche le badge « nouveau créateur » et le
comportement neutre du moteur de paliers. Écrire zéro ferait d'un débutant
quelqu'un de peu fiable.
"""

import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, CreatorProfile, ReliabilityEvent
from app.models.enums import ReliabilityEventType

#: Événements qui comptent une collaboration menée à son terme. Un seul type
#: aujourd'hui, mais la liste est nommée : `completed_collabs_count` répond à
#: « combien de fois ce créateur est allé au bout », et cette question pourrait
#: un jour avoir plusieurs réponses.
COMPTENT_UNE_COLLABORATION = (ReliabilityEventType.COLLAB_COMPLETED,)

#: Borne du score. Zéro à cent : lisible, et comparable aux seuils des paliers.
SCORE_MIN = Decimal("0")
SCORE_MAX = Decimal("100")


@dataclass(frozen=True, slots=True)
class Fiabilite:
    """Ce qu'un recalcul produit. Les deux caches d'un coup."""

    reliability_score: Decimal | None
    completed_collabs_count: int


def poids(type_: ReliabilityEventType) -> Decimal:
    """La pondération du jour, lue en configuration.

    Aucune valeur en dur : c'est en observant les premières collaborations qu'on
    saura ce qu'une absence doit coûter, et l'ajuster ne doit demander qu'un
    redémarrage.
    """
    return get_settings().reliability_weights[type_.value]


async def enregistrer(
    session: AsyncSession,
    *,
    creator_id: uuid.UUID,
    type_: ReliabilityEventType,
    booking_id: uuid.UUID | None = None,
) -> ReliabilityEvent:
    """Écrit un événement, puis rafraîchit les caches.

    Le poids est figé sur la ligne : il dit ce que l'événement valait au moment
    où il s'est produit, ce qu'un historique doit pouvoir raconter. Le recalcul,
    lui, relit avec la grille du jour — les deux ne servent pas à la même chose.
    """
    evenement = ReliabilityEvent(
        creator_id=creator_id,
        booking_id=booking_id,
        type=type_,
        weight=poids(type_),
    )
    session.add(evenement)
    await session.flush()

    await rafraichir(session, creator_id=creator_id)
    return evenement


def evaluer(evenements: list[tuple[ReliabilityEventType, Decimal]]) -> Fiabilite:
    """La règle, sans base de données.

    Le score part du neutre et bouge avec les pondérations, borné à zéro et
    cent. Un créateur sans événement n'a **pas** de score : il n'a pas encore
    d'historique, ce qui n'est pas la même chose qu'un mauvais historique.
    """
    if not evenements:
        return Fiabilite(reliability_score=None, completed_collabs_count=0)

    settings = get_settings()
    score = Decimal(settings.reliability_base_score)

    for type_, _fige in evenements:
        # La grille **du jour**, pas le poids figé sur la ligne : c'est ce qui
        # rend un ajustement de pondération rétroactif sans migration.
        score += poids(type_)

    score = min(max(score, SCORE_MIN), SCORE_MAX).quantize(Decimal("0.01"), ROUND_HALF_UP)
    collabs = sum(1 for type_, _ in evenements if type_ in COMPTENT_UNE_COLLABORATION)

    return Fiabilite(reliability_score=score, completed_collabs_count=collabs)


async def recalculer(session: AsyncSession, creator_id: uuid.UUID) -> Fiabilite:
    """Reconstruit les deux caches depuis les événements. Sans rien écrire.

    Séparé de `rafraichir` exprès : c'est cette fonction que le test de
    non-divergence appelle, et elle doit pouvoir tourner sans effet de bord sur
    ce qu'elle est censée vérifier.
    """
    lignes = await session.execute(
        sa.select(ReliabilityEvent.type, ReliabilityEvent.weight)
        .where(ReliabilityEvent.creator_id == creator_id)
        .order_by(ReliabilityEvent.occurred_at)
    )
    return evaluer([(ligne.type, ligne.weight) for ligne in lignes.all()])


async def rafraichir(session: AsyncSession, *, creator_id: uuid.UUID) -> Fiabilite:
    """Recalcule et écrit les caches."""
    fiabilite = await recalculer(session, creator_id)

    await session.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == creator_id)
        .values(
            reliability_score=fiabilite.reliability_score,
            completed_collabs_count=fiabilite.completed_collabs_count,
        )
    )
    await session.flush()
    return fiabilite


async def rafraichir_tout(session: AsyncSession, *, limite: int = 1000) -> int:
    """Reconstruit les caches de tous les créateurs qui ont un historique.

    Le geste qu'un changement de pondération demande. Il n'écrit rien de neuf :
    il remet en accord ce qui était déjà déductible des événements.
    """
    identifiants = list(
        await session.scalars(sa.select(ReliabilityEvent.creator_id).distinct().limit(limite))
    )
    for creator_id in identifiants:
        await rafraichir(session, creator_id=creator_id)
    return len(identifiants)


async def creator_du_booking(session: AsyncSession, booking_id: uuid.UUID) -> uuid.UUID | None:
    return await session.scalar(sa.select(Booking.creator_id).where(Booking.id == booking_id))
