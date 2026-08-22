"""Emails transactionnels : quoi envoyer, à qui, dans quelle langue.

**Aucun envoi n'est fait dans la transaction qui l'a déclenché.** Une
notification est mise en file ; le job l'envoie plus tard, avec le report et
l'épuisement de la file. Un service d'envoi injoignable ne doit pas annuler la
contrepartie qu'il devait annoncer — le créateur préfère une contrepartie
correctement ouverte sans email à un email parfait sur une contrepartie qui
n'existe pas.

**La langue est celle du destinataire, pas celle du déclencheur.** Un commerce
hispanophone qui refuse une preuve écrit son motif en espagnol ; le créateur,
lui, reçoit le cadre du message dans sa langue à lui. Le motif reste tel quel :
c'est du contenu saisi, et on ne traduit pas ce qu'un commerce a écrit.

**Les gabarits vivent dans les catalogues**, `app/locales/*.json`, jamais dans
le code, et sont lus par `app.core.i18n` — le module qui existait déjà pour
cela. En écrire un second ici aurait donné deux façons de lire le même fichier,
et c'est la seconde qu'on aurait oublié de corriger.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import translate
from app.integrations.email import Message
from app.models import (
    Booking,
    Business,
    CatalogItem,
    Collaboration,
    CreatorProfile,
    User,
)
from app.models.enums import CollaborationStatus, Locale, NotificationKind, UserStatus

#: La clé du message donne le genre de notification.
#:
#: **Une seule table, pour les deux canaux.** Elle vivait dans le routeur des
#: décisions de réservation, et le chemin du courriel ne la consultait pas :
#: couper une notification sur l'écran la coupait sur le téléphone et la
#: laissait arriver dans la boîte. C'est le pire des deux mondes pour quelqu'un
#: qui a explicitement demandé le silence — il croit avoir coupé, et il n'a
#: coupé qu'à moitié.
#:
#: **Une clé absente lève.** Un message dont on ne sait pas le genre est un
#: message dont on ne sait pas s'il a été refusé : l'envoyer « au cas où »
#: rétablirait exactement le défaut qu'on répare. Ajouter un message oblige
#: donc à dire quelle préférence le commande.
GENRE_PAR_CLE: dict[str, NotificationKind] = {
    "account.verification": NotificationKind.ACCOUNT_VERIFICATION,
    "booking.approved": NotificationKind.BOOKING_APPROVED,
    "booking.declined": NotificationKind.BOOKING_DECLINED,
    "booking.cancelledByBusiness": NotificationKind.BOOKING_CANCELLED_BY_BUSINESS,
    "booking.toReview": NotificationKind.BOOKING_TO_REVIEW,
    "collaboration.reminder": NotificationKind.PUBLICATION_REMINDER,
    "collaboration.approved": NotificationKind.PUBLICATION_APPROVED,
    "collaboration.resubmit": NotificationKind.PUBLICATION_RESUBMIT,
    "collaboration.opened": NotificationKind.COLLABORATION_OPENED,
    "collaboration.unfulfilled": NotificationKind.COLLABORATION_UNFULFILLED,
    # **Le même genre que la non-honoration, et non un genre à part.** Les deux
    # ferment un dossier et demandent la même chose au destinataire : cesser
    # d'attendre. Un genre de plus lui offrirait de couper l'un et pas l'autre,
    # ce qui n'a aucun sens — et surtout, celui qu'il couperait serait la bonne
    # nouvelle des deux.
    "collaboration.closed_no_fault": NotificationKind.COLLABORATION_UNFULFILLED,
    "subscription.graceEnding": NotificationKind.SUBSCRIPTION_GRACE_ENDING,
    "subscription.ended": NotificationKind.SUBSCRIPTION_ENDED,
    "support.accessOpened": NotificationKind.SUPPORT_ACCESS_STARTED,
}


def genre_de(cle: str) -> NotificationKind:
    """Le genre que cette clé commande. Lève si la clé n'en déclare aucun."""
    try:
        return GENRE_PAR_CLE[cle]
    except KeyError as absente:
        raise KeyError(
            f"aucun genre de notification déclaré pour « {cle} » : "
            "un message dont la préférence n'est pas nommée ne s'envoie pas"
        ) from absente


