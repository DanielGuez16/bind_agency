"""Disponibilité, calculée à la volée.

**Aucune ligne de créneau n'est matérialisée**, et c'est une décision de fond.
Des créneaux écrits à l'avance devraient être régénérés à chaque changement
d'horaire, à chaque exception, à chaque item dont la durée bouge — et le jour où
la régénération échoue, le commerce vend des places qui n'existent pas. Calculer
coûte une requête ; matérialiser coûte une classe entière de désynchronisations.

L'algorithme est celui de `SPEC.md` §3.4 : pour chaque jour de l'horizon, les
fenêtres d'ouverture du commerce ; dans chaque fenêtre, des débuts candidats de
quinze en quinze minutes ; un candidat est libre si le nombre de réservations
qui recoupent `[début, début + durée)` reste sous le nombre de postes.

**Les horaires sont des heures locales du commerce, pas des instants.** Ils sont
stockés tels qu'ils sont saisis ; la conversion vers le fuseau n'a lieu qu'ici.
C'est ce qui fait qu'un commerce à Miami garde son ouverture à neuf heures des
deux côtés du changement d'heure, au lieu de glisser à huit ou à dix.

**Ce sont les réservations qui portent leur durée, pas l'item.** Un commerce qui
allonge un soin ne doit pas allonger rétroactivement ce qui est déjà réservé —
sans quoi le calcul verrait des occupations qui n'ont jamais été prises ainsi.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, Business, CapacityException, CapacityRule, CatalogItem
from app.models.enums import BookingStatus

#: Pas des débuts candidats. Un quart d'heure : assez fin pour qu'un créneau de
#: trente minutes ait deux départs par heure, assez large pour que l'horizon ne
#: produise pas des milliers de candidats à parcourir.
PAS = timedelta(minutes=15)

#: Réservations qui occupent réellement une place. `cancelled`, `expired` et
#: `no_show` n'occupent rien : la place est rendue. `held` occupe **tant que le
#: garde n'a pas expiré** — c'est tout l'intérêt du garde, et l'oublier ferait
#: vendre deux fois la même place pendant les dix minutes du parcours.
STATUTS_OCCUPANTS = (BookingStatus.HELD, BookingStatus.CONFIRMED, BookingStatus.CONSUMED)


class AvailabilityError(Exception):
    """Base des refus de calcul."""


class ItemNotBookable(AvailabilityError):
    """L'item ne se réserve pas : il n'a pas de créneaux, il a une validité."""


class ItemNotFound(AvailabilityError):
    """Item inexistant, ou d'un autre commerce."""


@dataclass(frozen=True, slots=True)
class Creneau:
    starts_at: datetime
    ends_at: datetime
    #: Ce qu'il reste de places à cet instant précis. Rendu plutôt que caché :
    #: l'app peut signaler « dernière place » sans redemander.
    places_restantes: int


@dataclass(frozen=True, slots=True)
class Fenetre:
    """Une plage d'ouverture d'un jour donné, en heures locales."""

    debut: time
    fin: time
    postes: int


def fenetres_du_jour(
    jour: date, regles: list[CapacityRule], exception: CapacityException | None
) -> list[Fenetre]:
    """Les plages d'ouverture d'un jour. L'exception **remplace** la règle.

    Elle ne s'y ajoute pas : une journée aménagée est décrite entièrement par
    son exception, sinon il faudrait deviner ce qui de la règle survit.
    """
    if exception is not None:
        if exception.is_closed or exception.start_time is None or exception.end_time is None:
            return []
        return [
            Fenetre(
                debut=exception.start_time,
                fin=exception.end_time,
                # Une exception sans nombre de postes garde celui de la règle du
                # jour ; s'il n'y a pas de règle ce jour-là, un seul poste.
                postes=exception.concurrent_slots
                or max(
                    (r.concurrent_slots for r in regles if r.weekday == jour.weekday()), default=1
                ),
            )
        ]

    return [
        Fenetre(debut=r.start_time, fin=r.end_time, postes=r.concurrent_slots)
        for r in regles
        if r.weekday == jour.weekday()
    ]


def _instant(jour: date, heure: time, fuseau: ZoneInfo) -> datetime:
    """Une heure locale du commerce, ramenée à un instant.

    `fold=0` par convention lors du recul d'heure, où la même heure locale
    existe deux fois : on retient la première occurrence. Le cas est rare et
    n'importe quel choix est arbitraire ; le fixer évite qu'il varie.
    """
    return datetime.combine(jour, heure, tzinfo=fuseau).astimezone(UTC)


