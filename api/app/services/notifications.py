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
from app.integrations.email import EmailSender, Message
from app.models import Booking, Business, CatalogItem, Collaboration, CreatorProfile, User
from app.models.enums import CollaborationStatus, Locale


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


def composer(cle: str, contexte: Contexte, **extra: Any) -> Message:
    valeurs = {
        "creator": contexte.creator,
        "business": contexte.business,
        "item": contexte.item,
        "format": contexte.format,
        "deadline": contexte.deadline,
        "requirements": contexte.requirements,
        "quand": contexte.quand,
        # Le rendez-vous devient une **phrase**, ou rien. Un item sans créneau
        # n'a pas d'heure : coller « le  » suivi du vide se remarque, et
        # écrire deux gabarits par message pour cette seule différence les
        # ferait diverger au premier mot changé.
        "quand_phrase": (
            rendre("booking.when", contexte.locale, quand=contexte.quand) if contexte.quand else ""
        ),
        "motif": contexte.motif,
        **extra,
    }
    return Message(
        destinataire=contexte.destinataire,
        sujet=rendre(f"{cle}.subject", contexte.locale, **valeurs),
        corps=rendre(f"{cle}.body", contexte.locale, **valeurs),
        locale=contexte.locale,
    )


async def envoyer_pour_la_reservation(
    session: AsyncSession,
    *,
    booking: Booking,
    cle: str,
    sender: EmailSender,
    motif: str = "",
    **extra: Any,
) -> bool:
    """Prévient le créateur d'une décision du commerce. Faux s'il n'y a rien à
    envoyer — un compte anonymisé n'a pas d'adresse."""
    contexte = await contexte_de_reservation(session, booking, motif=motif)
    if contexte is None:
        return False

    await sender.envoyer(composer(cle, contexte, **extra))
    return True


async def envoyer_pour(
    session: AsyncSession,
    *,
    collaboration: Collaboration,
    cle: str,
    sender: EmailSender,
    **extra: Any,
) -> bool:
    """Compose et envoie. Rend faux quand il n'y avait rien à envoyer.

    Les erreurs d'envoi remontent : c'est au job de les reporter, pas à ce
    module de les avaler. Une erreur avalée ici ferait croire à un envoi.
    """
    contexte = await contexte_de(session, collaboration)
    if contexte is None:
        return False

    await sender.envoyer(composer(cle, contexte, **extra))
    return True


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
