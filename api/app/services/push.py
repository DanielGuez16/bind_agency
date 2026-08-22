"""Le push : les terminaux, les préférences, et l'envoi.

**Ce module n'attrape plus les événements.** Il l'a fait : chaque décision
appelait ici, à côté d'un envoi de courriel, avec le risque permanent qu'une
branche oublie l'un des deux. Les événements déposent maintenant dans la boîte
d'envoi, qui sort les deux canaux du même dépôt — il n'y a plus qu'un endroit
où un message peut être oublié, et c'est celui-là qu'on regarde.

Ce qui reste ici : enregistrer un terminal, le révoquer, lire et régler les
préférences.
Qui reçoit une notification, et qui n'en reçoit jamais.

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
from app.models import DeviceToken, User
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


async def lister_les_terminaux(
    session: AsyncSession, *, user_id: uuid.UUID
) -> tuple[DeviceToken, ...]:
    """Les terminaux d'une personne, le plus récemment vu en tête.

    **Sans elle, on ne coupe que l'appareil qu'on tient.** La révocation exige
    de désigner un terminal, et depuis un autre appareil on n'avait aucun moyen
    d'énumérer les siens : couper celui qu'on a en main est un confort, couper
    celui qu'on a perdu est la raison d'être de la fonction.

    Les révoqués restent dans la liste : « cet appareil ne reçoit plus rien »
    est une réponse, et le faire disparaître laisserait croire qu'on a oublié
    de le couper.

    **Le jeton n'en fait pas partie**, et c'est délibéré : un identifiant
    opaque suffit à désigner, et rendre les jetons de tous les appareils d'un
    compte sur une seule réponse créerait une cible qui n'existait pas.
    """
    return tuple(
        await session.scalars(
            sa.select(DeviceToken)
            .where(DeviceToken.user_id == user_id)
            .order_by(DeviceToken.last_seen_at.desc(), DeviceToken.id)
        )
    )


async def revoquer_un_terminal(
    session: AsyncSession, *, user_id: uuid.UUID, device_id: uuid.UUID
) -> bool:
    """Révoque **son** terminal, par son identifiant. Faux s'il n'était pas le sien.

    **Par l'identifiant et non par le jeton.** Le jeton est un secret : le faire
    voyager dans une URL le dépose dans les journaux du serveur, ceux du
    mandataire et l'historique du client, pour désigner un objet qui a déjà un
    nom. Et surtout, on ne l'a pas — c'est tout le problème du téléphone perdu.

    L'appartenance est vérifiée ici plutôt qu'au-dessus : sans elle, connaître
    un identifiant suffirait à couper les notifications de quelqu'un d'autre.
    """
    resultat = await session.execute(
        sa.update(DeviceToken)
        .where(
            DeviceToken.id == device_id,
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


async def destinataire(
    session: AsyncSession, *, user_id: uuid.UUID, kind: NotificationKind
) -> Destinataire | None:
    """Où joindre quelqu'un pour ce genre — ou `None`, et le silence.

    **Deux filtres, et non trois.** Le réglage par genre a été retiré : tout ce
    que le produit a à dire, il le dit. Restent le compte et les jetons, qui ne
    sont pas des préférences mais des faits — un compte suspendu n'a personne au
    bout, un compte sans terminal n'a nulle part où recevoir.

    `kind` demeure dans la signature : les sept genres restent, ils portent le
    gabarit et la langue. C'est le **réglage** qui part, pas le genre.
    """
    utilisateur = await session.get(User, user_id)
    if utilisateur is None or utilisateur.status not in STATUTS_JOIGNABLES:
        # Suspendu ou anonymisé. **Aucune notification, jamais** : ses terminaux
        # n'ont même pas à être consultés.
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
