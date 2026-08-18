"""Signaler un déplacement pour rien, et l'arbitrer.

**Le cas inverse de l'absence.** Un créateur qui ne vient pas produit un
`no_show` et un événement de fiabilité négatif. Un salon fermé, ou qui a oublié,
ne produisait rien : le créateur perdait son créneau, son déplacement, et n'avait
aucun endroit où le dire.

**Signaler ne pénalise jamais celui qui signale.** C'est la règle qui fait
exister ce dispositif : un recours qui coûte quelque chose n'est pas un recours.
La réservation part en `cancelled` — jamais en `no_show` — ce que `SPEC.md` §4.1
prescrit déjà pour toute défaillance qui ne vient pas du créateur.

**Et cela ferme la porte à la représaille.** `cancelled` est terminal : une fois
le signalement posé, le commerce ne peut plus marquer absent quelqu'un qu'il n'a
pas reçu. Sans cela, le recours ouvrait un risque au lieu d'en fermer un.

**Un signalement est une allégation, pas un verdict.** Il ne compte contre le
salon qu'une fois arbitré, comme un dossier en revue humaine. Transformer une
parole en sanction automatique donnerait à chaque créateur le pouvoir de noter
un salon sans que personne ne regarde.

**La fenêtre est courte et se mesure sur l'heure serveur.** Elle s'ouvre à
l'heure du créneau — on ne signale pas un déplacement qu'on n'a pas encore
fait — et se ferme quelques heures plus tard, quand plus personne ne peut
vérifier quoi que ce soit.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, Business, User, VenueReport
from app.models.enums import (
    BookingStatus,
    ReliabilityEventType,
    UserRole,
    VenueReportStatus,
)
from app.services import audit, booking_states, reliability


class VenueReportError(Exception):
    pass


class BookingNotReportable(VenueReportError):
    """La réservation n'est pas dans un état où l'on peut se déplacer pour rien.

    Une réservation annulée, consommée ou jamais confirmée ne donne lieu à
    aucun déplacement : dans le premier cas on a été prévenu, dans le deuxième
    on a été servi, dans le troisième il n'y avait pas de rendez-vous.
    """


class OutsideReportWindow(VenueReportError):
    """Trop tôt — le créneau n'a pas commencé — ou trop tard."""


class AlreadyReported(VenueReportError):
    """Un seul signalement par réservation."""


class ReportNotPending(VenueReportError):
    """Déjà tranché. Un arbitrage ne se refait pas."""


@dataclass(frozen=True, slots=True)
class LigneDeSignalement:
    """Ce qu'un arbitre a besoin de voir pour trancher."""

    report_id: uuid.UUID
    booking_id: uuid.UUID
    status: VenueReportStatus
    reported_at: datetime
    note: str | None
    starts_at: datetime | None
    business_id: uuid.UUID
    business_name: str
    creator_id: uuid.UUID
    #: Combien de signalements de ce créateur ont déjà été écartés.
    #:
    #: **Le seul chiffre qui parle d'abus**, et il est rendu à l'arbitre plutôt
    #: qu'appliqué automatiquement. Trois signalements écartés d'affilée ne se
    #: lisent pas comme un premier.
    signalements_ecartes_du_createur: int
    #: Combien de signalements de ce salon ont déjà été confirmés. La
    #: répétition d'un côté comme de l'autre est ce qui distingue l'accident du
    #: comportement.
    signalements_confirmes_du_salon: int


def fenetre_ouverte(booking: Booking, maintenant: datetime) -> bool:
    """La fenêtre s'ouvre au créneau et se ferme quelques heures après.

    **Semi-ouverte, et la borne compte.** Elle se lisait `<= fin`, si bien qu'à
    l'instant exact de la fermeture le signalement était encore possible **et**
    l'absence venait de s'ouvrir : les deux vrais en même temps, sur le seul
    instant que cette correction avait pour objet de départager. Le trou est
    infinitésimal et n'aurait sans doute jamais fait de victime ; il n'en est
    pas moins la seule chose qui empêchait les deux règles de partitionner le
    temps. Un intervalle fermé à droite et une ouverture au même instant ne se
    recollent pas — il fallait choisir, et une seconde d'epsilon aurait été un
    nombre inventé pour masquer le choix.

    **Un item sans créneau n'a pas de fenêtre.** Il n'y a pas d'heure à
    laquelle on l'attendait : le créateur se présente quand il veut avant
    l'échéance, et « c'était fermé » ne se rattache alors à aucun rendez-vous
    qu'on puisse vérifier. Le cas est écarté explicitement plutôt que laissé
    au hasard d'un `None`.
    """
    if booking.starts_at is None:
        return False
    fin = booking.starts_at + timedelta(seconds=get_settings().venue_report_window_seconds)
    return booking.starts_at <= maintenant < fin


