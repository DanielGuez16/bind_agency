"""Qui reçoit une notification, et qui n'en reçoit jamais.

**Trois filtres avant d'envoyer, et l'ordre compte.** Le compte d'abord — un
compte suspendu ou anonymisé ne reçoit rien, quelles que soient ses préférences
et ses terminaux. La préférence ensuite. Les jetons actifs en dernier. Mettre
le compte en dernier reviendrait à interroger les préférences de quelqu'un dont
on n'a pas le droit de se soucier.

**Un compte anonymisé n'a pas d'adresse et n'a pas de terminal.** La procédure
d'anonymisation efface l'email et révoque les jetons sociaux ; les jetons de
terminal suivent la même règle, et le filtre ici est la ceinture qui double la
bretelle. Les deux existent parce que l'un est une transition ponctuelle et
l'autre une garantie permanente : la première peut être oubliée sur un chemin
nouveau, la seconde vaut sur tous.

**Une préférence absente vaut « oui ».** La table ne porte que les refus
explicites, et c'est ici qu'on l'interprète. Écrire sept lignes par personne à
l'inscription en ferait sept dont personne ne changera jamais aucune.

**Un jeton mort se révoque au moment où on l'apprend.** C'est la seule occasion
qu'on ait : le fournisseur ne prévient pas d'avance, il répond au moment où
l'on essaie de s'en servir. Ne pas le faire laisserait la table grossir de
terminaux morts qu'on retenterait à chaque événement, jusqu'à ce qu'Expo nous
limite.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import translate
from app.integrations.push import Envoi, PushSender, Verdict
from app.models import DeviceToken, NotificationPreference, User
from app.models.enums import (
    DevicePlatform,
    DeviceTokenStatus,
    Locale,
    NotificationKind,
    UserStatus,
)

#: Les statuts qui reçoivent. Écrit en positif : une liste de ce qu'on exclut
#: laisserait passer tout statut ajouté plus tard, ce qui est exactement le
#: sens inverse de la garantie voulue.
STATUTS_JOIGNABLES = frozenset({UserStatus.ACTIVE})


@dataclass(frozen=True, slots=True)
class Destinataire:
    user_id: uuid.UUID
    locale: Locale
    tokens: tuple[str, ...]


async def enregistrer_un_terminal(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    token: str,
    platform: DevicePlatform,
) -> DeviceToken:
    """Inscrit ou réactive un terminal. Idempotent.

    **Le jeton peut changer de main.** Un téléphone prêté puis reconnecté sous
    un autre compte porte le même jeton ; sans reprise, les deux comptes
    recevraient les notifications de l'autre. Le conflit sur le jeton réattribue
    donc la ligne au dernier qui s'est présenté.

    Réactive aussi un jeton révoqué : quelqu'un qui rouvre l'application après
    l'avoir désinstallée redemande à être joint, et lui refuser demanderait de
    désinstaller à nouveau pour y arriver.
    """
    maintenant = datetime.now(UTC)
    resultat = await session.execute(
        pg_insert(DeviceToken)
        .values(
            user_id=user_id,
            token=token,
            platform=platform,
            status=DeviceTokenStatus.ACTIVE,
            last_seen_at=maintenant,
        )
        .on_conflict_do_update(
            index_elements=["token"],
            set_={
                "user_id": user_id,
                "platform": platform,
                "status": DeviceTokenStatus.ACTIVE,
                "last_seen_at": maintenant,
                "revoked_at": None,
            },
        )
        .returning(DeviceToken)
    )
    return resultat.scalar_one()


async def revoquer_un_terminal(session: AsyncSession, *, user_id: uuid.UUID, token: str) -> bool:
    """Révoque **son** terminal. Rend faux si le jeton n'était pas le sien.

    L'appartenance est vérifiée ici plutôt qu'au-dessus : sans elle, connaître
    un jeton suffirait à couper les notifications de quelqu'un d'autre.
    """
    resultat = await session.execute(
        sa.update(DeviceToken)
        .where(
            DeviceToken.token == token,
            DeviceToken.user_id == user_id,
            DeviceToken.status == DeviceTokenStatus.ACTIVE,
        )
        .values(status=DeviceTokenStatus.REVOKED, revoked_at=datetime.now(UTC))
    )
    return bool(resultat.rowcount)


async def revoquer_les_terminaux(session: AsyncSession, *, user_id: uuid.UUID) -> int:
    """Tous ceux d'une personne. Appelé par l'anonymisation.

    Les jetons sociaux sont révoqués là-bas ; ceux des terminaux le sont pour
    la même raison, et par le même geste.
    """
    resultat = await session.execute(
        sa.update(DeviceToken)
        .where(DeviceToken.user_id == user_id, DeviceToken.status == DeviceTokenStatus.ACTIVE)
        .values(status=DeviceTokenStatus.REVOKED, revoked_at=datetime.now(UTC))
    )
    return resultat.rowcount or 0


async def preferences(session: AsyncSession, *, user_id: uuid.UUID) -> dict[NotificationKind, bool]:
    """Les sept genres et leur état, complétés par « oui ».

    Rendus tous les sept plutôt que les seules lignes stockées : un écran de
    réglages doit pouvoir se dessiner sans connaître la liste, et il ne doit
    pas déduire d'une absence que le genre n'existe pas.
    """
    refus = {
        ligne.kind: ligne.enabled
        for ligne in await session.scalars(
            sa.select(NotificationPreference).where(NotificationPreference.user_id == user_id)
        )
    }
    return {genre: refus.get(genre, True) for genre in NotificationKind}


async def regler(
    session: AsyncSession, *, user_id: uuid.UUID, kind: NotificationKind, enabled: bool
) -> None:
    """Pose une préférence. Écrit aussi les « oui » explicites.

    On pourrait n'écrire que les refus et supprimer la ligne au retour à
    « oui ». On ne le fait pas : l'écrit dit « cette personne a regardé ce
    réglage », ce qu'une absence ne dit pas, et c'est utile le jour où l'on
    ajoute un genre — on saura qui n'a jamais rien décidé.
    """
    await session.execute(
        pg_insert(NotificationPreference)
        .values(user_id=user_id, kind=kind, enabled=enabled, updated_at=datetime.now(UTC))
        .on_conflict_do_update(
            index_elements=["user_id", "kind"],
            set_={"enabled": enabled, "updated_at": datetime.now(UTC)},
        )
    )


async def destinataire(
    session: AsyncSession, *, user_id: uuid.UUID, kind: NotificationKind
) -> Destinataire | None:
    """Où joindre quelqu'un pour ce genre — ou `None`, et le silence.

    Les trois filtres, dans l'ordre qui compte : le compte, la préférence, les
    jetons. Rend `None` dès le premier qui ferme, sans interroger les suivants.
    """
    utilisateur = await session.get(User, user_id)
    if utilisateur is None or utilisateur.status not in STATUTS_JOIGNABLES:
        # Suspendu ou anonymisé. **Aucune notification, jamais** : ni ses
        # préférences ni ses terminaux n'ont à être consultés.
        return None

    refus = await session.scalar(
        sa.select(NotificationPreference.enabled).where(
            NotificationPreference.user_id == user_id, NotificationPreference.kind == kind
        )
    )
    if refus is False:
        return None

    tokens = tuple(
        await session.scalars(
            sa.select(DeviceToken.token).where(
                DeviceToken.user_id == user_id,
                DeviceToken.status == DeviceTokenStatus.ACTIVE,
            )
        )
    )
    if not tokens:
        return None

    return Destinataire(user_id=user_id, locale=utilisateur.locale, tokens=tokens)


async def envoyer(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: NotificationKind,
    sender: PushSender,
    cle: str,
    donnees: dict[str, str] | None = None,
    **valeurs: object,
) -> bool:
    """Compose et envoie. Rend faux quand il n'y avait rien à envoyer.

    **Le gabarit vient des catalogues du serveur**, comme les emails, et dans la
    langue du destinataire. Les mêmes clés servent aux deux : un titre de
    notification et un sujet d'email disent la même chose, et en écrire deux
    versions les ferait diverger au premier mot changé.

    Les jetons que le fournisseur déclare morts sont révoqués ici. C'est la
    seule occasion qu'on ait de l'apprendre.
    """
    cible = await destinataire(session, user_id=user_id, kind=kind)
    if cible is None:
        return False

    titre = translate(f"{cle}.subject", locale=cible.locale, **valeurs)
    corps = translate(f"{cle}.body", locale=cible.locale, **valeurs)

    envois = [
        Envoi(token=token, titre=titre, corps=corps, donnees=donnees or {})
        for token in cible.tokens
    ]
    verdicts = await sender.envoyer(envois)

    morts = [
        envoi.token
        for envoi, verdict in zip(envois, verdicts, strict=False)
        if verdict is Verdict.JETON_INVALIDE
    ]
    if morts:
        await session.execute(
            sa.update(DeviceToken)
            .where(DeviceToken.token.in_(morts))
            .values(status=DeviceTokenStatus.REVOKED, revoked_at=datetime.now(UTC))
        )

    return any(verdict is Verdict.ENVOYE for verdict in verdicts)


# --------------------------------------------------------------------------
# les sept événements
# --------------------------------------------------------------------------
#
# Chaque envoi est **appelé à côté de l'email**, jamais à sa place et jamais
# dans une seconde détection d'événement. Détecter deux fois « le salon a
# accepté » ferait deux vérités qui divergeraient à la première branche
# ajoutée — et c'est la branche oubliée qui laisse quelqu'un sans nouvelle.


async def pour_la_reservation(
    session: AsyncSession,
    *,
    booking_id: uuid.UUID,
    kind: NotificationKind,
    cle: str,
    sender: PushSender,
    **valeurs: object,
) -> bool:
    """Prévient le créateur d'une réservation.

    Les valeurs du gabarit sont celles de l'email : le nom du salon et celui de
    la prestation. Ni heure, ni code, ni adresse — une notification s'affiche
    sur un écran verrouillé.
    """
    from app.models import Booking, Business, CatalogItem

    ligne = (
        await session.execute(
            sa.select(Booking.creator_id, Business.name, CatalogItem.name)
            .select_from(Booking)
            .join(Business, Business.id == Booking.business_id)
            .join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
            .where(Booking.id == booking_id)
        )
    ).one_or_none()
    if ligne is None:
        return False

    creator_id, salon, item = ligne
    return await envoyer(
        session,
        user_id=creator_id,
        kind=kind,
        sender=sender,
        cle=cle,
        donnees={"booking_id": str(booking_id)},
        business=salon,
        item=item,
        **valeurs,
    )


async def pour_la_contrepartie(
    session: AsyncSession,
    *,
    collaboration_id: uuid.UUID,
    kind: NotificationKind,
    cle: str,
    sender: PushSender,
    **valeurs: object,
) -> bool:
    """Prévient le créateur d'une contrepartie."""
    from app.models import Booking, Business, CatalogItem, Collaboration

    ligne = (
        await session.execute(
            sa.select(Booking.creator_id, Business.name, CatalogItem.name)
            .select_from(Collaboration)
            .join(Booking, Booking.id == Collaboration.booking_id)
            .join(Business, Business.id == Booking.business_id)
            .join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
            .where(Collaboration.id == collaboration_id)
        )
    ).one_or_none()
    if ligne is None:
        return False

    creator_id, salon, item = ligne
    return await envoyer(
        session,
        user_id=creator_id,
        kind=kind,
        sender=sender,
        cle=cle,
        donnees={"collaboration_id": str(collaboration_id)},
        business=salon,
        item=item,
        **valeurs,
    )


