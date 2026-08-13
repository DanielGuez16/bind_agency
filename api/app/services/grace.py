"""La période de grâce : ouvrir sans carte bancaire, et ce qui arrive au bout.

**Aucun paiement à l'ouverture.** Demander une carte au comptoir est la friction
la plus forte de tout le parcours, et elle arrive au moment exact où la personne
vient de dire oui. Le salon ouvre, se montre, reçoit des réservations ; la
question de l'abonnement se pose une fois qu'il a vu ce que ça donne — ce qui
est le seul argument qui vaille.

**Ce qui arrive au bout, et c'est la règle du produit partout ailleurs.** Les
offres cessent de paraître dans le fil. Le salon est prévenu avant. **Les
réservations déjà prises sont honorées** : elles ont été promises, et une
question de facturation n'est pas une raison de les défaire — la mécanique de
consommation et de contrepartie ne regarde pas le statut du commerce, et c'est
délibéré.

**C'est exactement la mise en pause, avec une autre raison.** Rien n'est effacé :
le catalogue, les horaires et l'historique restent, seule la visibilité
s'arrête. Un salon qui souscrit ensuite revient en ligne d'un geste.

**Mais souscrire ne réveille pas un salon en congés.** C'est pour cela que la
raison du retrait est une colonne et non une lecture du journal : le salon qui
s'est mis en pause pour travaux reste en pause quoi qu'il paie, et c'est lui qui
décide de revenir.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, Subscription, User
from app.models.enums import BusinessStatus, SuspensionReason
from app.services import subscription as subscription_service
from app.services.audit import Actor, AuditedEntity, record_transition

#: Motifs écrits au journal. Ce sont eux qu'on relira le jour où un salon
#: demandera pourquoi il a disparu du fil.
REASON_GRACE_OUVERTE = "grace_opened"
#: L'état écrit au journal à l'ouverture d'une grâce.
#:
#: **Pas le statut du commerce.** Une grâce s'ouvre sur un commerce qui vient de
#: passer `active` : écrire `active` produisait une seconde ligne indistincte de
#: la transition d'activation elle-même, et un test qui cherchait « la ligne qui
#: mène à active » en trouvait deux. Le journal décrit des transitions ; ceci
#: est un événement, et il se nomme comme tel — c'est déjà ce que fait
#: l'abonnement avec `subscription:...`.
ETAT_GRACE_OUVERTE = "grace:opened"
REASON_GRACE_ECHUE = "grace_expired"
REASON_RETOUR_EN_LIGNE = "subscription_restored_visibility"


@dataclass(frozen=True, slots=True)
class Balayage:
    """Ce qu'un passage a fait. Rendu plutôt que journalisé en vrac : c'est ce
    que la file d'administration affiche, et ce qu'un test lit."""

    ouvertes: int
    averties: int
    fermees: int


async def ouvrir(
    session: AsyncSession, *, business: Business, maintenant: datetime | None = None
) -> bool:
    """Ouvre la période de grâce du commerce. Rend faux s'il n'y avait rien à ouvrir.

    **Une seule règle, deux appelants.** L'activation l'appelle — le salon voit
    son échéance tout de suite, et non au prochain balayage — et le balayage
    l'appelle aussi, ce qui rattrape les commerces ouverts avant ce dispositif
    et ceux dont l'abonnement s'est arrêté. Écrite deux fois, elle aurait
    divergé au premier ajustement.
    """
    instant = maintenant or datetime.now(UTC)
    if business.grace_ends_at is not None:
        return False
    if await subscription_service.courant(session, business_id=business.id) is not None:
        # Un abonnement vivant : il n'y a pas d'échéance à surveiller, et lui
        # en poser une ferait sortir du fil un commerce qui paie.
        return False

    business.grace_ends_at = instant + timedelta(
        seconds=get_settings().subscription_grace_period_seconds
    )
    business.grace_warned_at = None
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        to_status=ETAT_GRACE_OUVERTE,
        actor=Actor.system(),
        reason=REASON_GRACE_OUVERTE,
        extra={"grace_ends_at": business.grace_ends_at.isoformat()},
    )
    return True


async def fermer(
    session: AsyncSession, *, business: Business, maintenant: datetime | None = None
) -> bool:
    """L'échéance est passée sans abonnement : le commerce quitte le fil.

    **Pas un effacement, et pas une annulation.** Exactement la mise en pause :
    le catalogue, les horaires et l'historique restent, les réservations déjà
    prises sont honorées, seule la visibilité s'arrête.
    """
    instant = maintenant or datetime.now(UTC)
    if business.status is not BusinessStatus.ACTIVE:
        return False
    if business.grace_ends_at is None or business.grace_ends_at > instant:
        return False
    if await subscription_service.courant(session, business_id=business.id) is not None:
        # Il a souscrit entre-temps et l'échéance n'a pas été nettoyée : on ne
        # sort pas du fil un commerce qui paie parce qu'une colonne traîne.
        business.grace_ends_at = None
        await session.flush()
        return False

    business.status = BusinessStatus.SUSPENDED
    business.suspended_reason = SuspensionReason.GRACE_EXPIRED
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=BusinessStatus.ACTIVE.value,
        to_status=BusinessStatus.SUSPENDED.value,
        actor=Actor.system(),
        reason=REASON_GRACE_ECHUE,
    )
    return True


async def rendre_la_visibilite(session: AsyncSession, *, business: Business, actor: User) -> bool:
    """Le commerce a souscrit : il revient en ligne s'il n'en était sorti que
    pour ça. Rend faux sinon.

    **Le salon en congés reste en congés.** Un paiement ne décide pas à sa
    place de rouvrir : c'est lui qui reviendra, quand ses travaux seront finis.
    """
    business.grace_ends_at = None
    business.grace_warned_at = None

    if (
        business.status is not BusinessStatus.SUSPENDED
        or business.suspended_reason is not SuspensionReason.GRACE_EXPIRED
    ):
        await session.flush()
        return False

    business.status = BusinessStatus.ACTIVE
    business.suspended_reason = None
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=BusinessStatus.SUSPENDED.value,
        to_status=BusinessStatus.ACTIVE.value,
        actor=Actor.from_user(actor),
        reason=REASON_RETOUR_EN_LIGNE,
    )
    return True


async def a_prevenir(
    session: AsyncSession, *, maintenant: datetime | None = None, limite: int = 200
) -> list[uuid.UUID]:
    """Les commerces dont l'échéance approche et qui n'ont pas encore été prévenus.

    `grace_warned_at` est ce qui empêche de prévenir à chaque passage : sans
    lui, un salon recevrait le même message toutes les heures pendant sept
    jours, et cesserait de lire les suivants.
    """
    instant = maintenant or datetime.now(UTC)
    seuil = instant + timedelta(seconds=get_settings().subscription_grace_warning_seconds)
    return list(
        await session.scalars(
            sa.select(Business.id)
            .where(
                Business.status == BusinessStatus.ACTIVE,
                Business.grace_ends_at.is_not(None),
                Business.grace_ends_at <= seuil,
                Business.grace_ends_at > instant,
                Business.grace_warned_at.is_(None),
            )
            .order_by(Business.grace_ends_at.asc())
            .limit(limite)
        )
    )


async def sans_echeance_ni_abonnement(
    session: AsyncSession, *, limite: int = 200
) -> list[uuid.UUID]:
    """Les commerces ouverts qui ne paient pas et qu'aucune échéance ne suit.

    Ceux ouverts avant ce dispositif, et ceux dont l'abonnement s'est arrêté.
    Sans ce rattrapage, un commerce resterait visible pour toujours sans jamais
    payer — et personne ne s'en apercevrait, parce que rien ne le regarde.
    """
    vivants = sa.select(Subscription.business_id).where(
        Subscription.status.in_(subscription_service.VIVANTS)
    )
    return list(
        await session.scalars(
            sa.select(Business.id)
            .where(
                Business.status == BusinessStatus.ACTIVE,
                Business.grace_ends_at.is_(None),
                Business.id.not_in(vivants),
            )
            .limit(limite)
        )
    )


async def echues(
    session: AsyncSession, *, maintenant: datetime | None = None, limite: int = 200
) -> list[uuid.UUID]:
    """Les échéances passées. Le balayage les ferme une à une."""
    instant = maintenant or datetime.now(UTC)
    return list(
        await session.scalars(
            sa.select(Business.id)
            .where(
                Business.status == BusinessStatus.ACTIVE,
                Business.grace_ends_at.is_not(None),
                Business.grace_ends_at <= instant,
            )
            .order_by(Business.grace_ends_at.asc())
            .limit(limite)
        )
    )
