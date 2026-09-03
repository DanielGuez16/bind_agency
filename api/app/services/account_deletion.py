"""Fermer son compte : demander, revenir, puis appliquer.

## Anonymiser, jamais détruire

`anonymization.anonymize_account` fait le travail et ne change pas ici. Ce
module ouvre la porte devant elle, avec ce qu'il faut de délai et de garde.

Ce qui disparaît est ce qui identifie ; ce qui reste est ce qui engage. Le
journal d'audit est immuable, et une contrepartie déjà ouverte concerne un
salon qui n'a rien demandé — la détruire ferait payer à un tiers un droit qui
n'est pas le sien.

## Différée de trente jours

Un départ se décide en dix secondes et se regrette le lendemain. Le délai est
en configuration, et **l'échéance est écrite en base** plutôt que recalculée :
si le réglage change pendant qu'un compte attend, la date promise à la personne
tient. Une promesse qui se déplace toute seule n'en est pas une.

Le retour est possible pendant tout ce délai, et lui seul. Passé l'échéance il
n'y a plus de compte à rendre : l'anonymisation ne se défait pas, c'est ce qui
en fait une anonymisation.

## Refusée tant qu'une contrepartie est en cours

Quatre statuts sur six sont en cours. Partir en les laissant ouvertes ferait
attendre un salon pour une publication qui n'arrivera jamais, sans qu'il puisse
ni relancer ni clore. Il faut donc honorer ou clore d'abord — et `unfulfilled`
est une clôture, désagréable mais nette.

**Le refus se fait à la demande et de nouveau à l'application.** Trente jours
séparent les deux, et une contrepartie peut naître entre-temps : ne vérifier
qu'à l'entrée laisserait passer exactement le cas que la garde existe pour
empêcher.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Booking, Collaboration, User
from app.models.enums import ActorKind, CollaborationStatus, UserRole, UserStatus
from app.services import anonymization
from app.services.audit import Actor, AuditedEntity, record_transition

#: Les statuts qui engagent encore quelqu'un. `approved` et `unfulfilled` sont
#: les deux issues, l'une bonne et l'autre non : dans les deux cas le salon sait
#: à quoi s'en tenir et n'attend plus rien.
EN_COURS = frozenset(
    {
        CollaborationStatus.PENDING,
        CollaborationStatus.SUBMITTED,
        CollaborationStatus.UNDER_REVIEW,
        CollaborationStatus.RESUBMIT_REQUESTED,
    }
)

DEMANDE = "account_deletion_requested"
RETOUR = "account_deletion_cancelled"


class ContrepartieEnCours(Exception):
    """Il reste une publication due. On l'honore ou on la clôt d'abord."""


class DejaDemandee(Exception):
    """Une demande court déjà. La redemander ne repousse pas l'échéance."""


class AucuneDemande(Exception):
    """Rien à annuler."""


class RoleNonSupprimable(Exception):
    """Un administrateur ne supprime pas son propre compte.

    **Ce n'est pas une règle d'écran, c'est une règle de produit.** La demande
    n'a aucune des conditions qui bloquent les autres : un administrateur n'a ni
    contrepartie en cours, ni réservation, ni rien qui retienne la suppression.
    Elle passait donc, et trente jours plus tard l'anonymisation emportait le
    seul compte capable d'arbitrer un dossier, de reprendre un salon et de fixer
    un prix — sans qu'aucun autre chemin ne permette d'en recréer un.

    **Le bloc est masqué à l'écran, et ça ne suffit pas.** Masquer un bouton
    retire le geste à celui qui le cherchait, pas à celui qui connaît la route.
    C'est le refus côté serveur qui ferme la porte ; l'écran ne fait que cesser
    de la montrer.

    Le jour où plusieurs administrateurs existeront, la règle qui remplacera
    celle-ci n'est pas « on autorise » mais « on refuse le dernier » — et elle
    demandera de compter, ce qui est un autre travail.
    """


class CompteAnonymise(Exception):
    """Il n'y a plus de compte. L'anonymisation ne se défait pas."""


