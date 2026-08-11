"""Reporting commerce : ce que sa participation lui a rapporté.

**Le commerce paie un abonnement et donne des prestations. Il veut savoir ce
qu'il reçoit en retour.** C'est la première chose qu'on lui demandera après une
démonstration, et le produit ne savait pas y répondre.

Ce qui est compté, et pourquoi :

- **Les publications livrées**, par palier. C'est la contrepartie, la seule
  chose qu'il obtient réellement. Comptées sur les contreparties approuvées :
  une publication soumise n'est pas une publication acceptée.
- **La valeur offerte**, en centimes. C'est le seul montant du reporting, et il
  est du côté du commerce : ce qu'il a donné, pas ce qu'il a gagné. Sans lui,
  « douze publications » ne se met en regard de rien.
- **Le taux d'honoration** : combien de prestations consommées ont produit une
  publication. C'est le chiffre qui dit si le système tient sa promesse.
- **Les absences**, comptées à part. Elles ne sont pas des non-honorations : la
  prestation n'a pas été donnée, rien n'a été perdu qu'un créneau.
- **La portée cumulée**, somme des abonnés des comptes ayant publié, relevés au
  moment de la publication. Approximative et annoncée comme telle : ce n'est pas
  une audience réellement atteinte, c'est un ordre de grandeur.

**Aucun montant n'est rendu côté créateur, et celui-ci ne l'est qu'au commerce
qui l'a offert** — le résolveur d'appartenance protège la route.

**La portée est un ordre de grandeur, pas une mesure.** Le nombre d'abonnés
d'un compte n'est pas le nombre de personnes ayant vu une story. Le rendre sans
le dire ferait prendre une approximation pour un résultat ; c'est pour cela que
le champ s'appelle `portee_approximative` et pas `vues`.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Booking,
    Business,
    CatalogItem,
    Collaboration,
    SocialAccount,
    SocialMetricsSnapshot,
    Tier,
    TierOffer,
)
from app.models.enums import BookingStatus, CollaborationStatus, ContentFormat, Platform

#: Fenêtre par défaut. Trente jours : assez long pour qu'un commerce à faible
#: volume voie quelque chose, assez court pour que le chiffre bouge quand il
#: agit.
FENETRE_PAR_DEFAUT = timedelta(days=30)


@dataclass(frozen=True, slots=True)
class LigneDeSemaine:
    """Une semaine, et ce qui y a été publié.

    La semaine est celle du fuseau du commerce, pas celle du serveur : un salon
    de Miami n'a pas la même semaine 32 qu'une base en UTC, et le décalage se
    voit sur la première et la dernière barre.
    """

    #: Le lundi de la semaine, en date locale. Ce qui l'étiquette à l'écran.
    debut: date
    publications: int


@dataclass(frozen=True, slots=True)
class LigneDePalier:
    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    #: Contreparties approuvées. Une publication soumise n'en est pas une.
    publications: int
    #: Ce que le commerce a offert pour les obtenir, en centimes.
    valeur_offerte_cents: int


@dataclass(frozen=True, slots=True)
class LigneDItem:
    catalog_item_id: uuid.UUID
    name: str
    reservations: int
    consommations: int
    publications: int
    valeur_offerte_cents: int


@dataclass(frozen=True, slots=True)
class Reporting:
    business_id: uuid.UUID
    currency: str
    #: Les bornes réellement employées, en UTC. Rendues pour que le commerce
    #: puisse vérifier ce qui a été compté.
    debut: datetime
    fin: datetime
    timezone: str

    reservations: int
    #: Réservations effectivement consommées au comptoir.
    consommations: int
    annulations: int
    absences: int

    publications: int
    #: Contreparties encore ouvertes : ni approuvées, ni tombées.
    publications_attendues: int
    non_honorees: int

    valeur_offerte_cents: int
    #: Somme des abonnés des comptes ayant publié, au relevé le plus proche de
    #: la publication. **Ordre de grandeur**, jamais une audience atteinte.
    portee_approximative: int

    par_palier: tuple[LigneDePalier, ...]
    par_item: tuple[LigneDItem, ...]
    #: Les publications approuvées, semaine par semaine, dans le fuseau du
    #: commerce. Une évolution dans le temps est ce qu'un total ne dit pas :
    #: « 62 publications » se lit pareil qu'on en ait fait cinq par semaine ou
    #: soixante en une.
    par_semaine: tuple[LigneDeSemaine, ...]

    @property
    def taux_d_honoration(self) -> float | None:
        """Publications obtenues sur prestations consommées.

        `None` quand rien n'a été consommé : zéro sur zéro n'est pas zéro, et
        afficher 0 % à un commerce qui n'a encore servi personne serait un
        reproche pour quelque chose qu'il n'a pas fait.
        """
        if self.consommations == 0:
            return None
        return round(self.publications / self.consommations, 4)


async def pour_le_commerce(
    session: AsyncSession,
    *,
    business: Business,
    depuis: date | None = None,
    jusqu_a: date | None = None,
) -> Reporting:
    """Le reporting d'une fenêtre, découpée dans le fuseau du commerce.

    Comme la journée du comptoir : une date arrive sans heure, et la convertir
    depuis le serveur ferait commencer le mois d'un salon de Miami à 20 h la
    veille.
    """
    fuseau = ZoneInfo(business.timezone)
    aujourd_hui = datetime.now(fuseau).date()
    fin_jour = jusqu_a or aujourd_hui
    debut_jour = depuis or (fin_jour - FENETRE_PAR_DEFAUT)

    debut = datetime.combine(debut_jour, datetime.min.time(), tzinfo=fuseau)
    # Bornes inclusives côté utilisateur : « du 1er au 31 » contient le 31.
    fin = datetime.combine(fin_jour + timedelta(days=1), datetime.min.time(), tzinfo=fuseau)

    fenetre = sa.and_(
        Booking.business_id == business.id,
        Booking.created_at >= debut,
        Booking.created_at < fin,
    )

    # --- compteurs de réservation ---------------------------------------
    par_statut = dict(
        (
            await session.execute(
                sa.select(Booking.status, sa.func.count()).where(fenetre).group_by(Booking.status)
            )
        ).all()
    )
    total = sum(par_statut.values())
    consommations = par_statut.get(BookingStatus.CONSUMED, 0)

    # --- contreparties ---------------------------------------------------
    par_statut_contrepartie = dict(
        (
            await session.execute(
                sa.select(Collaboration.status, sa.func.count())
                .join(Booking, Booking.id == Collaboration.booking_id)
                .where(fenetre)
                .group_by(Collaboration.status)
            )
        ).all()
    )
    publications = par_statut_contrepartie.get(CollaborationStatus.APPROVED, 0)
    ouvertes = sum(
        nombre
        for statut, nombre in par_statut_contrepartie.items()
        if statut not in (CollaborationStatus.APPROVED, CollaborationStatus.UNFULFILLED)
    )

    # --- valeur offerte ---------------------------------------------------
    #
    # Sur les prestations **consommées**, pas sur les réservations : une
    # réservation annulée n'a rien coûté au commerce, et la compter gonflerait
    # ce qu'il croit avoir donné.
    valeur = (
        await session.scalar(
            sa.select(sa.func.coalesce(sa.func.sum(Booking.value_cents_snapshot), 0)).where(
                fenetre, Booking.status == BookingStatus.CONSUMED
            )
        )
    ) or 0

    return Reporting(
        business_id=business.id,
        currency=business.currency,
        debut=debut,
        fin=fin,
        timezone=business.timezone,
        reservations=total,
        consommations=consommations,
        annulations=par_statut.get(BookingStatus.CANCELLED, 0),
        absences=par_statut.get(BookingStatus.NO_SHOW, 0),
        publications=publications,
        publications_attendues=ouvertes,
        non_honorees=par_statut_contrepartie.get(CollaborationStatus.UNFULFILLED, 0),
        valeur_offerte_cents=valeur,
        portee_approximative=await _portee(session, fenetre),
        par_palier=await _par_palier(session, fenetre),
        par_semaine=await _par_semaine(session, fenetre, fuseau),
        par_item=await _par_item(session, fenetre),
    )


async def _portee(session: AsyncSession, fenetre) -> int:
    """Somme des abonnés des comptes ayant publié, au relevé le plus proche.

    Le relevé **antérieur à l'approbation** est retenu, pas le plus récent : un
    créateur qui a doublé son audience depuis ne rend pas rétroactivement la
    publication plus large qu'elle ne l'a été.
    """
    proche = (
        sa.select(SocialMetricsSnapshot.followers_count)
        .where(
            SocialMetricsSnapshot.social_account_id == SocialAccount.id,
            SocialMetricsSnapshot.captured_at <= Collaboration.approved_at,
        )
        .order_by(SocialMetricsSnapshot.captured_at.desc())
        .limit(1)
        .correlate(SocialAccount, Collaboration)
        .scalar_subquery()
    )

    return (
        await session.scalar(
            sa.select(sa.func.coalesce(sa.func.sum(proche), 0))
            .select_from(Collaboration)
            .join(Booking, Booking.id == Collaboration.booking_id)
            .join(SocialAccount, SocialAccount.id == Booking.social_account_id)
            .where(fenetre, Collaboration.status == CollaborationStatus.APPROVED)
        )
    ) or 0


async def _par_semaine(session: AsyncSession, fenetre, fuseau) -> tuple[LigneDeSemaine, ...]:
    """Les publications approuvées, groupées par semaine locale.

    `date_trunc` sur l'horodatage **converti dans le fuseau du commerce** : le
    faire en UTC rattacherait à la semaine précédente tout ce qui est publié le
    dimanche soir à Miami, où il est déjà lundi à Greenwich.

    Les semaines sans publication ne sortent pas de la base — un `GROUP BY` ne
    fabrique pas les vides. C'est l'appelant qui complète, parce que lui seul
    sait sur combien de semaines il veut afficher.
    """
    locale = sa.func.timezone(str(fuseau), Collaboration.approved_at)
    lignes = (
        await session.execute(
            sa.select(
                sa.func.date_trunc("week", locale).label("semaine"),
                sa.func.count(Collaboration.id),
            )
            .select_from(Booking)
            .join(Collaboration, Collaboration.booking_id == Booking.id)
            .where(fenetre, Collaboration.status == CollaborationStatus.APPROVED)
            .group_by("semaine")
            .order_by("semaine")
        )
    ).all()

    return tuple(LigneDeSemaine(debut=semaine.date(), publications=n) for semaine, n in lignes)


async def _par_palier(session: AsyncSession, fenetre) -> tuple[LigneDePalier, ...]:
    lignes = (
        await session.execute(
            sa.select(
                Tier.id,
                Tier.platform,
                Tier.content_format,
                sa.func.count(Collaboration.id).filter(
                    Collaboration.status == CollaborationStatus.APPROVED
                ),
                sa.func.coalesce(
                    sa.func.sum(Booking.value_cents_snapshot).filter(
                        Booking.status == BookingStatus.CONSUMED
                    ),
                    0,
                ),
            )
            .select_from(Booking)
            .join(TierOffer, TierOffer.id == Booking.tier_offer_id)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .outerjoin(Collaboration, Collaboration.booking_id == Booking.id)
            .where(fenetre)
            .group_by(Tier.id, Tier.platform, Tier.content_format, Tier.display_order)
            .order_by(Tier.display_order)
        )
    ).all()

    return tuple(
        LigneDePalier(
            tier_id=tier_id,
            platform=platform,
            content_format=content_format,
            publications=publications,
            valeur_offerte_cents=valeur,
        )
        for tier_id, platform, content_format, publications, valeur in lignes
    )


async def _par_item(session: AsyncSession, fenetre) -> tuple[LigneDItem, ...]:
    """Par prestation, pour que le commerce sache laquelle marche.

    C'est la lecture qui change une décision : composer davantage de ce qui
    part, retirer ce qui ne part pas.
    """
    lignes = (
        await session.execute(
            sa.select(
                CatalogItem.id,
                CatalogItem.name,
                sa.func.count(Booking.id),
                sa.func.count(Booking.id).filter(Booking.status == BookingStatus.CONSUMED),
                sa.func.count(Collaboration.id).filter(
                    Collaboration.status == CollaborationStatus.APPROVED
                ),
                sa.func.coalesce(
                    sa.func.sum(Booking.value_cents_snapshot).filter(
                        Booking.status == BookingStatus.CONSUMED
                    ),
                    0,
                ),
            )
            .select_from(Booking)
            .join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
            .outerjoin(Collaboration, Collaboration.booking_id == Booking.id)
            .where(fenetre)
            .group_by(CatalogItem.id, CatalogItem.name)
            .order_by(sa.func.count(Booking.id).desc(), CatalogItem.name)
        )
    ).all()

    return tuple(
        LigneDItem(
            catalog_item_id=item_id,
            name=name,
            reservations=reservations,
            consommations=consommations,
            publications=publications,
            valeur_offerte_cents=valeur,
        )
        for item_id, name, reservations, consommations, publications, valeur in lignes
    )
