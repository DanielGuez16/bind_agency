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

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import (
    AuditLog,
    Booking,
    Business,
    CatalogItem,
    Collaboration,
    CreatorProfile,
    Proof,
    SocialAccount,
    Tier,
    TierOffer,
)
from app.models.enums import (
    ActorKind,
    CaptureMethod,
    CollaborationStatus,
    ContentFormat,
    Platform,
    ReliabilityEventType,
)
from app.services import audit, reliability

# **Importés dans la fonction et non en tête.** `notifications` lit un
# commerce, `outbox` lit les préférences : les deux remontent jusqu'ici par
# leurs propres imports, et se déclarer mutuellement en haut ferait un cycle.
from app.services.audit import AuditedEntity

logger = logging.getLogger(__name__)

#: Depuis ces états, une échéance dépassée fait tomber le dossier. `submitted`
#: n'en fait pas partie : le créateur a répondu, c'est à nous de contrôler.
EXPIRABLES = (CollaborationStatus.PENDING, CollaborationStatus.RESUBMIT_REQUESTED)

#: Les dossiers qui attendent **un geste de la créatrice**, et eux seuls.
#:
#: `submitted` et `under_review` n'en font pas partie : elle a envoyé, c'est au
#: salon de regarder. Les confondre est ce qui faisait réclamer une action au
#: badge des réservations pour des dossiers où elle ne peut rien faire.
#:
#: Le même partage que `EXPIRABLES`, et ce n'est pas un hasard : un dossier ne
#: tombe à l'échéance que s'il attendait quelque chose d'elle. Les deux listes
#: restent distinctes parce qu'elles répondent à deux questions — ce qui expire,
#: ce qui se compte — et rien ne garantit qu'elles resteront égales.
ATTENDENT_LA_CREATRICE = frozenset(
    {CollaborationStatus.PENDING, CollaborationStatus.RESUBMIT_REQUESTED}
)

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
            # Ajoutée pour l'arbitrage. Elle n'est empruntable que par
            # `constater_non_honoree`, réservée à l'administrateur : ni la
            # boucle automatique — qui filtre sur `EXPIRABLES` — ni le commerce
            # — qui n'appelle qu'`approuver` et
            # `demander_une_nouvelle_soumission` — ne peuvent la prendre. La
            # table dit ce qui est possible, l'appelant dit qui a le droit.
            CollaborationStatus.UNFULFILLED,
            # Même réserve, même raison : seul `fermer_sans_faute` la prend.
            CollaborationStatus.CLOSED_NO_FAULT,
        }
    ),
    # `under_review` figure dans les statuts de `SPEC.md` §2.6 mais pas dans le
    # diagramme §4.2. Contradiction signalée ; en attendant, il est traité comme
    # ce que le diagramme appelle « contrôle » : une étape facultative entre la
    # soumission et son issue. Le contrôle automatique la saute, un regard
    # humain peut s'y arrêter. Le laisser hors de la table rendrait le
    # dictionnaire partiel et lèverait un `KeyError` en production.
    CollaborationStatus.UNDER_REVIEW: frozenset(
        {
            CollaborationStatus.APPROVED,
            CollaborationStatus.RESUBMIT_REQUESTED,
            # Même arbitrage, même réserve.
            CollaborationStatus.UNFULFILLED,
            CollaborationStatus.CLOSED_NO_FAULT,
        }
    ),
    CollaborationStatus.RESUBMIT_REQUESTED: frozenset(
        {
            CollaborationStatus.SUBMITTED,
            CollaborationStatus.UNFULFILLED,
            # **C'est ici qu'elle sert le plus.** Le drapeau de revue humaine se
            # lève dans `demander_une_nouvelle_soumission`, qui laisse le
            # dossier en `resubmit_requested` : un dossier refusé trois fois
            # pour le même motif est exactement dans cet état-là quand
            # l'arbitre l'ouvre.
            CollaborationStatus.CLOSED_NO_FAULT,
            # **Les deux arrêtes de l'arbitrage manquaient ici**, et c'est le
            # seul état qui atteint réellement la revue humaine : le drapeau se
            # lève dans `demander_une_nouvelle_soumission`, qui laisse le
            # dossier en `resubmit_requested`. Elles avaient été posées sur
            # `submitted` et `under_review` — deux états que le dossier ne
            # traverse qu'ensuite, s'il traverse.
            #
            # Résultat : la seule sortie de la boucle automatique répondait 409
            # sur deux de ses trois issues, et un dossier à la troisième
            # tentative restait bloqué pour toujours.
            CollaborationStatus.APPROVED,
            # Rouvrir une fenêtre déjà ouverte. Ce n'est pas un non-mouvement :
            # `demander_une_nouvelle_soumission` repousse l'échéance, et c'est
            # exactement ce qu'un arbitre accorde à une créatrice qui n'a pas
            # eu le temps.
            CollaborationStatus.RESUBMIT_REQUESTED,
        }
    ),
    # Terminaux, déclarés vides plutôt qu'absents : la différence entre
    # « terminal » et « oublié » doit se voir.
    CollaborationStatus.APPROVED: frozenset(),
    CollaborationStatus.UNFULFILLED: frozenset(),
    CollaborationStatus.CLOSED_NO_FAULT: frozenset(),
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

    # **Le message qui ouvre le délai.** Il était écrit et traduit depuis des
    # mois, et personne ne l'envoyait : le créateur repartait du salon sans
    # savoir ce qu'il devait publier ni pour quand, sinon en rouvrant
    # l'application. Déposé ici, dans la transaction qui crée la contrepartie.
    await _deposer_pour_le_createur(
        session, collaboration=collaboration, cle="collaboration.opened"
    )
    return collaboration


