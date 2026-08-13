"""Déposer un message, et le sortir de la boîte.

**Deux gestes, deux moments.** `deposer` s'appelle dans la transaction de
l'événement — la décision et son annonce sont écrites ensemble, ou aucune des
deux. `vider` s'appelle depuis le travail de fond, qui a tout son temps.

**La préférence se relit à l'envoi, pas au dépôt.** Quelqu'un qui coupe une
notification entre les deux doit être entendu : c'est le moment où le message
arriverait qui compte, pas celui où on a décidé de l'écrire.

**Trois issues, et pas deux.** Parti, écarté, ou à réessayer. La deuxième est
celle qu'on oublie : un compte suspendu, un genre refusé, aucun terminal
enregistré — ce ne sont ni des succès ni des échecs. Les compter comme des
échecs ferait marteler ; comme des succès, ferait croire que quelqu'un a reçu.

**Le report est celui des jobs, et pour la même raison.** Un service d'envoi qui
tombe ne doit pas être martelé, et un message qui n'a jamais pu partir après
plusieurs tentatives doit cesser d'occuper la boîte plutôt que d'y tourner.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.email import EmailError, EmailSender, Message
from app.integrations.push import Envoi, PushSender, Verdict
from app.models import DeviceToken, OutboundMessage, User
from app.models.enums import (
    DeviceTokenStatus,
    MessageChannel,
    NotificationKind,
    UserStatus,
)
from app.services import jobs as jobs_service
from app.services import notifications

#: Pourquoi un message n'est jamais parti. Nommés, parce qu'on les relira dans
#: une file d'administration : « rien n'est parti » sans raison enverrait
#: chercher une panne là où il n'y a qu'une préférence.
ECARTE_INJOIGNABLE = "compte suspendu, anonymisé, ou genre refusé"
ECARTE_SANS_ADRESSE = "aucune adresse"
ECARTE_SANS_TERMINAL = "aucun terminal actif"
ECARTE_EPUISE = "trop de tentatives"


@dataclass(frozen=True, slots=True)
class Vidage:
    """Ce qu'un passage a fait. Rendu plutôt que journalisé en vrac."""

    envoyes: int
    ecartes: int
    reportes: int


async def deposer(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    cle: str,
    canaux: tuple[MessageChannel, ...] = (MessageChannel.EMAIL, MessageChannel.PUSH),
    **valeurs: object,
) -> tuple[OutboundMessage, ...]:
    """Écrit le message dans la boîte, dans la transaction de l'appelant.

    **Ne commite pas, et n'envoie rien.** L'appelant vient d'écrire une
    décision ; le message part avec elle au même commit. C'est ce qui ferme la
    fenêtre où quelqu'un est refusé sans jamais l'apprendre.

    Le genre vient de la clé, par la même table que les envois directs : un
    message dont la préférence n'est pas nommée ne se dépose pas plus qu'il ne
    s'envoie.
    """
    kind = notifications.genre_de(cle)

    lignes = []
    for canal in canaux:
        ligne = OutboundMessage(
            channel=canal,
            user_id=user_id,
            kind=kind,
            template_key=cle,
            values=dict(valeurs),
        )
        session.add(ligne)
        lignes.append(ligne)

    await session.flush()
    return tuple(lignes)


async def en_attente(
    session: AsyncSession, *, maintenant: datetime | None = None, limite: int = 100
) -> list[OutboundMessage]:
    """Ce qui attend son tour, du plus ancien au plus récent.

    Le plus ancien d'abord : c'est celui qui attend depuis le plus longtemps, et
    une boîte lue dans l'autre sens laisse le premier arrivé au fond.
    """
    instant = maintenant or datetime.now(UTC)
    return list(
        await session.scalars(
            sa.select(OutboundMessage)
            .where(
                OutboundMessage.sent_at.is_(None),
                OutboundMessage.skipped_reason.is_(None),
                OutboundMessage.run_after <= instant,
            )
            .order_by(OutboundMessage.run_after.asc())
            .limit(limite)
        )
    )


async def vider(
    session: AsyncSession,
    *,
    email_sender: EmailSender,
    push_sender: PushSender,
    maintenant: datetime | None = None,
    limite: int = 100,
) -> Vidage:
    """Sort de la boîte ce qui peut en sortir. Rend ce qui a été fait."""
    instant = maintenant or datetime.now(UTC)
    envoyes = ecartes = reportes = 0

    for ligne in await en_attente(session, maintenant=instant, limite=limite):
        if not await notifications.joignable(session, user_id=ligne.user_id, kind=ligne.kind):
            await ecarter(session, ligne, ECARTE_INJOIGNABLE, maintenant=instant)
            ecartes += 1
            continue

        try:
            parti = await _emettre(
                session, ligne, email_sender=email_sender, push_sender=push_sender
            )
        except Exception as echec:  # noqa: BLE001 - le report est la conduite voulue
            await _reporter(session, ligne, echec, maintenant=instant)
            reportes += 1
            continue

        if parti is None:
            ecartes += 1
        elif parti:
            envoyes += 1
        else:
            reportes += 1

    return Vidage(envoyes=envoyes, ecartes=ecartes, reportes=reportes)