async def pour_le_commerce(
    session: AsyncSession,
    *,
    booking_id: uuid.UUID,
    kind: NotificationKind,
    cle: str,
    sender: PushSender,
    **valeurs: object,
) -> int:
    """Prévient **tous les membres** du salon. Rend combien ont été joints.

    Tous, et non le propriétaire seul : un comptoir se tient à plusieurs, et la
    personne qui a créé le compte n'est pas forcément celle qui est là. Chacun
    garde sa préférence — celui qui coupe ne coupe que pour lui.

    C'est la seule notification qui remonte vers le commerce, et elle manquait
    le plus : un salon ne savait qu'une réservation attendait sa décision qu'en
    ouvrant l'application.
    """
    from app.models import Booking, BusinessMember, CatalogItem

    ligne = (
        await session.execute(
            sa.select(Booking.business_id, CatalogItem.name)
            .select_from(Booking)
            .join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
            .where(Booking.id == booking_id)
        )
    ).one_or_none()
    if ligne is None:
        return 0

    business_id, item = ligne
    membres = await session.scalars(
        sa.select(BusinessMember.user_id).where(BusinessMember.business_id == business_id)
    )

    joints = 0
    for user_id in membres:
        if await envoyer(
            session,
            user_id=user_id,
            kind=kind,
            sender=sender,
            cle=cle,
            donnees={"booking_id": str(booking_id)},
            item=item,
            **valeurs,
        ):
            joints += 1
    return joints


async def pour_le_commerce_seul(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    kind: NotificationKind,
    cle: str,
    sender: PushSender,
    **valeurs: object,
) -> int:
    """Prévient tous les membres d'un salon d'un fait qui ne parle d'aucune
    réservation. Rend combien ont été joints.

    Distinct de `pour_le_commerce`, qui part d'une réservation et nomme l'item :
    la fin d'une période d'essai ne se rattache à rien de ce genre. Les faire
    passer par la même fonction aurait demandé de fabriquer une réservation qui
    n'a pas lieu d'être.
    """
    from app.models import BusinessMember

    membres = await session.scalars(
        sa.select(BusinessMember.user_id).where(BusinessMember.business_id == business_id)
    )

    joints = 0
    for user_id in membres:
        if await envoyer(
            session,
            user_id=user_id,
            kind=kind,
            sender=sender,
            cle=cle,
            donnees={"business_id": str(business_id)},
            **valeurs,
        ):
            joints += 1
    return joints