async def joignable(session: AsyncSession, *, user_id: uuid.UUID, kind: NotificationKind) -> bool:
    """Peut-on écrire à cette personne ?

    **Une seule règle depuis que le réglage par genre a été retiré.** Un compte
    suspendu ou anonymisé ne reçoit rien, jamais. Il n'y a plus de genre refusé :
    tout ce que le produit a à dire, il le dit.

    `kind` demeure dans la signature. Ce n'est pas un vestige : la boîte d'envoi
    appelle cette fonction avec le genre de chaque ligne, et le jour où une
    règle dépendra du genre — un plafond, une fenêtre horaire — c'est ici
    qu'elle vivra. Le retirer obligerait à retoucher tous les appelants pour le
    remettre.
    """
    utilisateur = await session.get(User, user_id)
    return utilisateur is not None and utilisateur.status is UserStatus.ACTIVE


def rendre(cle: str, locale: Locale, **valeurs: Any) -> str:
    """Le gabarit, rempli, par le catalogue serveur.

    Une clé absente lève : un email dont le sujet serait
    `collaboration.opened.subject` est pire qu'un email non envoyé.
    """
    return translate(cle, locale=locale, **valeurs)


@dataclass(frozen=True, slots=True)
class Contexte:
    """Ce qu'un email de contrepartie a besoin de nommer.

    Les quatre premiers champs viennent de la réservation et servent aussi aux
    messages qui ne parlent pas de contrepartie — un refus, un désistement. Les
    trois derniers n'ont de sens que pour une contrepartie, et restent vides
    ailleurs plutôt que d'être inventés.
    """

    destinataire: str
    #: Qui reçoit. **Nécessaire pour lire sa préférence** : l'adresse ne suffit
    #: pas à retrouver le compte, et c'est ce trou-là qui laissait passer des
    #: messages refusés.
    user_id: uuid.UUID
    locale: Locale
    creator: str
    business: str
    item: str
    #: Le rendez-vous, dans le fuseau du commerce. Vide sur un item sans créneau.
    quand: str = ""
    format: str = ""
    deadline: str = ""
    requirements: str = ""
    #: Ce que le commerce a écrit. Recopié tel quel, jamais reformulé.
    motif: str = ""


async def contexte_de_reservation(
    session: AsyncSession, booking: Booking, *, motif: str = ""
) -> Contexte | None:
    """Ce qu'il faut dire d'une réservation, sans passer par une contrepartie.

    Écrit à part parce que les messages du commerce — accord, refus,
    désistement — arrivent **avant** qu'une contrepartie existe. Les faire
    passer par elle aurait demandé d'en fabriquer une qui n'a pas lieu d'être.
    """
    ligne = (
        await session.execute(
            sa.select(User, CreatorProfile, Business, CatalogItem)
            .select_from(Booking)
            .join(User, User.id == Booking.creator_id)
            .join(CreatorProfile, CreatorProfile.user_id == Booking.creator_id)
            .join(Business, Business.id == Booking.business_id)
            .join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
            .where(Booking.id == booking.id)
        )
    ).one_or_none()

    if ligne is None:
        return None
    user, profil, business, item = ligne
    if not user.email:
        return None

    return Contexte(
        destinataire=user.email,
        user_id=user.id,
        locale=user.locale,
        creator=profil.first_name or "",
        business=business.name,
        item=item.name,
        # Sur un item sans créneau il n'y a pas d'heure : une chaîne vide plutôt
        # qu'une date inventée, et c'est le gabarit qui décide de l'écrire.
        quand=_lisible(booking.starts_at, business.timezone) if booking.starts_at else "",
        motif=motif,
    )


