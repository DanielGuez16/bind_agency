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


class AbsenceTropTot(BookingStateError):
    """L'heure du rendez-vous n'est pas assez loin pour parler d'absence.

    **Une absence pénalise, et une pénalité ne se pose pas sur un retard de
    trois minutes.** Sans ce délai, un salon pressé pouvait marquer absente une
    créatrice qui poussait la porte — et l'événement de fiabilité, lui, ne se
    retire pas. Le délai est en configuration : c'est un seuil, et c'est aussi
    la première chose qu'on voudra ajuster en observant les premières tournées.

    Ce n'est pas une règle d'affichage doublée côté serveur pour faire joli. Le
    bouton s'ouvre à l'heure du téléphone du salon, qui n'est pas une preuve ;
    la seule horloge qui décide est celle du serveur.
    """


class CreneauDepasse(BookingStateError):
    """L'heure est passée : il n'y a plus rien à accepter.

    Accepter après coup produirait une réservation confirmée pour un rendez-vous
    qui n'aura pas lieu, et un code de retrait pour un créneau écoulé. Le
    créateur n'a rien à se reprocher : la décision n'est simplement plus
    possible.
    """


def echeance_d_accord(booking: Booking, *, maintenant: datetime | None = None) -> datetime:
    """Jusqu'à quand le commerce peut trancher.

    **Le délai de configuration, borné par le début du créneau.** Promettre une
    réponse pour le lendemain sur une prestation qui commence dans trois heures
    ne veut rien dire : le commerce aurait « encore le temps » alors que la
    créatrice serait déjà passée devant la porte. Le plus tôt des deux gagne.

    **Un droit sans créneau n'a rien qui le borne** — `starts_at` est nul, on
    prend le délai plein. Le créateur se présente quand il veut avant
    `valid_until`, et rien dans la journée ne fixe d'heure limite.

    **Une échéance déjà passée est un résultat valable**, pas un cas à
    rattraper. Confirmer une demande dont le créneau a commencé laisse au
    commerce un temps nul : c'est exact, il n'y a plus rien à accepter. Le
    balayage la fera expirer au passage suivant, ce qui rend la place au lieu de
    la garder pour un rendez-vous qui n'aura pas lieu.
    """
    depart = maintenant or datetime.now(UTC)
    plein = depart + timedelta(seconds=get_settings().booking_approval_seconds)
    return min(plein, booking.starts_at) if booking.starts_at is not None else plein


#: Ce que chaque issue produit comme événement de fiabilité, quand l'état
#: d'arrivée suffit à le dire. Déclaré plutôt que dispersé dans les branches :
#: une issue ajoutée sans son événement se verrait ici.
EVENEMENT_PAR_ISSUE: dict[BookingStatus, ReliabilityEventType] = {
    BookingStatus.NO_SHOW: ReliabilityEventType.NO_SHOW,
}


