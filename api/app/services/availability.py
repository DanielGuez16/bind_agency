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
from collections.abc import Sequence
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
#: Ce qui occupe une place. `awaiting_business` en fait partie : la relâcher
#: pendant que le commerce regarde le profil permettrait de vendre deux fois la
#: même place, et de lui faire accepter une réservation qui n'a plus de place.
STATUTS_OCCUPANTS = (
    BookingStatus.HELD,
    BookingStatus.AWAITING_BUSINESS,
    BookingStatus.CONFIRMED,
    BookingStatus.CONSUMED,
)


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


async def couples_avec_creneau(
    session: AsyncSession,
    couples: Sequence[tuple[uuid.UUID, uuid.UUID]],
    *,
    depuis: datetime | None = None,
    horizon: timedelta | None = None,
) -> set[tuple[uuid.UUID, uuid.UUID]]:
    """Parmi ces couples `(commerce, item)`, lesquels ont encore un créneau.

    **Cinq requêtes, quel que soit le nombre de couples.** `creneaux_libres` en
    fait six par couple : l'item, son parent, le commerce, les règles, les
    exceptions, les occupations. Le fil en appelait une par ligne réservable et
    montait à cent vingt et une requêtes pour dix-neuf salons. Ici les six
    lectures sont faites une fois pour tout l'ensemble, et le parcours des
    créneaux — qui ne touche pas la base — se refait par couple en mémoire.

    **Le même algorithme, pas un second.** `fenetres_du_jour` et
    `_creneaux_de_la_fenetre` sont ceux de `creneaux_libres`, appelés sur les
    mêmes données. Une seconde implémentation du calcul de disponibilité
    divergerait de la première au premier changement, et c'est la divergence
    qu'on ne verrait pas : les deux répondraient, l'une aurait tort.

    **On s'arrête au premier créneau trouvé.** La question posée est « en
    reste-t-il un », jamais « lesquels » : parcourir trente jours pour répondre
    oui multiplierait le coût par le nombre d'items.

    Un item qui n'exige pas de réservation n'est pas ici : il est réservable par
    construction, et l'appelant le sait avant d'appeler.
    """
    if not couples:
        return set()

    settings = get_settings()
    depuis = depuis or datetime.now(UTC)
    horizon = horizon or timedelta(days=settings.booking_horizon_days)
    jusqu_a = depuis + horizon

    items_vises = {item_id for _, item_id in couples}
    commerces_vises = {business_id for business_id, _ in couples}

    # 1 · Les items, et l'état de leur parent. `outerjoin` plutôt qu'une seconde
    #     requête : un item sans parent garde une disponibilité nulle, que le
    #     `is_(None)` ci-dessous lit comme « rien ne le désactive ».
    parent = sa.orm.aliased(CatalogItem)
    lignes_items = (
        await session.execute(
            sa.select(
                CatalogItem.id,
                CatalogItem.business_id,
                CatalogItem.requires_booking,
                CatalogItem.duration_minutes,
                CatalogItem.is_available,
                parent.is_available.label("parent_disponible"),
            )
            .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
            .where(CatalogItem.id.in_(items_vises))
        )
    ).all()
    items = {ligne.id: ligne for ligne in lignes_items}

    # 2 · Le fuseau de chaque commerce.
    fuseaux = {
        identifiant: ZoneInfo(nom)
        for identifiant, nom in (
            await session.execute(
                sa.select(Business.id, Business.timezone).where(Business.id.in_(commerces_vises))
            )
        ).all()
    }

    # 3 · Les règles de capacité, groupées par commerce.
    regles: dict[uuid.UUID, list[CapacityRule]] = {}
    for regle in await session.scalars(
        sa.select(CapacityRule).where(CapacityRule.business_id.in_(commerces_vises))
    ):
        regles.setdefault(regle.business_id, []).append(regle)

    # 4 · Les exceptions, sur la plage de dates la plus large possible.
    #
    #     Les commerces n'ont pas le même fuseau : prendre les bornes en UTC
    #     élargies d'un jour de chaque côté couvre tous les décalages sans avoir
    #     à faire une requête par fuseau. Une exception lue en trop ne sert
    #     simplement à personne.
    exceptions: dict[uuid.UUID, dict[date, CapacityException]] = {}
    for exception in await session.scalars(
        sa.select(CapacityException).where(
            CapacityException.business_id.in_(commerces_vises),
            CapacityException.date.between(
                (depuis - timedelta(days=1)).date(), (jusqu_a + timedelta(days=1)).date()
            ),
        )
    ):
        exceptions.setdefault(exception.business_id, {})[exception.date] = exception

    # 5 · Les occupations, groupées par commerce.
    occupations: dict[uuid.UUID, list[tuple[datetime, datetime]]] = {}
    for business_id, debut, fin in (
        await session.execute(
            sa.select(Booking.business_id, Booking.starts_at, Booking.ends_at).where(
                Booking.business_id.in_(commerces_vises),
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
    ).all():
        occupations.setdefault(business_id, []).append((debut, fin))

    avec: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for business_id, item_id in couples:
        item = items.get(item_id)
        if item is None or item.business_id != business_id:
            continue
        # **Deux gardes que rien ne peut faire tomber, et c'est voulu.** Une
        # contrainte en base interdit `requires_booking` sans durée, et
        # `fenetres_du_jour` ne rend rien pour un commerce sans règle : les
        # retirer ne change aucun verdict, l'exercice de mutation le montre. On
        # les garde parce qu'elles disent la même chose que `creneaux_libres`
        # — `ItemNotBookable` d'un côté, un `continue` de l'autre — et parce que
        # sans elles, `timedelta(minutes=None)` lèverait le jour où la
        # contrainte bougerait, dans une boucle qui traite tout le fil.
        if not item.requires_booking or item.duration_minutes is None:
            continue
        # `is_available` du parent désactive ses variantes, sans le dupliquer :
        # nul quand il n'y a pas de parent, donc rien ne désactive.
        if not item.is_available or item.parent_disponible is False:
            continue
        lignes = regles.get(business_id)
        fuseau = fuseaux.get(business_id)
        if not lignes or fuseau is None:
            continue

        if _reste_un_creneau_en_memoire(
            regles=lignes,
            exceptions=exceptions.get(business_id, {}),
            occupations=occupations.get(business_id, []),
            fuseau=fuseau,
            duree=timedelta(minutes=item.duration_minutes),
            depuis=depuis,
            jusqu_a=jusqu_a,
        ):
            avec.add((business_id, item_id))

    return avec


def _reste_un_creneau_en_memoire(
    *,
    regles: list[CapacityRule],
    exceptions: dict[date, CapacityException],
    occupations: list[tuple[datetime, datetime]],
    fuseau: ZoneInfo,
    duree: timedelta,
    depuis: datetime,
    jusqu_a: datetime,
) -> bool:
    """Le parcours de `creneaux_libres`, sans aucune lecture de base.

    Séparé pour que le groupement n'ait rien à réimplémenter : il fournit les
    données, celui-ci applique la règle, et la règle reste écrite une fois.
    """
    jour = depuis.astimezone(fuseau).date()
    dernier = jusqu_a.astimezone(fuseau).date()
    while jour <= dernier:
        for fenetre in fenetres_du_jour(jour, regles, exceptions.get(jour)):
            if _creneaux_de_la_fenetre(jour, fenetre, fuseau, duree, occupations, depuis, jusqu_a):
                return True
        jour += timedelta(days=1)
    return False


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


@dataclass(frozen=True, slots=True)
class JourDeDisponibilite:
    """Un jour de la bande, tel que l'écran des créneaux le dessine."""

    jour: date
    #: Le commerce ouvre-t-il ce jour-là ? **Indépendant de l'item** : c'est
    #: l'horaire du salon, pas la disponibilité de la prestation.
    ouvert: bool
    #: Combien de débuts possibles restent pour cet item.
    #:
    #: **Zéro sur un jour ouvert n'est pas la même chose qu'un jour fermé**, et
    #: c'est toute la raison de rendre les deux. « Complet » se dit et invite à
    #: regarder le lendemain ; « fermé » se grise. Un écran qui n'aurait que le
    #: compte peindrait les deux de la même façon, et la personne croirait le
    #: salon fermé un jour où il déborde.
    creneaux_libres: int


async def disponibilite_par_jour(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    catalog_item_id: uuid.UUID,
    depuis: datetime | None = None,
    jours: int = 14,
) -> list[JourDeDisponibilite]:
    """La bande de quatorze jours, en un appel.

    **Le même algorithme, pas un second.** Les créneaux viennent de
    `creneaux_libres`, qui parcourt déjà jour par jour ; on les groupe par date
    locale. Recompter ici ferait deux vérités sur ce qui est libre, et c'est
    celle qu'on ne relit pas qui finirait par mentir — le même piège que la règle
    de l'absence écrite deux fois.

    **Un jour sans créneau n'est pas forcément fermé**, d'où la seconde lecture :
    les règles et les exceptions disent l'ouverture, `fenetres_du_jour` les
    interprète, et c'est la fonction que le reste du calcul emploie déjà.

    Quatorze appels devenaient quatorze parcours complets de la même base de
    règles. Ici, deux requêtes de plus que pour un seul jour.
    """
    depuis = depuis or datetime.now(UTC)
    horizon = timedelta(days=jours)

    creneaux = await creneaux_libres(
        session,
        business_id=business_id,
        catalog_item_id=catalog_item_id,
        depuis=depuis,
        horizon=horizon,
    )

    business = await session.get(Business, business_id)
    if business is None:
        raise ItemNotFound(str(catalog_item_id))
    fuseau = ZoneInfo(business.timezone)

    premier = depuis.astimezone(fuseau).date()
    dernier = (depuis + horizon).astimezone(fuseau).date()

    regles = list(
        await session.scalars(
            sa.select(CapacityRule).where(CapacityRule.business_id == business_id)
        )
    )
    exceptions = {
        e.date: e
        for e in await session.scalars(
            sa.select(CapacityException).where(
                CapacityException.business_id == business_id,
                CapacityException.date.between(premier, dernier),
            )
        )
    }

    comptes: dict[date, int] = {}
    for creneau in creneaux:
        local = creneau.debut.astimezone(fuseau).date()
        comptes[local] = comptes.get(local, 0) + 1

    bande: list[JourDeDisponibilite] = []
    jour = premier
    # `jours` jours à partir d'aujourd'hui, bornes comprises côté départ : une
    # bande de quatorze commence aujourd'hui et finit dans treize jours.
    for _ in range(jours):
        bande.append(
            JourDeDisponibilite(
                jour=jour,
                ouvert=bool(fenetres_du_jour(jour, regles, exceptions.get(jour))),
                creneaux_libres=comptes.get(jour, 0),
            )
        )
        jour += timedelta(days=1)
    return bande