async def contexte_de(session: AsyncSession, collaboration: Collaboration) -> Contexte | None:
    """Rassemble ce qu'il faut dire. Rend `None` si le destinataire n'a plus
    d'adresse — un compte anonymisé n'a pas à recevoir d'email."""
    ligne = (
        await session.execute(
            sa.select(User, CreatorProfile, Business, CatalogItem)
            .select_from(Collaboration)
            .join(Booking, Booking.id == Collaboration.booking_id)
            .join(User, User.id == Booking.creator_id)
            .join(CreatorProfile, CreatorProfile.user_id == Booking.creator_id)
            .join(Business, Business.id == Booking.business_id)
            .join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
            .where(Collaboration.id == collaboration.id)
        )
    ).one_or_none()

    if ligne is None:
        return None
    user, profil, business, item = ligne
    if not user.email:
        return None

    exigences = []
    if collaboration.required_mention:
        exigences.append(
            rendre(
                "collaboration.requirements.mention",
                user.locale,
                mention=collaboration.required_mention,
            )
        )
    if collaboration.required_geotag:
        exigences.append(rendre("collaboration.requirements.geotag", user.locale))

    return Contexte(
        destinataire=user.email,
        user_id=user.id,
        locale=user.locale,
        creator=profil.first_name or "",
        business=business.name,
        item=item.name,
        format=collaboration.required_format.value,
        # Converti dans le fuseau du commerce : une échéance affichée en UTC à
        # quelqu'un qui vit à Miami se lit à quatre heures près.
        deadline=_lisible(collaboration.deadline_at, business.timezone),
        requirements="\n".join(exigences),
    )


def _lisible(instant: datetime, fuseau: str) -> str:
    return instant.astimezone(ZoneInfo(fuseau)).strftime("%Y-%m-%d %H:%M")


def valeurs_du_gabarit(locale: Locale, valeurs: dict[str, Any]) -> dict[str, Any]:
    """Les valeurs qu'un gabarit attend, complétées de ce qui se déduit.

    **Partagée avec la boîte d'envoi**, qui rend le même message des heures plus
    tard à partir de valeurs stockées. Écrite deux fois, elle aurait divergé sur
    `quand_phrase` — et un gabarit se serait mis à afficher « le » suivi du
    vide.

    Les défauts vides comptent : un message déposé sans `motif` ne doit pas
    faire échouer son rendu au milieu d'un balayage, deux jours après que la
    décision a été prise.
    """
    quand = str(valeurs.get("quand") or "")
    return {
        "creator": "",
        "business": "",
        "item": "",
        "format": "",
        "deadline": "",
        "requirements": "",
        "motif": "",
        "quand": "",
        **valeurs,
        # Le rendez-vous devient une **phrase**, ou rien.
        "quand_phrase": rendre("booking.when", locale, quand=quand) if quand else "",
    }


def composer(cle: str, contexte: Contexte, **extra: Any) -> Message:
    valeurs = {
        "creator": contexte.creator,
        "business": contexte.business,
        "item": contexte.item,
        "format": contexte.format,
        "deadline": contexte.deadline,
        "requirements": contexte.requirements,
        "quand": contexte.quand,
        "motif": contexte.motif,
        **extra,
    }
    complet = valeurs_du_gabarit(contexte.locale, valeurs)
    return Message(
        destinataire=contexte.destinataire,
        sujet=rendre(f"{cle}.subject", contexte.locale, **complet),
        corps=rendre(f"{cle}.body", contexte.locale, **complet),
        locale=contexte.locale,
    )


async def echeances_a_rappeler(
    session: AsyncSession, *, avance_secondes: int, limite: int = 200
) -> list[uuid.UUID]:
    """Contreparties dont l'échéance approche et qui n'ont encore rien rendu.

    `submitted` et les états clos en sont exclus : rappeler à quelqu'un qui a
    déjà répondu le ferait douter de ce qu'il a envoyé.
    """
    limite_haute = datetime.now(UTC) + timedelta(seconds=avance_secondes)
    return list(
        await session.scalars(
            sa.select(Collaboration.id)
            .where(
                Collaboration.status.in_(
                    (CollaborationStatus.PENDING, CollaborationStatus.RESUBMIT_REQUESTED)
                ),
                Collaboration.deadline_at > sa.func.clock_timestamp(),
                Collaboration.deadline_at <= limite_haute,
            )
            .order_by(Collaboration.deadline_at)
            .limit(limite)
        )
    )