async def _emettre(
    session: AsyncSession,
    ligne: OutboundMessage,
    *,
    email_sender: EmailSender,
    push_sender: PushSender,
) -> bool | None:
    """Émet une ligne. Vrai si parti, `None` s'il n'y avait rien à joindre.

    `None` et non faux : « aucune adresse » n'est pas un échec à réessayer, et
    le prochain passage trouverait la même absence.
    """
    utilisateur = await session.get(User, ligne.user_id)
    if utilisateur is None or utilisateur.status is not UserStatus.ACTIVE:
        await ecarter(session, ligne, ECARTE_INJOIGNABLE)
        return None

    valeurs = notifications.valeurs_du_gabarit(utilisateur.locale, dict(ligne.values))
    sujet = notifications.rendre(f"{ligne.template_key}.subject", utilisateur.locale, **valeurs)
    corps = notifications.rendre(f"{ligne.template_key}.body", utilisateur.locale, **valeurs)

    if ligne.channel is MessageChannel.EMAIL:
        if not utilisateur.email:
            await ecarter(session, ligne, ECARTE_SANS_ADRESSE)
            return None
        await email_sender.envoyer(
            Message(
                destinataire=utilisateur.email,
                sujet=sujet,
                corps=corps,
                locale=utilisateur.locale,
            )
        )
        await marquer_parti(session, ligne)
        return True

    jetons = tuple(
        await session.scalars(
            sa.select(DeviceToken.token).where(
                DeviceToken.user_id == ligne.user_id,
                DeviceToken.status == DeviceTokenStatus.ACTIVE,
            )
        )
    )
    if not jetons:
        await ecarter(session, ligne, ECARTE_SANS_TERMINAL)
        return None

    envois = [Envoi(token=jeton, titre=sujet, corps=corps, donnees={}) for jeton in jetons]
    verdicts = await push_sender.envoyer(envois)

    # Les jetons que le fournisseur déclare morts sont révoqués ici : c'est la
    # seule occasion qu'on ait de l'apprendre.
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

    if any(verdict is Verdict.ENVOYE for verdict in verdicts):
        await marquer_parti(session, ligne)
        return True

    # Aucun jeton n'a abouti et aucun n'était invalide : le fournisseur a
    # refusé pour une autre raison, et cela se réessaie.
    await _reporter(session, ligne, EmailError("aucun terminal joint"))
    return False


async def marquer_parti(
    session: AsyncSession, ligne: OutboundMessage, *, maintenant: datetime | None = None
) -> None:
    ligne.sent_at = maintenant or datetime.now(UTC)
    ligne.last_error = None
    await session.flush()


async def ecarter(
    session: AsyncSession,
    ligne: OutboundMessage,
    raison: str,
    *,
    maintenant: datetime | None = None,
) -> None:
    """Ferme la ligne sans l'envoyer, en disant pourquoi.

    Elle ne sera pas réessayée : ce qui l'a écartée ne changera pas au prochain
    passage, et la relire chaque minute ferait tourner la boîte sur place.
    """
    del maintenant  # l'instant n'a pas de sens ici : rien n'est parti
    ligne.skipped_reason = raison
    await session.flush()


async def _reporter(
    session: AsyncSession,
    ligne: OutboundMessage,
    echec: Exception,
    *,
    maintenant: datetime | None = None,
) -> None:
    """Report croissant, plafonné, puis abandon nommé.

    La même politique que les jobs, et pour la même raison : un service d'envoi
    qui tombe ne doit pas être martelé jusqu'à ce qu'il nous bannisse.
    """
    instant = maintenant or datetime.now(UTC)
    reglages = get_settings()

    ligne.attempts += 1
    ligne.last_error = f"{type(echec).__name__}: {echec}"[: reglages.job_error_max_length]

    if ligne.attempts >= reglages.job_max_attempts:
        ligne.skipped_reason = ECARTE_EPUISE
        await session.flush()
        return

    # **Le même calcul que les jobs, par la même fonction.** Deux politiques
    # de report se désaccordent au premier ajustement, et c'est celle qu'on
    # oublierait qui martèlerait.
    ligne.run_after = instant + jobs_service.delai_de_report(ligne.attempts, reglages)
    await session.flush()


async def pour(
    session: AsyncSession, *, user_id: uuid.UUID, kind: NotificationKind
) -> list[OutboundMessage]:
    """Ce que la boîte contient pour cette personne et ce genre. Pour les tests
    et pour une future file d'administration."""
    return list(
        await session.scalars(
            sa.select(OutboundMessage).where(
                OutboundMessage.user_id == user_id, OutboundMessage.kind == kind
            )
        )
    )
