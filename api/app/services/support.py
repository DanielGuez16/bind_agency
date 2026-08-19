"""Reprendre un compte commerce, explicitement et pour un temps.

**Le principe.** Après l'activation, l'administration n'a plus aucun accès au
compte d'un salon. Un accès permanent est commode le premier mois et ingérable
au centième : personne ne saurait plus qui peut entrer où.

Quand il faut entrer — débloquer une configuration, comprendre un refus — la
reprise s'ouvre par un geste, avec un motif écrit, pour une durée bornée, et
**le salon en est prévenu**. Un accès de support silencieux est un accès dont
personne ne peut demander compte.

**Ce qui est fait pendant la reprise est déjà tracé.** Chaque transition écrit
son acteur ; celles d'un administrateur portent `actor_kind = admin`. Ce module
n'ajoute donc pas un second journal — il rend seulement lisible *quand* et
*pourquoi* la porte était ouverte.

**Une reprise échue n'est pas une reprise fermée.** `ended_at` ne se remplit que
si quelqu'un a refermé. L'expiration éteint sans rien écrire : dans une liste,
« refermée à 15 h 12 » et « expirée toute seule » ne se lisent pas pareil, et
c'est la seconde qui devrait gêner.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, BusinessSupportAccess, User
from app.models.enums import UserRole
from app.services.audit import Actor, AuditedEntity, record_transition

REASON_OUVERTE = "support_access_opened"
REASON_FERMEE = "support_access_closed"


class SupportError(Exception):
    """Base des refus de reprise."""


class NotAnAdmin(SupportError):
    """Seule l'administration reprend un compte."""


class ReasonRequired(SupportError):
    """Un motif vide ne dit pas pourquoi on est entré.

    Refusé ici et pas seulement en base : l'appelant doit lire une erreur de
    son geste, pas une violation de contrainte à la validation.
    """


class AlreadyOpen(SupportError):
    """Cet administrateur a déjà une reprise ouverte sur ce commerce.

    En ouvrir une seconde produirait deux motifs pour une seule intervention,
    et la liste du salon montrerait deux entrées là où il ne s'est rien passé
    de plus.
    """


async def en_cours(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    admin_user_id: uuid.UUID,
    maintenant: datetime | None = None,
) -> BusinessSupportAccess | None:
    """La reprise vivante de cet administrateur sur ce commerce, s'il y en a une.

    **C'est la fonction que le résolveur d'appartenance interroge**, à chaque
    requête d'un administrateur sur une route commerce. Les trois conditions
    sont celles qui font qu'une porte est ouverte : elle existe, personne ne
    l'a refermée, et son terme n'est pas passé.
    """
    instant = maintenant or datetime.now(UTC)
    return await session.scalar(
        sa.select(BusinessSupportAccess)
        .where(
            BusinessSupportAccess.business_id == business_id,
            BusinessSupportAccess.admin_user_id == admin_user_id,
            BusinessSupportAccess.ended_at.is_(None),
            BusinessSupportAccess.expires_at > instant,
        )
        .order_by(BusinessSupportAccess.started_at.desc())
        .limit(1)
    )


async def ouvrir(
    session: AsyncSession,
    *,
    business: Business,
    admin: User,
    motif: str,
    maintenant: datetime | None = None,
) -> BusinessSupportAccess:
    """Ouvre une reprise. Le motif est obligatoire et la durée vient de la configuration."""
    if admin.role is not UserRole.ADMIN:
        raise NotAnAdmin(str(admin.id))
    if not motif.strip():
        raise ReasonRequired(str(business.id))

    instant = maintenant or datetime.now(UTC)
    if (
        await en_cours(session, business_id=business.id, admin_user_id=admin.id, maintenant=instant)
        is not None
    ):
        raise AlreadyOpen(str(business.id))

    acces = BusinessSupportAccess(
        business_id=business.id,
        admin_user_id=admin.id,
        reason=motif.strip(),
        expires_at=instant + timedelta(seconds=get_settings().support_access_ttl_seconds),
    )
    session.add(acces)
    await session.flush()

    # **Le motif va au journal en note libre**, où il ne s'efface pas. La ligne
    # de reprise peut être lue par le salon ; le journal, lui, est ce qu'on
    # relira le jour où quelqu'un demandera ce qui s'est passé chez lui.
    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        to_status=business.status.value,
        actor=Actor.from_user(admin),
        reason=REASON_OUVERTE,
        note=acces.reason,
        extra={"expires_at": acces.expires_at.isoformat()},
    )
    return acces


async def fermer(
    session: AsyncSession,
    *,
    acces: BusinessSupportAccess,
    admin: User,
    maintenant: datetime | None = None,
) -> BusinessSupportAccess:
    """Referme une reprise avant son terme. Sans effet si elle est déjà close.

    **L'heure de fermeture vient de la base, comme celle d'ouverture.**
    `started_at` est écrit par `clock_timestamp()`, côté Postgres ; `ended_at`
    l'était par `datetime.now(UTC)`, côté Python. Deux horloges, et la
    contrainte `close_apres_ouverture` compare les deux : il suffit que celle de
    la base soit en avance de quelques millisecondes pour qu'une reprise ouverte
    puis refermée dans la foulée paraisse s'être fermée avant de s'ouvrir.

    Vu, avec les chiffres : ouverture à `04:23:03.465808`, fermeture à
    `04:23:03.463118` — **2,7 millisecondes** d'écart, et la contrainte rejette.
    Un échec intermittent, qui ne se produit que lorsque les deux gestes se
    suivent d'assez près et que la machine est chargée.

    `maintenant` reste prioritaire : les tests qui posent une heure explicite
    éprouvent une règle de temps, et leur imposer l'horloge de la base leur
    retirerait ce qu'ils vérifient.
    """
    if acces.ended_at is not None:
        return acces

    # `clock_timestamp()` et non `now()` : refermer une reprise et en ouvrir une
    # autre dans la même transaction leur donnerait sinon le même instant, ce
    # que `started_at` prend déjà soin d'éviter.
    acces.ended_at = maintenant or sa.func.clock_timestamp()
    await session.flush()
    # L'attribut porte l'expression SQL tant qu'il n'est pas relu : le
    # rafraîchir rend l'heure réellement écrite, que l'appelant affiche.
    await session.refresh(acces, ["ended_at"])

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=acces.business_id,
        to_status="support_access:closed",
        actor=Actor.from_user(admin),
        reason=REASON_FERMEE,
    )
    return acces


async def historique(
    session: AsyncSession, *, business_id: uuid.UUID, limite: int = 100
) -> tuple[BusinessSupportAccess, ...]:
    """Toutes les reprises de ce commerce, la plus récente d'abord.

    **Rendue au salon**, pas seulement à l'administration : c'est ce qui fait la
    différence entre un accès déclaré et un accès qu'on découvre. La liste garde
    les reprises closes — n'afficher que celles en cours dirait « personne n'est
    entré » à quelqu'un chez qui on est entré trois fois.
    """
    return tuple(
        await session.scalars(
            sa.select(BusinessSupportAccess)
            .where(BusinessSupportAccess.business_id == business_id)
            .order_by(BusinessSupportAccess.started_at.desc())
            .limit(max(1, min(limite, 500)))
        )
    )