async def creneaux_libres(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    catalog_item_id: uuid.UUID,
    depuis: datetime | None = None,
    horizon: timedelta | None = None,
    limite: int | None = None,
) -> list[Creneau]:
    """Les débuts possibles pour cet item, dans l'horizon de réservation.

    `limite` arrête le parcours dès qu'assez de créneaux ont été trouvés. Le fil
    n'a besoin que de savoir s'il en reste **un** : parcourir trente jours pour
    répondre « oui » multiplierait ce coût par le nombre d'items du fil.
    """
    settings = get_settings()
    depuis = depuis or datetime.now(UTC)
    horizon = horizon or timedelta(days=settings.booking_horizon_days)
    jusqu_a = depuis + horizon

    item = await session.scalar(
        sa.select(CatalogItem).where(
            CatalogItem.id == catalog_item_id, CatalogItem.business_id == business_id
        )
    )
    if item is None:
        raise ItemNotFound(str(catalog_item_id))
    if not item.requires_booking or item.duration_minutes is None:
        raise ItemNotBookable(str(catalog_item_id))

    if not await _est_proposable(session, item):
        # Item désactivé, directement ou par son parent. Aucun créneau, et ce
        # n'est pas une erreur : c'est une réponse vide qui a un sens.
        return []

    business = await session.get(Business, business_id)
    if business is None:
        raise ItemNotFound(str(catalog_item_id))
    fuseau = ZoneInfo(business.timezone)

    regles = list(
        await session.scalars(
            sa.select(CapacityRule).where(CapacityRule.business_id == business_id)
        )
    )
    if not regles:
        return []

    premier_jour = depuis.astimezone(fuseau).date()
    dernier_jour = jusqu_a.astimezone(fuseau).date()

    exceptions = {
        e.date: e
        for e in await session.scalars(
            sa.select(CapacityException).where(
                CapacityException.business_id == business_id,
                CapacityException.date.between(premier_jour, dernier_jour),
            )
        )
    }

    occupations = await _occupations(session, business_id, depuis, jusqu_a)
    duree = timedelta(minutes=item.duration_minutes)

    creneaux: list[Creneau] = []
    jour = premier_jour
    while jour <= dernier_jour:
        for fenetre in fenetres_du_jour(jour, regles, exceptions.get(jour)):
            creneaux.extend(
                _creneaux_de_la_fenetre(jour, fenetre, fuseau, duree, occupations, depuis, jusqu_a)
            )
            if limite is not None and len(creneaux) >= limite:
                return creneaux[:limite]
        jour += timedelta(days=1)

    return creneaux


def _creneaux_de_la_fenetre(
    jour: date,
    fenetre: Fenetre,
    fuseau: ZoneInfo,
    duree: timedelta,
    occupations: list[tuple[datetime, datetime]],
    depuis: datetime,
    jusqu_a: datetime,
) -> list[Creneau]:
    ouverture = _instant(jour, fenetre.debut, fuseau)
    fermeture = _instant(jour, fenetre.fin, fuseau)

    libres = []
    debut = ouverture
    while debut + duree <= fermeture:
        fin = debut + duree

        # Un créneau qui a commencé n'est plus réservable, et un créneau
        # au-delà de l'horizon non plus.
        if debut >= depuis and debut < jusqu_a:
            prises = sum(1 for d, f in occupations if d < fin and debut < f)
            if prises < fenetre.postes:
                libres.append(
                    Creneau(starts_at=debut, ends_at=fin, places_restantes=fenetre.postes - prises)
                )

        debut += PAS

    return libres


async def _occupations(
    session: AsyncSession, business_id: uuid.UUID, depuis: datetime, jusqu_a: datetime
) -> list[tuple[datetime, datetime]]:
    """Les intervalles réellement occupés, bornes lues sur la réservation.

    Un `held` dont le garde a expiré n'occupe plus rien, même si le job qui le
    passera en `expired` n'est pas encore passé. S'appuyer sur le seul statut
    ferait tenir la place d'une réservation abandonnée jusqu'au prochain
    balayage.
    """
    lignes = await session.execute(
        sa.select(Booking.starts_at, Booking.ends_at).where(
            Booking.business_id == business_id,
            Booking.status.in_(STATUTS_OCCUPANTS),
            Booking.starts_at.is_not(None),
            Booking.starts_at < jusqu_a,
            Booking.ends_at > depuis,
            sa.or_(
                Booking.status != BookingStatus.HELD,
                Booking.hold_expires_at > sa.func.clock_timestamp(),
            ),
        )
    )
    return [(ligne.starts_at, ligne.ends_at) for ligne in lignes]


async def _est_proposable(session: AsyncSession, item: CatalogItem) -> bool:
    """`is_available` du parent désactive ses variantes, sans le dupliquer.

    L'état n'est pas recopié sur les enfants : il est calculé. Deux copies d'une
    même vérité finissent toujours par diverger, et c'est la seconde qu'on
    oublie de corriger.
    """
    if not item.is_available:
        return False
    if item.parent_item_id is None:
        return True

    return bool(
        await session.scalar(
            sa.select(CatalogItem.is_available).where(CatalogItem.id == item.parent_item_id)
        )
    )