async def transitionner(
    session: AsyncSession,
    *,
    collaboration: Collaboration,
    vers: CollaborationStatus,
    actor: audit.Actor,
    reason: str | None = None,
    note: str | None = None,
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
        note=note,
    )
    await _emettre_les_evenements(session, collaboration=collaboration, vers=vers)
    await _prevenir_le_createur(session, collaboration=collaboration, vers=vers)
    await _clore_la_reservation(session, collaboration=collaboration, vers=vers, actor=actor)
    return collaboration


#: Les trois façons dont un dossier de publication se termine.
#:
#: Déclaré plutôt que répété en `or` : une quatrième issue ajoutée demain se
#: voit ici, et non trois mois plus tard sur une réservation restée « à
#: envoyer ». C'est la même raison qui fait exister `EVENEMENTS_PAR_ISSUE`.
ISSUES_TERMINALES = frozenset(
    {
        CollaborationStatus.APPROVED,
        CollaborationStatus.UNFULFILLED,
        CollaborationStatus.CLOSED_NO_FAULT,
    }
)

#: Ce que le journal de la réservation écrit, selon l'issue qui l'a fermée.
#:
#: Un dictionnaire plutôt qu'une chaîne unique : « contrepartie tranchée » ne
#: distingue pas une publication acceptée d'un dossier tombé à l'échéance, et
#: c'est exactement la question qu'on pose au journal quand on l'ouvre.
CAUSES_DE_CLOTURE = {
    CollaborationStatus.APPROVED: "contrepartie approuvée",
    CollaborationStatus.UNFULFILLED: "contrepartie non honorée",
    CollaborationStatus.CLOSED_NO_FAULT: "contrepartie fermée sans faute",
}


async def _clore_la_reservation(
    session: AsyncSession,
    *,
    collaboration: Collaboration,
    vers: CollaborationStatus,
    actor: audit.Actor,
) -> None:
    """La réservation suit sa contrepartie jusqu'au bout.

    **Ici et pas dans les appelants.** Trois routes ferment un dossier — le
    salon qui approuve, la boucle d'échéance, l'arbitre — et une quatrième
    viendra. Posée sur la transition, la clôture les couvre toutes, comme le
    code de retrait est posé sur l'arrivée en `confirmed` et non sur chacune
    des deux portes qui y mènent.

    **L'import est différé, et c'est un cycle réel** : `booking_states` importe
    ce module pour créer la contrepartie à la consommation. Les deux services
    se tiennent par les deux bouts du même échange, ce qui est le dessin voulu ;
    seul l'ordre de chargement des modules s'y oppose.
    """
    if vers not in ISSUES_TERMINALES:
        return

    from app.services import booking_states

    booking = await session.get(Booking, collaboration.booking_id)
    if booking is None:  # pragma: no cover - la clé étrangère l'interdit
        return

    # L'acteur est celui de la transition de contrepartie : le journal d'audit
    # de la réservation doit porter qui l'a réellement fermée — le salon qui
    # approuve, l'arbitre, ou la boucle d'échéance.
    await booking_states.clore(
        session, booking=booking, actor=actor, reason=CAUSES_DE_CLOTURE[vers]
    )


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
    # **`closed_no_fault` n'y figure pas, et c'est le point de l'issue.** Aucun
    # événement, ni positif ni négatif : le dossier se ferme sans être mis au
    # débit de personne.
    #
    # Un événement neutre de poids nul serait presque la même chose, et pas
    # tout à fait : `evaluer` rend un score **nul** tant qu'aucun événement
    # n'existe, et un nombre dès qu'il y en a un. Une créatrice dont l'unique
    # événement serait cette clôture passerait donc de « pas encore de score »
    # — neutre, condition ignorée — à un score de départ comparable au seuil
    # d'un palier. Ne rien écrire est la seule façon de ne rien changer.
    #
    # Le signal produit — un motif qui revient trois fois sur beaucoup de
    # dossiers — vit ailleurs, dans le compte rendu à l'administration : c'est
    # une question d'exigence mal formulée, pas de fiabilité de personne.
}


