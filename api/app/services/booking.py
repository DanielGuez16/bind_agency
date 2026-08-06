"""Création d'une réservation.

**Le verrou consultatif est le cœur de ce module**, et sa clé n'est pas
arbitraire : `business_id` **et le jour local**, comme le veut `SPEC.md` §3.5.
Verrouiller le commerce entier sérialiserait toutes ses réservations, y compris
celles de mardi prochain qui ne se disputent rien. Verrouiller le créneau seul
laisserait passer deux réservations de durées différentes qui se chevauchent :
9h30-10h30 et 10h00-11h00 ne partagent aucun créneau candidat, et pourtant elles
se disputent la même place à 10h00.

L'ordre est celui de la spec, et il n'est pas interchangeable :

1. verrou consultatif, à l'intérieur de la transaction
2. **recompte** de la capacité — pas la lecture faite avant le verrou
3. insertion en `held` avec son échéance
4. libération à la fin de la transaction, sans qu'on ait à y penser

Le recompte après le verrou est la seule chose qui compte. Vérifier avant de
verrouiller ne prouve rien : entre la vérification et l'écriture, quelqu'un
d'autre a eu le temps d'écrire.

**Un `held` n'est pas une réservation acquise**, c'est une place tenue dix
minutes le temps que le créateur confirme. Personne ne se fie au client pour la
libérer : un job de fond passe les `held` expirés en `expired`, et le calcul de
disponibilité les ignore dès leur échéance sans attendre ce job.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, Business, CatalogItem, CreatorProfile, Tier, TierOffer
from app.models.enums import BookingStatus, BusinessStatus
from app.services import audit, availability, eligibility


class BookingError(Exception):
    """Base des refus de réservation."""


class OfferNotBookable(BookingError):
    """Offre inconnue, retirée, palier inactif, ou commerce fermé."""


class TierNotAccessible(BookingError):
    """Ce compte n'ouvre pas ce palier."""


class NameRequired(BookingError):
    """Prénom et nom sont exigés avant la première réservation.

    Facultatifs à l'inscription : on ne demande pas son état civil à quelqu'un
    qui découvre le produit. Obligatoires ici, parce que le commerce reçoit
    quelqu'un et doit savoir qui, et parce que la vérification de cohérence
    compare ce nom au compte connecté.
    """


class SlotRequired(BookingError):
    """Cet item se réserve : il faut dire quand."""


class SlotNotAllowed(BookingError):
    """Cet item ne se réserve pas : il n'a pas de créneau, il a une validité."""


class SlotUnavailable(BookingError):
    """Le créneau demandé n'est plus libre. Le seul refus qui vienne du recompte."""


@dataclass(frozen=True, slots=True)
class DemandeDeReservation:
    tier_offer_id: uuid.UUID
    social_account_id: uuid.UUID
    starts_at: datetime | None = None


async def creer(
    session: AsyncSession, *, creator_id: uuid.UUID, demande: DemandeDeReservation
) -> Booking:
    """Pose un `held` sur une place, ou refuse. Jamais entre les deux."""
    settings = get_settings()

    profil = await session.get(CreatorProfile, creator_id)
    if profil is None or not profil.first_name or not profil.last_name:
        # Contrôlé ici et pas dans le profil : les champs restent facultatifs
        # tant que le créateur ne s'engage pas auprès de quelqu'un.
        raise NameRequired(str(creator_id))

    offre = await _offre_reservable(session, demande.tier_offer_id)
    item, business, tier = offre

    verdict = await eligibility.evaluer_createur(session, creator_id)
    if (demande.social_account_id, tier.id) not in verdict.couples_accessibles:
        raise TierNotAccessible(str(tier.id))

    if item.requires_booking and demande.starts_at is None:
        raise SlotRequired(str(item.id))
    if not item.requires_booking and demande.starts_at is not None:
        raise SlotNotAllowed(str(item.id))

    if not item.requires_booking:
        # Aucune capacité à disputer : pas de verrou, pas de recompte. Le
        # créateur se présente quand il veut avant l'échéance.
        return await _inserer(
            session,
            creator_id=creator_id,
            demande=demande,
            item=item,
            business=business,
            starts_at=None,
            valid_until=datetime.now(UTC) + timedelta(days=settings.booking_open_validity_days),
            settings=settings,
        )

    starts_at = demande.starts_at
    assert starts_at is not None  # noqa: S101 - garanti par les deux refus ci-dessus

    await _verrouiller(session, business_id=business.id, instant=starts_at)

    # **Après** le verrou, et pas avant : c'est ce recompte qui décide. Une
    # vérification faite plus tôt ne prouverait rien, quelqu'un d'autre ayant eu
    # le temps d'écrire entre-temps.
    if not await _creneau_encore_libre(session, business.id, item.id, starts_at):
        raise SlotUnavailable(starts_at.isoformat())

    return await _inserer(
        session,
        creator_id=creator_id,
        demande=demande,
        item=item,
        business=business,
        starts_at=starts_at,
        # Le droit de consommer s'éteint avec le créneau : une réservation
        # d'hier ne se consomme pas aujourd'hui.
        valid_until=starts_at + timedelta(minutes=item.duration_minutes or 0),
        settings=settings,
    )


