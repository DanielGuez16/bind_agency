"""Où en est la composition d'un commerce, en une seule lecture.

Le menu de configuration montre trois portes — le catalogue, les horaires, la
mise en ligne — et il ne disait rien de ce qu'il y avait derrière. C'est le
premier écran qu'ouvre un salon qui vient de s'inscrire : il doit voir où il en
est d'un coup d'œil, sans entrer dans chacune pour le découvrir.

**Une requête, pas trois.** Les trois nombres vivent dans trois tables ; les
demander depuis l'écran ferait trois allers-retours pour afficher un menu, et
l'un des trois arriverait toujours en dernier — le menu se recomposerait sous
les yeux. Un seul appel, trois sous-requêtes agrégées.

**La date de mise en ligne vient du journal, pas d'une colonne.** Aucune ligne
ne la porte : `business.status` dit où l'on en est, jamais depuis quand. Le
journal d'audit, lui, enregistre la transition — c'est sa raison d'être, et la
lire évite une colonne de plus qui pourrait diverger de lui. Un commerce remis
en pause puis rouvert a plusieurs transitions vers `active` : c'est la
**dernière** qui compte, celle qui explique l'état d'aujourd'hui.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Business, CapacityRule, CatalogItem
from app.models.enums import BusinessStatus
from app.services.audit import AuditedEntity


@dataclass(frozen=True, slots=True)
class EtatDeLaComposition:
    """Ce que le menu de configuration affiche sous chaque porte."""

    business_id: uuid.UUID
    #: Les prestations proposées. Le parent d'une gamme n'en est pas une : il ne
    #: se réserve pas et ne s'affiche jamais seul.
    prestations: int
    #: Combien de prestations sont masquées. Douze dont trois éteintes n'est pas
    #: la même composition que douze visibles, et c'est la moitié qu'on oublie.
    prestations_masquees: int
    #: Les jours de la semaine qui portent au moins une règle. Zéro à sept.
    jours_ouverts: int
    status: BusinessStatus


async def derniere_mise_en_ligne(session: AsyncSession, business_id: uuid.UUID) -> datetime | None:
    """Quand ce commerce est passé en ligne pour la dernière fois.

    **La dernière transition vers `active`, et non la première.** Un commerce
    rouvert après une pause en a plusieurs, et c'est celle d'aujourd'hui qui
    explique son état : « en ligne depuis mars » serait faux d'un salon qui a
    fermé six semaines cet été.

    Nulle tant qu'il n'a jamais été mis en ligne — ce qui n'est pas une mise en
    pause, et l'écran ne doit pas les confondre.

    Sortie de `etat_de_la_composition` parce que **la vue d'activation la
    demande aussi**, et pour la même raison : c'est l'écran du matin qui la
    montre, pas le menu de configuration. Deux copies de cette requête
    divergeraient sur le `order_by`, qui est tout ce qu'elle a.
    """
    return await session.scalar(
        sa.select(AuditLog.occurred_at)
        .where(
            AuditLog.entity_type == AuditedEntity.BUSINESS.value,
            AuditLog.entity_id == business_id,
            AuditLog.to_status == BusinessStatus.ACTIVE.value,
        )
        .order_by(AuditLog.occurred_at.desc())
        .limit(1)
    )


async def etat_de_la_composition(
    session: AsyncSession, business_id: uuid.UUID
) -> EtatDeLaComposition | None:
    """Les trois nombres du menu. Nul si le commerce n'existe pas."""
    business = await session.get(Business, business_id)
    if business is None:
        return None

    # Le parent d'une gamme est écarté par ce qu'il **est** — un item qui a des
    # variantes — plutôt que par un nom cité en dur. Même règle que le fil et
    # que le semis : trois endroits, une seule définition de « prestation ».
    parents = sa.select(CatalogItem.parent_item_id).where(CatalogItem.parent_item_id.is_not(None))
    prestations = (
        await session.execute(
            sa.select(
                sa.func.count(),
                sa.func.count().filter(CatalogItem.is_available.is_(False)),
            ).where(CatalogItem.business_id == business_id, CatalogItem.id.not_in(parents))
        )
    ).one()

    jours = await session.scalar(
        sa.select(sa.func.count(sa.distinct(CapacityRule.weekday))).where(
            CapacityRule.business_id == business_id
        )
    )

    return EtatDeLaComposition(
        business_id=business_id,
        prestations=prestations[0],
        prestations_masquees=prestations[1],
        jours_ouverts=jours or 0,
        status=business.status,
    )