#: Les issues qui méritent de sortir de l'application, et leur message.
#:
#: **`unfulfilled` y figure désormais.** On l'en avait écarté au motif qu'un
#: dossier clos ne demande plus rien et que l'annoncer serait une punition de
#: plus. C'était se tromper de sujet : la non-honoration **fait baisser le
#: score de fiabilité**, donc ferme des paliers. L'apprendre en constatant, des
#: semaines plus tard, qu'on ne peut plus réserver ce qu'on réservait est bien
#: pire que de le lire le jour même. Le message a son propre genre : il se
#: coupe, mais séparément des rappels.
#: **La clé seule, et non un couple (genre, clé).** Le genre y figurait, et
#: plus personne ne le lisait depuis que la boîte d'envoi le déduit de la clé :
#: une mutation l'a montré en changeant ce genre sans qu'aucun test ne tombe.
#: Deux sources pour la même information finissent par se contredire, et c'est
#: celle qu'on ne lit pas qui ment le plus longtemps.
NOTIFICATION_PAR_ISSUE = {
    CollaborationStatus.APPROVED: "collaboration.approved",
    CollaborationStatus.RESUBMIT_REQUESTED: "collaboration.resubmit",
    CollaborationStatus.UNFULFILLED: "collaboration.unfulfilled",
    # **Elle est prévenue, et c'est une bonne nouvelle à annoncer.** Sans
    # message, une créatrice qui a essayé trois fois attend une réponse qui ne
    # viendra jamais et croit son dossier encore ouvert.
    CollaborationStatus.CLOSED_NO_FAULT: "collaboration.closed_no_fault",
}


async def _prevenir_le_createur(
    session: AsyncSession, *, collaboration: Collaboration, vers: CollaborationStatus
) -> None:
    """Notifie sur la transition, comme les événements de fiabilité.

    **Au même endroit et pour la même raison** : un appel séparé finit par être
    oublié sur une branche, et c'est la branche oubliée qui laisse quelqu'un
    sans nouvelle de sa publication.
    """
    cle = NOTIFICATION_PAR_ISSUE.get(vers)
    if cle is None:
        return
    await _deposer_pour_le_createur(session, collaboration=collaboration, cle=cle)


async def _deposer_pour_le_createur(
    session: AsyncSession, *, collaboration: Collaboration, cle: str
) -> None:
    """Dépose un message du dossier dans la boîte d'envoi.

    Une seule fonction pour l'ouverture et pour les issues : deux façons de
    composer le même contexte finiraient par en oublier un champ, et c'est le
    message le moins fréquent qui partirait amputé.
    """

    # **Déposé dans la transition, pas envoyé à côté.** Le message part avec la
    # transition qu'il annonce : ou les deux existent, ou aucun. Il n'y a plus
    # rien à avaler ici — un service d'envoi injoignable reporte le message et
    # ne touche pas à la contrepartie.
    from app.services import notifications, outbox

    contexte = await notifications.contexte_de(session, collaboration)
    if contexte is None:
        return

    # **Tous les champs du contexte, et non ceux du message du jour.** Le
    # gabarit d'ouverture est le seul à nommer le format et les exigences ; ne
    # passer que ce dont les autres ont besoin les aurait rendus vides, sans
    # rien casser et sans que personne ne le voie — le message serait parti en
    # disant « publiez » sans dire quoi.
    await outbox.deposer(
        session,
        user_id=contexte.user_id,
        cle=cle,
        creator=contexte.creator,
        business=contexte.business,
        item=contexte.item,
        format=contexte.format,
        deadline=contexte.deadline,
        requirements=contexte.requirements,
        # **`reason` et non `motif`.** Tous les gabarits nomment leurs
        # variables en anglais — `{creator}`, `{business}`, `{item}` — et
        # `collaboration.resubmit` écrit `{reason}`. Le seul champ déposé en
        # français levait donc un `KeyError` au rendu : le message de reprise
        # ne partait jamais, et c'est celui qui explique à quelqu'un ce qu'on
        # lui reproche.
        reason=contexte.motif,
    )


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
    note: str | None = None,
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
        note=note,
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