async def contreparties_en_cours(session: AsyncSession, creator_id: uuid.UUID) -> int:
    """Combien de publications sont encore dues.

    Le nombre et non un booléen : l'écran dit « deux contreparties à honorer »,
    et « vous avez des contreparties » n'aide personne à savoir quoi faire.
    """
    return (
        await session.scalar(
            sa.select(sa.func.count())
            .select_from(Collaboration)
            .join(Booking, Booking.id == Collaboration.booking_id)
            .where(Booking.creator_id == creator_id, Collaboration.status.in_(EN_COURS))
        )
    ) or 0


async def demander(session: AsyncSession, *, user: User, actor: Actor) -> User:
    """Ouvre le délai. L'échéance est posée, pas calculée à la lecture."""
    if actor.kind is ActorKind.SYSTEM:
        raise ValueError("une suppression a toujours un demandeur, jamais le système")
    if user.role is UserRole.ADMIN:
        raise RoleNonSupprimable(str(user.id))
    if user.status is UserStatus.ANONYMIZED:
        raise CompteAnonymise(str(user.id))
    if user.deletion_requested_at is not None:
        raise DejaDemandee(str(user.id))

    restantes = await contreparties_en_cours(session, user.id)
    if restantes:
        raise ContrepartieEnCours(str(restantes))

    maintenant = datetime.now(UTC)
    user.deletion_requested_at = maintenant
    user.deletion_effective_at = maintenant + timedelta(
        seconds=get_settings().account_deletion_delay_seconds
    )
    await session.flush()

    # Le statut ne bouge pas : le compte reste actif et utilisable pendant le
    # délai, c'est ce qui rend le retour possible. Le journal note la demande
    # sans transition, `to_status` restant celui d'aujourd'hui.
    await record_transition(
        session,
        entity=AuditedEntity.APP_USER,
        entity_id=user.id,
        from_status=user.status.value,
        to_status=user.status.value,
        actor=actor,
        reason=DEMANDE,
    )
    return user


async def annuler(session: AsyncSession, *, user: User, actor: Actor) -> User:
    """Le retour, possible pendant le délai et lui seul."""
    if user.status is UserStatus.ANONYMIZED:
        raise CompteAnonymise(str(user.id))
    if user.deletion_requested_at is None:
        raise AucuneDemande(str(user.id))

    user.deletion_requested_at = None
    user.deletion_effective_at = None
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.APP_USER,
        entity_id=user.id,
        from_status=user.status.value,
        to_status=user.status.value,
        actor=actor,
        reason=RETOUR,
    )
    return user


async def appliquer_les_echeances(session: AsyncSession, *, limite: int = 200) -> int:
    """Anonymise les comptes dont l'échéance est passée. Rend le nombre traité.

    `clock_timestamp()` et non `now()` : le balayage tourne en boucle dans une
    même transaction chez le travailleur, et l'heure d'ouverture y ferait
    traiter deux fois la même seconde.

    **La garde des contreparties est rejouée ici.** Trente jours séparent la
    demande de l'application ; une contrepartie née entre-temps doit repousser
    l'anonymisation, pas la subir. Le compte reste alors en attente, et
    l'échéance passée sera revue au balayage suivant — c'est voulu : rien ne
    force quelqu'un à revenir sur sa demande, et rien ne le fait disparaître en
    laissant une publication due.
    """
    echus = (
        await session.scalars(
            sa.select(User)
            .where(
                User.deletion_effective_at.is_not(None),
                User.deletion_effective_at <= sa.func.clock_timestamp(),
                User.status != UserStatus.ANONYMIZED,
            )
            .order_by(User.deletion_effective_at)
            .limit(limite)
        )
    ).all()

    traites = 0
    for user in echus:
        if await contreparties_en_cours(session, user.id):
            continue
        # **L'acteur est la personne qui l'a demandée**, pas le balayage qui
        # l'applique. `anonymize_account` refuse d'ailleurs le système, et elle
        # a raison : une anonymisation n'arrive pas toute seule, et le journal
        # doit pouvoir dire qui l'a voulue trente jours plus tôt.
        await anonymization.anonymize_account(session, user=user, actor=Actor.from_user(user))
        traites += 1

    return traites
