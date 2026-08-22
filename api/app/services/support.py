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
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, BusinessSupportAccess, User
from app.models.enums import PorteeDeReprise, UserRole
from app.services.audit import Actor, AuditedEntity, record_transition

REASON_OUVERTE = "support_access_opened"
REASON_FERMEE = "support_access_closed"
#: **Refermée par le salon, et c'est un autre fait.** « Je suis ressorti » et
#: « on m'a mis dehors » ne se relisent pas pareil trois mois plus tard, et
#: c'est le second qui devrait faire réfléchir à ce qu'on était venu faire.
REASON_FERMEE_PAR_LE_SALON = "support_access_revoked_by_business"

#: Le nom montré au salon quand l'administrateur n'en a déclaré aucun. **Pas
#: son identifiant, ni son adresse** : un UUID ne nomme personne, et une
#: adresse de travail n'a pas à circuler chez cent commerces. Un repli neutre
#: dit au moins de qui il s'agit — de nous — et l'absence de nom se voit dans
#: la liste, ce qui est la seule chose qui poussera à en poser un.
NOM_PAR_DEFAUT = "BIND"


class SupportError(Exception):
    """Base des refus de reprise."""


class NotAnAdmin(SupportError):
    """Seule l'administration reprend un compte."""


class ReasonRequired(SupportError):
    """Un motif vide ne dit pas pourquoi on est entré.

    Refusé ici et pas seulement en base : l'appelant doit lire une erreur de
    son geste, pas une violation de contrainte à la validation.
    """


class ScopeRequired(SupportError):
    """Une reprise s'ouvre sur quelque chose.

    Une portée vide ouvrirait tout ou rien. « Tout » est l'accès permanent
    qu'on refuse ; « rien » serait une reprise qui n'ouvre pas, c'est-à-dire un
    geste sans effet dont personne ne comprendrait le refus qui suit.
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


def couvre(acces: BusinessSupportAccess, portee: PorteeDeReprise | None) -> bool:
    """La reprise ouvre-t-elle cet écran ?

    **`None` ne passe pas.** Une requête qu'on n'a pas su classer n'est couverte
    par aucune reprise : c'est le sens qui refuse, et il se voit — un écran neuf
    qu'on a oublié de classer bloque le support à la première tentative. Le sens
    inverse ouvrirait une porte que personne n'a déclarée, et rien ne le dirait.
    """
    return portee is not None and portee.value in acces.scope


async def reprises_recentes(
    session: AsyncSession,
    *,
    admin_user_id: uuid.UUID,
    maintenant: datetime | None = None,
) -> int:
    """Combien de reprises cet administrateur a ouvertes, **tous salons confondus**.

    Sur une fenêtre glissante, et c'est le seul chiffre qui dise « quatorze
    fois cette semaine » à quelqu'un qui ne compte que celle où il est. Rien
    n'est refusé sur ce compte : un seuil se contournerait en attendant un jour,
    et transformerait une mesure honnête en formalité à franchir.

    Les closes et les échues comptent : ce qu'on mesure est **le geste**, pas la
    porte encore ouverte. N'additionner que les vivantes rendrait toujours un ou
    zéro, et ne mesurerait plus rien.
    """
    instant = maintenant or datetime.now(UTC)
    debut = instant - timedelta(seconds=get_settings().support_access_recent_window_seconds)
    return (
        await session.scalar(
            sa.select(sa.func.count())
            .select_from(BusinessSupportAccess)
            .where(
                BusinessSupportAccess.admin_user_id == admin_user_id,
                BusinessSupportAccess.started_at >= debut,
            )
        )
    ) or 0


async def toutes_en_cours(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    maintenant: datetime | None = None,
) -> tuple[BusinessSupportAccess, ...]:
    """Toutes les reprises vivantes chez ce commerce, **quel que soit l'administrateur**.

    C'est ce que le salon referme d'un geste. Lui demander de choisir laquelle
    serait lui demander de savoir combien de personnes sont entrées — la seule
    chose qu'il veuille est que plus personne n'y soit.
    """
    instant = maintenant or datetime.now(UTC)
    return tuple(
        await session.scalars(
            sa.select(BusinessSupportAccess)
            .where(
                BusinessSupportAccess.business_id == business_id,
                BusinessSupportAccess.ended_at.is_(None),
                BusinessSupportAccess.expires_at > instant,
            )
            .order_by(BusinessSupportAccess.started_at.desc())
        )
    )


async def ouvrir(
    session: AsyncSession,
    *,
    business: Business,
    admin: User,
    motif: str,
    portee: Sequence[PorteeDeReprise],
    # **Déclaré, jamais déduit.** Aucun canal ne permet au salon d'écrire ; le
    # calculer rendrait « spontanée » y compris pour ceux qui ont téléphoné. Ce
    # qui rend la déclaration sérieuse est que le gérant la lit et peut la
    # contredire. Voir `BusinessSupportAccess.spontaneous`.
    spontanee: bool = True,
    maintenant: datetime | None = None,
) -> BusinessSupportAccess:
    """Ouvre une reprise. Le motif et la portée sont obligatoires."""
    if admin.role is not UserRole.ADMIN:
        raise NotAnAdmin(str(admin.id))
    if not motif.strip():
        raise ReasonRequired(str(business.id))
    if not portee:
        raise ScopeRequired(str(business.id))

    instant = maintenant or datetime.now(UTC)
    if (
        await en_cours(session, business_id=business.id, admin_user_id=admin.id, maintenant=instant)
        is not None
    ):
        raise AlreadyOpen(str(business.id))

    acces = BusinessSupportAccess(
        business_id=business.id,
        admin_user_id=admin.id,
        # **Recopié, pas joint.** Le gérant qui relit une reprise de mars doit
        # lire le nom qu'il a lu en mars, même si son auteur s'est renommé.
        admin_name=(admin.display_name or "").strip() or NOM_PAR_DEFAUT,
        reason=motif.strip(),
        # Dédoublonnée et ordonnée : ce que le salon lit ne doit pas dépendre
        # de l'ordre dans lequel une case a été cochée.
        scope=sorted({p.value for p in portee}),
        spontaneous=spontanee,
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
        extra={
            "expires_at": acces.expires_at.isoformat(),
            "scope": acces.scope,
            "spontaneous": acces.spontaneous,
        },
    )
    return acces


async def fermer(
    session: AsyncSession,
    *,
    acces: BusinessSupportAccess,
    acteur: User,
    maintenant: datetime | None = None,
) -> BusinessSupportAccess:
    """Referme une reprise avant son terme. Sans effet si elle est déjà close.

    **L'acteur n'est pas toujours l'administration.** Le salon referme aussi,
    et sans avoir à demander : « l'accès se ferme sans discussion » ne tenait
    pas tant que seule la porte d'administration savait se refermer. Le journal
    garde lequel des deux l'a fait — c'est la seule chose qui distingue « je
    suis ressorti » de « on m\'a mis dehors ».

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
        actor=Actor.from_user(acteur),
        reason=(REASON_FERMEE if acteur.id == acces.admin_user_id else REASON_FERMEE_PAR_LE_SALON),
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
