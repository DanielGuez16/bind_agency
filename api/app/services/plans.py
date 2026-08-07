"""Lecture des plans d'abonnement, côté administrateur.

**C'est le seul endroit du produit où des montants sortent.** Ni le créateur ni
le commerce ne lisent cette route : elle est réservée au rôle administrateur,
et rien de ce qu'elle rend n'est repris ailleurs.

**Le revenu récurrent se calcule ici, pas dans l'écran.** Un plan annuel et un
plan mensuel n'ont pas la même unité ; laisser l'app diviser par douze ferait
d'une règle de facturation une décision de mise en page, à réécrire dans chaque
client. Le montant est ramené au mois, en centiers entiers, et la division est
arrondie plutôt que tronquée — sur douze mois, tronquer perd jusqu'à onze
centimes par plan et fait mentir le total.

**Seuls les abonnements actifs comptent.** Un abonnement résilié n'est pas du
revenu récurrent ; le compter reviendrait à annoncer un chiffre qui ne baisse
jamais.
"""

import uuid
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Subscription, SubscriptionPlan
from app.models.enums import BillingInterval, BusinessCategory, SubscriptionStatus

#: Ce qui compte comme du revenu récurrent. `past_due` en fait partie : la
#: facture n'est pas encaissée mais l'abonnement court toujours, et le sortir
#: du total ferait apparaître une chute de revenu là où il n'y a qu'un
#: prélèvement en retard.
ACTIFS = frozenset({SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE})


@dataclass(frozen=True, slots=True)
class PlanAdministrateur:
    plan_id: uuid.UUID
    name: str
    category: BusinessCategory
    price_cents: int
    currency: str
    billing_interval: BillingInterval
    features: dict
    is_active: bool
    #: Commerces abonnés, tous statuts confondus. Le nombre que voit l'admin
    #: quand il se demande « qui utilise ce plan ».
    subscriptions_count: int
    #: Ceux qui courent réellement.
    active_subscriptions_count: int
    #: Revenu mensuel récurrent porté par ce plan, en centimes.
    mrr_cents: int


def mensualiser(price_cents: int, interval: BillingInterval) -> int:
    """Ramène un prix à son équivalent mensuel, en centimes entiers."""
    if interval is BillingInterval.YEARLY:
        # Arrondi et non troncature : douze mois de troncature perdent jusqu'à
        # onze centimes par plan, et le total affiché cesse d'être vérifiable.
        return round(price_cents / 12)
    return price_cents


async def lister(session: AsyncSession) -> tuple[PlanAdministrateur, ...]:
    total = (
        sa.select(
            Subscription.plan_id,
            sa.func.count().label("total"),
            sa.func.count().filter(Subscription.status.in_(ACTIFS)).label("actifs"),
        )
        .group_by(Subscription.plan_id)
        .subquery()
    )

    lignes = (
        await session.execute(
            sa.select(
                SubscriptionPlan,
                sa.func.coalesce(total.c.total, 0).label("total"),
                sa.func.coalesce(total.c.actifs, 0).label("actifs"),
            )
            .outerjoin(total, total.c.plan_id == SubscriptionPlan.id)
            .order_by(SubscriptionPlan.category, SubscriptionPlan.price_cents)
        )
    ).all()

    return tuple(
        PlanAdministrateur(
            plan_id=plan.id,
            name=plan.name,
            category=plan.category,
            price_cents=plan.price_cents,
            currency=plan.currency,
            billing_interval=plan.billing_interval,
            features=plan.features,
            is_active=plan.is_active,
            subscriptions_count=nombre,
            active_subscriptions_count=actifs,
            mrr_cents=mensualiser(plan.price_cents, plan.billing_interval) * actifs,
        )
        for plan, nombre, actifs in lignes
    )