async def constater_non_honoree(
    session: AsyncSession,
    *,
    collaboration: Collaboration,
    actor: audit.Actor,
    reason: str,
    note: str | None = None,
) -> Collaboration:
    """Clore un dossier en non honoré. **Réservé à l'arbitrage administrateur.**

    C'est la seule issue que le commerce n'a pas : il approuve ou il redemande,
    et il ne ferme jamais définitivement. Un arbitre, lui, doit pouvoir clore —
    sinon un dossier sorti de la boucle automatique à la troisième tentative y
    reste indéfiniment, et personne ne sait plus qui doit agir.

    Le motif est obligatoire. Une clôture sans motif est illisible pour les deux
    parties, et c'est la seule décision du produit qui ne se rouvre pas.
    """
    return await transitionner(
        session,
        collaboration=collaboration,
        vers=CollaborationStatus.UNFULFILLED,
        actor=actor,
        reason=reason,
        note=note,
    )


async def fermer_sans_faute(
    session: AsyncSession,
    *,
    collaboration: Collaboration,
    actor: audit.Actor,
    reason: str,
    note: str | None = None,
) -> Collaboration:
    """Clore sans mettre le dossier au débit de personne. **Arbitrage seul.**

    La quatrième issue, et la seule qui n'accuse pas. Trois refus pour le
    **même** motif ne disent pas qu'une créatrice est de mauvaise foi : ils
    disent que la demande n'a jamais été comprise, et que la liste fermée de
    motifs n'a pas su la porter. Trois motifs différents disent l'inverse — et
    c'est `unfulfilled` qui les tranche.

    Refuser punirait quelqu'un pour un défaut du produit ; approuver ferait
    payer au salon une publication qu'il n'a pas eue. Le dossier se ferme, le
    salon garde la prestation telle qu'elle a été donnée, et **aucun événement
    de fiabilité n'est écrit** — ni positif ni négatif. C'est
    `EVENEMENTS_PAR_ISSUE` qui le garantit, en ne portant pas cette issue.

    Le motif reste obligatoire. Une clôture sans motif est illisible pour les
    deux parties, et celle-ci moins que toute autre : c'est précisément le
    motif qui a échoué qu'il faut nommer, puisque c'est lui qu'on ira corriger.
    """
    return await transitionner(
        session,
        collaboration=collaboration,
        vers=CollaborationStatus.CLOSED_NO_FAULT,
        actor=actor,
        reason=reason,
        note=note,
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


# ---------------------------------------------------------------------------
# Listes
#
# Deux files, deux publics, un seul chargement de colonnes. Le commerce voit
# les contreparties de **son** commerce et rien d'autre : l'isolation ne repose
# pas sur un filtre écrit dans le routeur mais sur le `business_id` reçu du
# résolveur d'appartenance, qui l'a déjà vérifié.
# ---------------------------------------------------------------------------


class FiltreDeContrepartie(StrEnum):
    """Les trois onglets du commerce.

    Ce ne sont pas des statuts mais des attentes : ce qui attend le commerce,
    ce qui attend la créatrice, ce qui est réglé. Exposer les six statuts
    aurait demandé au commerçant de savoir ce que veut dire `under_review`.

    Le filtre reste facultatif. Sans lui, la liste rend tout — sinon
    `unfulfilled` ne serait joignable par aucun onglet et disparaîtrait de
    l'interface sans disparaître de la base.
    """

    #: Une preuve est arrivée, le commerce doit la contrôler.
    A_CONTROLER = "to_review"
    #: La créatrice doit publier, ou republier. Rien à faire ici.
    ATTENDUE = "expected"
    #: Réglé.
    APPROUVEE = "approved"


def statuts_a_controler() -> frozenset[CollaborationStatus]:
    """Ce qui attend une décision du commerce.

    Exposé pour la pastille du troisième onglet, qui compte la même chose que
    ce que l'onglet montre. Recopier les deux statuts là-bas ferait deux
    définitions d'une même file, et c'est la pastille qui mentirait — un chiffre
    qui n'ouvre pas sur ce qu'il annonce use la confiance plus vite qu'un
    chiffre absent.
    """
    return _STATUTS_DU_FILTRE[FiltreDeContrepartie.A_CONTROLER]


_STATUTS_DU_FILTRE: dict[FiltreDeContrepartie, frozenset[CollaborationStatus]] = {
    FiltreDeContrepartie.A_CONTROLER: frozenset(
        {CollaborationStatus.SUBMITTED, CollaborationStatus.UNDER_REVIEW}
    ),
    FiltreDeContrepartie.ATTENDUE: frozenset(
        {CollaborationStatus.PENDING, CollaborationStatus.RESUBMIT_REQUESTED}
    ),
    FiltreDeContrepartie.APPROUVEE: frozenset({CollaborationStatus.APPROVED}),
}


@dataclass(frozen=True, slots=True)
class DerniereSoumission:
    """La preuve la plus récente. Ce que le commerce ouvre pour décider."""

    proof_id: uuid.UUID
    submitted_at: datetime
    capture_method: CaptureMethod
    source_url: str | None
    media_key: str | None
    screenshot_key: str | None
    platform_published_at: datetime | None
    #: Ce que le créateur a écrit en soumettant. C'est la moitié du canal qui
    #: vient d'en bas, et elle se lit au même endroit que la preuve — sinon le
    #: commerce décide en ayant vu l'image sans avoir lu la phrase.
    note: str | None


@dataclass(frozen=True, slots=True)
class Tentative:
    """Une demande de nouvelle soumission, telle que le journal l'a écrite.

    `par` distingue le commerce de l'arbitre : sur un dossier escaladé, savoir
    laquelle des demandes vient de l'administration change la lecture.
    """

    motif: str
    #: Ce que l'auteur a ajouté au code. **Rendu tel quel, jamais traduit** :
    #: c'est du contenu saisi, comme le nom d'un item de catalogue. Le code, à
    #: côté, porte le sens que l'interface sait traduire.
    note: str | None
    demandee_le: datetime
    par: ActorKind


@dataclass(frozen=True, slots=True)
class LigneDeFile:
    collaboration_id: uuid.UUID
    booking_id: uuid.UUID
    status: CollaborationStatus
    required_format: ContentFormat
    required_mention: str | None
    required_geotag: bool
    deadline_at: datetime
    attempts_count: int
    needs_human_review: bool
    created_at: datetime
    business_id: uuid.UUID
    business_name: str
    creator_id: uuid.UUID
    #: Le pseudonyme, jamais l'état civil : un salon n'a aucune raison de
    #: connaître le nom légal de quelqu'un.
    creator_handle: str | None
    #: La créatrice a fermé son compte. Un drapeau, jamais une phrase : le
    #: texte se traduit côté écran. Même raison que sur l'historique — un nom
    #: vide se lit comme un défaut d'affichage, pas comme un départ.
    creator_partie: bool
    platform: Platform
    item_name: str
    #: Chaque demande de nouvelle soumission, dans l'ordre, relue dans le
    #: journal d'audit. Rien n'est stocké ailleurs, et le dupliquer sur la
    #: contrepartie créerait une seconde vérité qu'un UPDATE pourrait faire
    #: diverger du journal — lequel, lui, est immuable.
    #:
    #: **L'historique et non le seul dernier motif.** L'écran d'arbitrage ne
    #: montrait que la dernière demande, alors que c'est la répétition qui
    #: justifie l'escalade : trois fois le même reproche et trois reproches
    #: différents n'appellent pas la même décision.
    tentatives: tuple[Tentative, ...]
    derniere_soumission: DerniereSoumission | None

    @property
    def dernier_motif(self) -> str | None:
        """Le plus récent, dérivé et non stocké en double."""
        return self.tentatives[-1].motif if self.tentatives else None

    @property
    def repetitions_du_dernier_motif(self) -> int:
        """Combien de fois **de suite** le dernier motif a été opposé.

        **De suite, et non en tout.** Un dossier refusé pour la mention, puis
        pour le format, puis de nouveau pour la mention n'est pas un dossier où
        la mention n'a jamais été comprise : c'est un dossier où deux choses
        clochaient. Compter les occurrences rendrait deux, et l'écran
        proposerait de fermer sans faute là où il faut trancher.

        Zéro quand aucun refus n'a eu lieu. Un quand il y en a eu un seul —
        jamais zéro dans ce cas, sans quoi « aucune répétition » et « aucun
        refus » se confondraient.
        """
        if not self.tentatives:
            return 0
        dernier = self.tentatives[-1].motif
        compte = 0
        for tentative in reversed(self.tentatives):
            if tentative.motif != dernier:
                break
            compte += 1
        return compte

    @property
    def meme_motif_repete(self) -> bool:
        """Vrai quand le même motif a été opposé au moins trois fois de suite.

        **Le seuil est celui du produit**, `collaboration_max_attempts` : c'est
        le nombre de tentatives au bout duquel le dossier sort de la boucle
        automatique, donc exactement le moment où un arbitre l'ouvre. Le
        recopier ici en ferait deux, et l'un des deux vieillirait.

        C'est ce drapeau que l'écran d'arbitrage trie : trois fois le même
        reproche appelle « fermer sans faute », trois reproches différents
        appellent une décision.
        """
        return self.repetitions_du_dernier_motif >= get_settings().collaboration_max_attempts


async def derniere_tentative(session, collaboration_id: uuid.UUID) -> Tentative | None:
    """La demande de nouvelle soumission la plus récente, ou rien.

    **Le même journal que la file du commerce, jamais une seconde vérité.**
    `LigneDeFile.dernier_motif` dérive déjà des `tentatives` relues ici ; poser
    le motif sur `collaboration` en colonne créerait une copie qu'un `UPDATE`
    ferait diverger de l'audit — lequel, lui, est immuable. Deux lecteurs, une
    source.

    Le tri est sur `occurred_at`, qui vient de `clock_timestamp()` : deux
    demandes écrites dans la même transaction s'ordonnent, ce que `now()`
    n'aurait pas permis.
    """
    ligne = (
        await session.execute(
            sa.select(AuditLog.reason, AuditLog.note, AuditLog.occurred_at, AuditLog.actor_kind)
            .where(
                AuditLog.entity_type == AuditedEntity.COLLABORATION.value,
                AuditLog.entity_id == collaboration_id,
                AuditLog.to_status == CollaborationStatus.RESUBMIT_REQUESTED.value,
                AuditLog.reason.is_not(None),
            )
            .order_by(AuditLog.occurred_at.desc())
            .limit(1)
        )
    ).first()
    if ligne is None:
        return None
    reason, note, occurred_at, actor_kind = ligne
    return Tentative(motif=reason, note=note, demandee_le=occurred_at, par=actor_kind)


@dataclass(frozen=True, slots=True)
class ContexteDuDossier:
    """De quoi parle la contrepartie, en trois noms.

    Ils vivent sur `booking`, `business`, `catalog_item` et `tier`, et la
    contrepartie n'en porte aucun — ce qui est juste, elle ne doit pas les
    dupliquer. L'écran d'envoi de preuve, lui, en a besoin des trois, et les
    demander en trois routes ferait trois allers-retours pour composer une
    phrase.

    **Le nom du salon est le plus utile des trois** : c'est lui que la créatrice
    recopie dans le lieu de sa publication, et l'exigence de géotag ne veut rien
    dire sans le mot à poser. Le format et la mention étaient servis, le lieu
    ne l'était pas.
    """

    business_name: str
    item_name: str
    platform: Platform


async def contexte_de(session, collaboration_id: uuid.UUID) -> ContexteDuDossier | None:
    """Les trois noms, en une requête.

    Nul si la contrepartie n'existe pas — jamais des chaînes vides : un écran
    qui reçoit « » ne peut pas distinguer un salon sans nom d'un dossier
    introuvable, et les jointures sont obligatoires des deux côtés.
    """
    ligne = (
        await session.execute(
            sa.select(Business.name, CatalogItem.name, Tier.platform)
            .join(Booking, Booking.business_id == Business.id)
            .join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
            .join(Collaboration, Collaboration.booking_id == Booking.id)
            .join(Tier, Tier.id == Collaboration.tier_id)
            .where(Collaboration.id == collaboration_id)
        )
    ).first()
    if ligne is None:
        return None
    business_name, item_name, platform = ligne
    return ContexteDuDossier(business_name=business_name, item_name=item_name, platform=platform)


def _requete_de_file():
    return (
        sa.select(
            Collaboration.id.label("collaboration_id"),
            Collaboration.booking_id,
            Collaboration.status,
            Collaboration.required_format,
            Collaboration.required_mention,
            Collaboration.required_geotag,
            Collaboration.deadline_at,
            Collaboration.attempts_count,
            Collaboration.needs_human_review,
            Collaboration.created_at,
            Business.id.label("business_id"),
            Business.name.label("business_name"),
            CreatorProfile.user_id.label("creator_id"),
            SocialAccount.handle,
            CreatorProfile.anonymized_at,
            Tier.platform,
            CatalogItem.name.label("item_name"),
        )
        .join(Booking, Booking.id == Collaboration.booking_id)
        .join(Business, Business.id == Booking.business_id)
        .join(CreatorProfile, CreatorProfile.user_id == Booking.creator_id)
        .join(SocialAccount, SocialAccount.id == Booking.social_account_id)
        .join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
        .join(Tier, Tier.id == Collaboration.tier_id)
    )


async def _completer(session: AsyncSession, lignes) -> tuple[LigneDeFile, ...]:
    """Motifs et dernières preuves, en deux requêtes et non en 2N.

    Les charger dans la boucle ferait N+1 sur une file qui peut compter des
    centaines de lignes, et le coût n'apparaîtrait qu'en production.
    """
    ids = [ligne.collaboration_id for ligne in lignes]
    if not ids:
        return ()

    dernier = (
        sa.select(
            Proof.collaboration_id,
            sa.func.max(Proof.submitted_at).label("submitted_at"),
        )
        .where(Proof.collaboration_id.in_(ids))
        .group_by(Proof.collaboration_id)
        .subquery()
    )
    preuves = {
        p.collaboration_id: DerniereSoumission(
            proof_id=p.id,
            submitted_at=p.submitted_at,
            capture_method=p.capture_method,
            source_url=p.source_url,
            media_key=p.media_key,
            screenshot_key=p.screenshot_key,
            platform_published_at=p.platform_published_at,
            note=p.note,
        )
        for p in await session.scalars(
            sa.select(Proof).join(
                dernier,
                sa.and_(
                    dernier.c.collaboration_id == Proof.collaboration_id,
                    dernier.c.submitted_at == Proof.submitted_at,
                ),
            )
        )
    }

    # Toutes les demandes de nouvelle soumission, du plus ancien au plus
    # récent. Une approbation n'en porte pas et n'efface donc rien.
    tentatives: dict[uuid.UUID, list[Tentative]] = {}
    for entity_id, reason, note, occurred_at, actor_kind in await session.execute(
        sa.select(
            AuditLog.entity_id,
            AuditLog.reason,
            AuditLog.note,
            AuditLog.occurred_at,
            AuditLog.actor_kind,
        )
        .where(
            AuditLog.entity_type == AuditedEntity.COLLABORATION.value,
            AuditLog.entity_id.in_(ids),
            AuditLog.to_status == CollaborationStatus.RESUBMIT_REQUESTED.value,
            AuditLog.reason.is_not(None),
        )
        .order_by(AuditLog.occurred_at)
    ):
        tentatives.setdefault(entity_id, []).append(
            Tentative(motif=reason, note=note, demandee_le=occurred_at, par=actor_kind)
        )

    return tuple(
        LigneDeFile(
            collaboration_id=ligne.collaboration_id,
            booking_id=ligne.booking_id,
            status=ligne.status,
            required_format=ligne.required_format,
            required_mention=ligne.required_mention,
            required_geotag=ligne.required_geotag,
            deadline_at=ligne.deadline_at,
            attempts_count=ligne.attempts_count,
            needs_human_review=ligne.needs_human_review,
            created_at=ligne.created_at,
            business_id=ligne.business_id,
            business_name=ligne.business_name,
            creator_id=ligne.creator_id,
            creator_handle=ligne.handle,
            creator_partie=ligne.anonymized_at is not None,
            platform=ligne.platform,
            item_name=ligne.item_name,
            tentatives=tuple(tentatives.get(ligne.collaboration_id, ())),
            derniere_soumission=preuves.get(ligne.collaboration_id),
        )
        for ligne in lignes
    )


async def lister_pour_le_commerce(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    filtre: FiltreDeContrepartie | None = None,
    limite: int = 100,
) -> tuple[LigneDeFile, ...]:
    """Triées par échéance : ce qui va tomber en premier se lit en premier."""
    requete = _requete_de_file().where(
        Booking.business_id == business_id,
        *([Collaboration.status.in_(_STATUTS_DU_FILTRE[filtre])] if filtre else []),
    )
    lignes = (
        await session.execute(
            requete.order_by(Collaboration.deadline_at.asc(), Collaboration.id.asc()).limit(
                max(1, min(limite, 500))
            )
        )
    ).all()
    return await _completer(session, lignes)


@dataclass(frozen=True, slots=True)
class MotifQuiRevient:
    """Un motif, et combien de dossiers l'ont vu se répéter.

    **C'est un signal sur nous, pas sur les créatrices.** Un motif opposé trois
    fois de suite sur un dossier dit que la demande n'a pas été comprise ; le
    même motif dans ce cas sur beaucoup de dossiers dit qu'une exigence est mal
    formulée quelque part — dans le libellé du palier, dans la fiche d'un
    salon, ou dans le vocabulaire fermé lui-même.

    Deux nombres et non un : `dossiers` compte ceux où le motif s'est répété
    jusqu'au seuil, `dossiers_touches` tous ceux où il a été opposé au moins
    une fois. Le rapport entre les deux départage un motif difficile d'un motif
    incompréhensible — « la mention manque » sur cent dossiers dont deux
    bouclent n'est pas le même problème que sur douze dossiers dont dix.
    """

    motif: str
    dossiers: int
    dossiers_touches: int


async def motifs_qui_reviennent(session: AsyncSession) -> tuple[MotifQuiRevient, ...]:
    """Les motifs qui se répètent, du plus fréquent au moins fréquent.

    Relu du journal d'audit comme le reste : c'est lui qui porte les demandes de
    nouvelle soumission, et lui seul est immuable.

    La répétition est comptée **de suite**, avec la même règle que
    `LigneDeFile.repetitions_du_dernier_motif` — et par la même lecture, pour
    qu'un chiffre affiché à l'administration ne puisse pas contredire le drapeau
    affiché à l'arbitre. Deux calculs de la même chose finissent par diverger,
    et c'est celui qu'on regarde le moins qui ment le plus longtemps.
    """
    seuil = get_settings().collaboration_max_attempts

    par_dossier: dict[uuid.UUID, list[str]] = {}
    for entity_id, reason in await session.execute(
        sa.select(AuditLog.entity_id, AuditLog.reason)
        .where(
            AuditLog.entity_type == AuditedEntity.COLLABORATION.value,
            AuditLog.to_status == CollaborationStatus.RESUBMIT_REQUESTED.value,
            AuditLog.reason.is_not(None),
        )
        .order_by(AuditLog.occurred_at)
    ):
        par_dossier.setdefault(entity_id, []).append(reason)

    boucles: dict[str, int] = {}
    touches: dict[str, set[uuid.UUID]] = {}
    for dossier, motifs in par_dossier.items():
        for motif in set(motifs):
            touches.setdefault(motif, set()).add(dossier)

        # La plus longue suite d'un même motif, sur ce dossier. On compte le
        # dossier une fois : c'est un dossier qui boucle, pas trois refus.
        courant, longueur = None, 0
        for motif in motifs:
            longueur = longueur + 1 if motif == courant else 1
            courant = motif
            if longueur == seuil:
                boucles[motif] = boucles.get(motif, 0) + 1

    return tuple(
        sorted(
            (
                MotifQuiRevient(
                    motif=motif,
                    dossiers=nombre,
                    dossiers_touches=len(touches.get(motif, ())),
                )
                for motif, nombre in boucles.items()
            ),
            key=lambda ligne: (-ligne.dossiers, ligne.motif),
        )
    )


async def file_de_revue_humaine(
    session: AsyncSession, *, limite: int = 100
) -> tuple[LigneDeFile, ...]:
    """Les dossiers sortis de la boucle automatique, en attente d'arbitrage.

    Une contrepartie déjà approuvée n'y figure plus : le drapeau reste levé sur
    la ligne — c'est une trace, elle ne s'efface pas — mais un dossier tranché
    n'est plus à trancher, et le laisser en file ferait grossir une pile qui ne
    descend jamais.
    """
    requete = _requete_de_file().where(
        Collaboration.needs_human_review.is_(True),
        Collaboration.status.not_in(
            (CollaborationStatus.APPROVED, CollaborationStatus.UNFULFILLED)
        ),
    )
    lignes = (
        await session.execute(
            requete.order_by(Collaboration.deadline_at.asc(), Collaboration.id.asc()).limit(
                max(1, min(limite, 500))
            )
        )
    ).all()
    return await _completer(session, lignes)