async def signaler(
    session: AsyncSession,
    *,
    booking: Booking,
    creator_id: uuid.UUID,
    note: str | None = None,
    maintenant: datetime | None = None,
) -> VenueReport:
    """Enregistre le signalement et libère la réservation.

    L'ordre compte : on refuse d'abord ce qui ne peut pas être signalé, puis on
    écrit, puis on transitionne. Transitionner d'abord laisserait une
    réservation annulée sans le signalement qui l'explique si l'écriture
    échouait ensuite.
    """
    instant = maintenant or datetime.now(UTC)

    if booking.creator_id != creator_id:
        # Indistinct du reste : dire « pas à vous » apprendrait quelles
        # réservations existent.
        raise BookingNotReportable(str(booking.id))
    if booking.status is not BookingStatus.CONFIRMED:
        raise BookingNotReportable(booking.status.value)
    if not fenetre_ouverte(booking, instant):
        raise OutsideReportWindow(str(booking.id))

    deja = await session.scalar(
        sa.select(VenueReport.id).where(VenueReport.booking_id == booking.id)
    )
    if deja is not None:
        raise AlreadyReported(str(booking.id))

    signalement = VenueReport(
        booking_id=booking.id,
        creator_id=creator_id,
        business_id=booking.business_id,
        note=note,
        status=VenueReportStatus.PENDING,
    )
    session.add(signalement)
    await session.flush()

    # **`cancelled`, jamais `no_show`.** La règle existe déjà pour toute
    # défaillance qui ne vient pas du créateur, et elle vaut ici : il s'est
    # déplacé, c'est le contraire d'une absence. Aucun événement de fiabilité
    # négatif n'est écrit — `transitionner` n'en produit que sur `no_show`.
    await booking_states.transitionner(
        session,
        booking=booking,
        vers=BookingStatus.CANCELLED,
        actor=audit.Actor(kind=audit.ActorKind.CREATOR, user_id=creator_id),
        reason="déplacement signalé sans prestation servie",
    )
    return signalement


async def arbitrer(
    session: AsyncSession,
    *,
    signalement: VenueReport,
    retenu: bool,
    arbitre: User,
    maintenant: datetime | None = None,
) -> VenueReport:
    """Tranche un signalement. **Le seul endroit où il compte contre quelqu'un.**

    Retenu, il compte contre le salon — par le compteur, que le reporting lit.
    Écarté, il écrit un événement de fiabilité `abusive_report` sur le
    créateur, **dont le poids vaut zéro** : le mécanisme existe pour que la
    décision se prenne un jour sur des chiffres, pas pour punir aujourd'hui
    quelqu'un dont le signalement n'a pas été retenu — ce qui n'est pas la même
    chose qu'un mensonge.
    """
    if arbitre.role is not UserRole.ADMIN:
        raise ReportNotPending("seul un administrateur arbitre un signalement")
    if signalement.status is not VenueReportStatus.PENDING:
        raise ReportNotPending(signalement.status.value)

    signalement.status = VenueReportStatus.CONFIRMED if retenu else VenueReportStatus.REJECTED
    signalement.decided_at = maintenant or datetime.now(UTC)
    signalement.decided_by_user_id = arbitre.id
    await session.flush()

    if not retenu:
        await reliability.enregistrer(
            session,
            creator_id=signalement.creator_id,
            type_=ReliabilityEventType.ABUSIVE_REPORT,
            booking_id=signalement.booking_id,
        )

    return signalement


async def file_d_arbitrage(
    session: AsyncSession, *, limite: int = 100
) -> tuple[LigneDeSignalement, ...]:
    """Ce qui attend une décision, du plus ancien au plus récent.

    Le plus ancien d'abord : c'est celui qui attend depuis le plus longtemps, et
    une file lue dans l'autre sens laisse le premier arrivé au fond.
    """
    lignes = (
        await session.execute(
            sa.select(VenueReport, Booking.starts_at, Business.name)
            .join(Booking, Booking.id == VenueReport.booking_id)
            .join(Business, Business.id == VenueReport.business_id)
            .where(VenueReport.status == VenueReportStatus.PENDING)
            .order_by(VenueReport.reported_at.asc())
            .limit(max(1, min(limite, 500)))
        )
    ).all()

    # **Une boucle, pas une expression génératrice.** Les deux compteurs sont
    # des requêtes : `await` dans une expression génératrice produit un
    # générateur asynchrone, que `tuple()` ne sait pas parcourir. Le test l'a
    # dit ; à la lecture, la ligne paraissait juste.
    file = []
    for signalement, starts_at, nom in lignes:
        file.append(
            LigneDeSignalement(
                report_id=signalement.id,
                booking_id=signalement.booking_id,
                status=signalement.status,
                reported_at=signalement.reported_at,
                note=signalement.note,
                starts_at=starts_at,
                business_id=signalement.business_id,
                business_name=nom,
                creator_id=signalement.creator_id,
                signalements_ecartes_du_createur=await _compter(
                    session,
                    colonne=VenueReport.creator_id,
                    valeur=signalement.creator_id,
                    statut=VenueReportStatus.REJECTED,
                ),
                signalements_confirmes_du_salon=await _compter(
                    session,
                    colonne=VenueReport.business_id,
                    valeur=signalement.business_id,
                    statut=VenueReportStatus.CONFIRMED,
                ),
            )
        )
    return tuple(file)


async def _compter(
    session: AsyncSession, *, colonne, valeur: uuid.UUID, statut: VenueReportStatus
) -> int:
    return (
        await session.scalar(
            sa.select(sa.func.count())
            .select_from(VenueReport)
            .where(colonne == valeur, VenueReport.status == statut)
        )
    ) or 0


async def confirmes_du_commerce(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    depuis: datetime | None = None,
    jusqu_a: datetime | None = None,
) -> int:
    """Les signalements retenus contre un salon, sur une fenêtre.

    **Rendu, jamais transformé en note.** Il n'existe pas de score de commerce
    dans ce produit, et en inventer un est une décision d'une autre taille que
    celle-ci. Ce compteur est l'événement à partir duquel un score se
    calculerait le jour venu — recalculé depuis ses faits, comme le score de
    fiabilité, jamais écrit à la main.
    """
    return (
        await session.scalar(
            sa.select(sa.func.count())
            .select_from(VenueReport)
            .where(
                VenueReport.business_id == business_id,
                VenueReport.status == VenueReportStatus.CONFIRMED,
                *([VenueReport.reported_at >= depuis] if depuis else []),
                *([VenueReport.reported_at < jusqu_a] if jusqu_a else []),
            )
        )
    ) or 0