async def transitionner(
    session: AsyncSession,
    *,
    booking: Booking,
    vers: BookingStatus,
    actor: audit.Actor,
    reason: str | None = None,
    evenement: ReliabilityEventType | None = None,
) -> Booking:
    """Le seul chemin. Vérifie la flèche, écrit l'état, écrit le journal.

    `evenement` nomme ce que l'état d'arrivée ne dit pas. Un seul appelant s'en
    sert — l'annulation tardive, qui arrive en `cancelled` comme une annulation
    à temps et n'est distinguée que par l'heure.
    """
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

    # **Posée ici et nulle part ailleurs**, pour la même raison que la table des
    # transitions existe : `awaiting_business` s'atteint depuis `confirmer`
    # aujourd'hui, et rien ne dit que ce sera le seul chemin demain. Une pose
    # faite chez l'appelant serait celle qu'on oublierait au deuxième chemin, et
    # l'oubli produirait une demande sans échéance — que la contrainte refuse,
    # mais bien plus loin, sous une erreur d'intégrité qui ne dit rien.
    booking.approval_expires_at = (
        echeance_d_accord(booking) if vers is BookingStatus.AWAITING_BUSINESS else None
    )

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
    #
    # **L'appelant peut en nommer un que l'état d'arrivée ne dit pas.** Une
    # annulation tardive arrive en `cancelled` comme une annulation à temps —
    # c'est la même chose du point de vue du dossier, elle a prévenu — et seule
    # `annuler` sait qu'elle était tardive. La table couvre ce qui se déduit de
    # l'état ; le paramètre couvre ce qui n'en dépend pas.
    type_ = evenement or EVENEMENT_PAR_ISSUE.get(vers)
    if type_ is not None:
        await reliability.enregistrer(
            session,
            creator_id=booking.creator_id,
            type_=type_,
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

    **La pénalité ne concerne que ce que le salon a réellement tenu.** Trois
    états s'annulent donc toujours sans coût :

    — un `held`, où rien n'a été promis et où le garde serait tombé seul ;
    — un droit sans créneau, qui ne bloque aucun poste ;
    — une demande que le salon **n'a pas encore acceptée**.

    Le troisième est arrivé après les deux autres, et il réparait un défaut
    atteignable tous les jours. `booking_approval_seconds` et
    `booking_free_cancellation_seconds` valent vingt-quatre heures l'un et
    l'autre : toute demande chez un salon en validation, pour un rendez-vous à
    moins d'un jour, visait donc `no_show` — une flèche que le diagramme n'a
    pas depuis `awaiting_business`. La créatrice ne recevait pas une pénalité,
    elle recevait un refus, et restait coincée sur un rendez-vous que le salon
    n'avait même pas accepté.

    **Et la bonne issue n'est pas d'ajouter la flèche.** Une place jamais
    acceptée n'a pas de créneau tenu ni de capacité réservée : le salon n'a
    rien à perdre, et faire payer une pénalité pour elle reviendrait à punir
    quelqu'un de l'indécision d'un autre.
    """
    if booking.creator_id != creator_id:
        raise NotYours(str(booking.id))

    acteur = audit.Actor(kind=audit.ActorKind.CREATOR, user_id=creator_id)

    # Les trois cas où rien n'a été tenu : le garde, le droit sans créneau, et
    # la demande que le salon n'a pas acceptée. Voir le docstring — le troisième
    # rendait une réservation impossible à annuler, faute de flèche.
    if (
        booking.status is BookingStatus.HELD
        or booking.status is BookingStatus.AWAITING_BUSINESS
        or not booking.requires_booking
    ):
        return await transitionner(
            session, booking=booking, vers=BookingStatus.CANCELLED, actor=acteur
        )

    fenetre = timedelta(seconds=get_settings().booking_free_cancellation_seconds)
    tardive = booking.starts_at is not None and datetime.now(UTC) > booking.starts_at - fenetre

    # **L'état d'arrivée est le même, le coût non.** Elle a prévenu : le dossier
    # est annulé, pas absent, et l'écran du salon doit lire « annulée » plutôt
    # qu'une absence qui n'a pas eu lieu. Ce qui distingue les deux est un
    # événement de fiabilité, plus léger que celui d'une absence.
    #
    # **Et l'écart entre les deux est ce qui porte l'incitation.** Tant qu'ils
    # coûtaient pareil, rien ne poussait à prévenir plutôt qu'à disparaître —
    # or un salon prévenu à onze heures remplit son créneau de quatorze heures
    # trente, celui qui l'apprend à quatorze heures quarante-cinq a perdu son
    # après-midi.
    return await transitionner(
        session,
        booking=booking,
        vers=BookingStatus.CANCELLED,
        actor=acteur,
        reason="annulation dans la fenêtre de pénalité" if tardive else None,
        evenement=ReliabilityEventType.CANCELLED_LATE if tardive else None,
    )


def fin_de_l_annulation_libre(starts_at: datetime | None, statut: BookingStatus) -> datetime | None:
    """Jusqu'à quand l'annulation ne coûte rien. `None` quand elle est toujours libre.

    **L'écran disait qu'annuler tard pouvait coûter, sans pouvoir dire quand.**
    Le seuil vit en configuration, et le recopier côté écran le ferait mentir au
    premier ajustement — la même raison qui a fait naître `absence_signalable_a`
    sur la journée du commerce. Or c'est exactement l'heure qui change la
    décision : « gratuit jusqu'à 14 h 30 » fait annuler maintenant, « annuler
    tard coûte » fait renoncer ou fait annuler trop tard.

    **`None` veut dire « toujours libre », jamais « on ne sait pas ».** Trois
    cas le rendent : un `held`, où rien n'a été promis ; un droit sans créneau,
    qui ne bloque aucun poste ; et une demande que le salon n'a pas acceptée.
    Poser un instant sur l'un des trois ferait croire à une limite qui n'existe
    pas, et ferait renoncer quelqu'un qui n'avait rien à perdre.

    Le deuxième se lit sur `starts_at` seul, et il n'y a rien à ajouter : une
    contrainte de `booking` impose déjà `NOT requires_booking` ⇒ `starts_at IS
    NULL`. Redire la règle ici ferait deux endroits pour un invariant que la
    base tient, et le second finirait par diverger du premier.

    Calculée par le serveur, comme sa voisine : l'horloge d'un terminal n'est
    pas une preuve, et un écran qui déduirait ce seuil d'une heure locale
    fausse annoncerait « gratuit » sur une annulation qui coûte.
    """
    if starts_at is None:
        return None
    if statut in (BookingStatus.HELD, BookingStatus.AWAITING_BUSINESS):
        return None
    return starts_at - timedelta(seconds=get_settings().booking_free_cancellation_seconds)


def ouverture_de_l_absence(starts_at: datetime | None) -> datetime | None:
    """L'instant à partir duquel l'absence peut être constatée, sur l'heure du créneau.

    **Deux délais, et c'est le plus tardif qui décide.** Ils ne protègent pas la
    même chose, et prendre l'un sans l'autre laisse un trou :

    — `no_show_delai_minutes` dit qu'**une créatrice en retard n'est pas
      absente**. Vingt minutes, parce que l'événement de fiabilité qu'une
      absence écrit ne se retire pas.
    — `venue_report_window_seconds` dit qu'**une créatrice qui s'est déplacée
      garde son recours**. Tant que sa fenêtre de signalement est ouverte, le
      salon ne peut pas la marquer absente : ce serait effacer le recours de
      celle qui est venue, par la main de celui qui a oublié le rendez-vous.

    **L'asymétrie que ce `max` referme était réelle et mesurable.** Le
    signalement s'ouvrait à l'heure du créneau, l'absence vingt minutes plus
    tard, et la fenêtre se fermait quatre heures après. Il restait donc trois
    heures quarante pendant lesquelles un salon fermé pouvait marquer absente
    celle qu'il n'avait pas reçue — et lui fermer sa seule porte en même temps
    qu'il lui coûtait vingt-cinq points. Les vingt premières minutes, celles où
    elle est encore sur la route, étaient précisément les siennes.

    **Un `max` plutôt qu'un troisième réglage.** Poser un délai propre à cette
    règle créerait deux nombres à tenir d'accord à la main, et le jour où l'on
    allongerait la fenêtre de signalement la porte se rouvrirait sans que
    personne ne s'en aperçoive. Ici la garantie suit la fenêtre par
    construction ; et si la fenêtre passait un jour sous vingt minutes, le
    plancher du retard tiendrait toujours.

    `None` quand l'absence ne se constatera jamais : un item sans créneau n'a
    pas d'heure à laquelle ne pas se présenter, et `SPEC.md` §4.1 dit que
    `no_show` n'existe pas dans ce cas — l'expiration suffit.
    """
    if starts_at is None:
        return None
    settings = get_settings()
    return starts_at + max(
        timedelta(minutes=settings.no_show_delai_minutes),
        # La fin de la fenêtre de `venue_report.fenetre_ouverte`, lue sur le
        # même réglage. Elle n'est pas importée : `venue_report` dépend déjà de
        # ce module, et l'inverse fermerait le cycle. Un test tient les deux
        # d'accord, ce qu'un commentaire seul ne ferait pas.
        timedelta(seconds=settings.venue_report_window_seconds),
    )


def absence_signalable_a(booking: Booking) -> datetime | None:
    """La même chose, sur une réservation.

    Rendue au client pour qu'il sache **quand** ouvrir le bouton, et calculée
    ici pour que l'écran n'ait pas à connaître les délais. Un seuil recopié dans
    l'application dérive du jour où on l'ajuste côté serveur, et cette dérive-là
    se lit comme un bouton fermé qui devrait être ouvert.
    """
    if not booking.requires_booking:
        return None
    return ouverture_de_l_absence(booking.starts_at)


async def marquer_absent(
    session: AsyncSession,
    *,
    booking: Booking,
    actor: audit.Actor,
    reason: str,
    maintenant: datetime | None = None,
) -> Booking:
    """Le commerce constate l'absence. Toujours motivé : il pénalise quelqu'un.

    **Et jamais avant le délai.** Voir `AbsenceTropTot` : une créatrice en
    retard de trois minutes n'est pas absente, et l'événement de fiabilité que
    la transition écrit ne se retire pas.
    """
    # **L'état d'abord, l'heure ensuite.** Une réservation déjà annulée ne
    # deviendra jamais une absence, quelle que soit l'heure : lui répondre
    # « trop tôt » ferait attendre vingt minutes pour rien, puis recommencer.
    # C'est un test existant — celui du signalement de lieu, où le commerce
    # tente l'absence après une annulation — qui a montré l'ordre à prendre.
    if BookingStatus.NO_SHOW in TRANSITIONS[booking.status]:
        ouverture = absence_signalable_a(booking)
        # `None` laisse passer : c'est le cas de l'item sans créneau, que
        # `transitionner` refuse déjà avec le message qui convient. Le doubler
        # ici rendrait deux refus différents pour une même situation.
        if ouverture is not None and (maintenant or datetime.now(UTC)) < ouverture:
            raise AbsenceTropTot(ouverture.isoformat())

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
    rien faire d'autre que patienter.

    **Sur `approval_expires_at`, et non plus à l'heure du rendez-vous.** Ce
    balayage attendait `coalesce(starts_at, valid_until)` : un filet contre les
    dossiers morts, pas un délai de réponse. Une demande posée trois semaines à
    l'avance pouvait dormir trois semaines, et un droit sans créneau trente
    jours — en tenant la place tout du long, et sans que personne, d'aucun des
    deux côtés, sache jusqu'à quand.

    La nouvelle échéance est toujours **plus stricte** que l'ancienne : elle
    vaut au plus le délai de configuration, et elle est bornée par `starts_at`.
    Ce balayage attrape donc tout ce qu'il attrapait, plus tôt.

    Aucun événement de fiabilité : personne n'a manqué à rien. Un commerce qui
    ne répond pas n'a rien promis, et le créateur n'a rien manqué non plus.
    """
    depassees = list(
        await session.scalars(
            sa.select(Booking)
            .where(
                Booking.status == BookingStatus.AWAITING_BUSINESS,
                Booking.approval_expires_at <= sa.func.clock_timestamp(),
            )
            .order_by(Booking.approval_expires_at)
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
            reason="le commerce n'a pas tranché dans le délai",
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