async def _offre_reservable(
    session: AsyncSession, tier_offer_id: uuid.UUID
) -> tuple[CatalogItem, Business, Tier]:
    """L'offre, son item, son commerce et son palier — ou un refus unique.

    Offre inconnue, retirée, palier désactivé, item indisponible, commerce
    fermé : tous partagent une erreur. Les distinguer renseignerait sur ce qui
    existe chez un commerce dont le fil ne montre rien.
    """
    parent = sa.orm.aliased(CatalogItem)

    ligne = (
        await session.execute(
            sa.select(CatalogItem, Business, Tier)
            .select_from(TierOffer)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .join(Business, Business.id == TierOffer.business_id)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
            .where(
                TierOffer.id == tier_offer_id,
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                Business.status == BusinessStatus.ACTIVE,
                CatalogItem.is_available.is_(True),
                sa.or_(parent.id.is_(None), parent.is_available.is_(True)),
            )
        )
    ).one_or_none()

    if ligne is None:
        raise OfferNotBookable(str(tier_offer_id))
    return ligne


async def _verrouiller(session: AsyncSession, *, business_id: uuid.UUID, instant: datetime) -> None:
    """Verrou consultatif sur (commerce, jour), tenu jusqu'à la fin de la transaction.

    `pg_advisory_xact_lock` et non `pg_advisory_lock` : le second devrait être
    relâché à la main, et un chemin d'erreur qui oublie de le faire garde le
    verrou pour toute la vie de la connexion. Le premier tombe avec la
    transaction, qu'elle réussisse ou non.

    Le jour est celui du créneau en UTC. Une réservation à cheval sur deux jours
    locaux prendrait deux verrous différents ; le cas n'existe pas ici, les
    commerces fermant la nuit, et le supposer coûterait un second verrou à
    chaque réservation.
    """
    cle = sa.func.hashtextextended(
        sa.func.concat(sa.cast(business_id, sa.Text), instant.date().isoformat()), 0
    )
    await session.execute(sa.select(sa.func.pg_advisory_xact_lock(cle)))


async def _creneau_encore_libre(
    session: AsyncSession, business_id: uuid.UUID, item_id: uuid.UUID, starts_at: datetime
) -> bool:
    """Le créneau demandé figure-t-il encore parmi les libres.

    On repasse par le calcul de disponibilité plutôt que d'écrire un comptage
    ici : deux façons de compter la même chose finiraient par diverger, et la
    seconde serait celle qu'on oublierait de corriger. Le coût est borné —
    l'horizon est réduit au jour demandé.
    """
    creneaux = await availability.creneaux_libres(
        session,
        business_id=business_id,
        catalog_item_id=item_id,
        depuis=starts_at,
        horizon=timedelta(minutes=1),
    )
    return any(c.starts_at == starts_at for c in creneaux)


async def _inserer(
    session: AsyncSession,
    *,
    creator_id: uuid.UUID,
    demande: DemandeDeReservation,
    item: CatalogItem,
    business: Business,
    starts_at: datetime | None,
    valid_until: datetime,
    settings,
) -> Booking:
    duree = item.duration_minutes if item.requires_booking else None

    reservation = Booking(
        creator_id=creator_id,
        business_id=business.id,
        tier_offer_id=demande.tier_offer_id,
        catalog_item_id=item.id,
        social_account_id=demande.social_account_id,
        requires_booking=item.requires_booking,
        duration_minutes=duree,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(minutes=duree) if starts_at and duree else None,
        valid_until=valid_until,
        status=BookingStatus.HELD,
        hold_expires_at=datetime.now(UTC) + timedelta(seconds=settings.booking_hold_seconds),
        # Prix figé : le commerce peut changer sa carte, l'historique ne bouge pas.
        value_cents_snapshot=item.price_cents,
    )
    session.add(reservation)
    await session.flush()

    await audit.record_transition(
        session,
        entity=audit.AuditedEntity.BOOKING,
        entity_id=reservation.id,
        to_status=BookingStatus.HELD.value,
        actor=audit.Actor(kind=audit.ActorKind.CREATOR, user_id=creator_id),
    )
    return reservation
