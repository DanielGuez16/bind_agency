"""Abonnement du commerce.

**Le seul flux d'argent du produit.** Un commerce paie pour participer ; rien
d'autre ne circule, et aucun créateur n'est jamais concerné.

**Le prix vient de `subscription_plan`, jamais du fournisseur.** La tarification
est une donnée du produit ; laisser le tableau de bord Stripe la porter créerait
une seconde source, et c'est celle qu'on oublierait de mettre à jour.

**Le produit ne voit jamais une carte.** Le fournisseur la collecte, et c'est la
seule façon de ne pas avoir à la protéger. `checkout_url` est ce qu'on rend au
commerce ; nulle en mode journal, où offrir un lien mort serait pire que ne rien
offrir.

**Une seule ligne d'abonnement vivante par commerce.** Deux abonnements
actifs feraient payer deux fois, et personne ne s'en apercevrait avant le relevé
bancaire.
"""

import uuid
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.billing import BillingProvider
from app.models import Business, Subscription, SubscriptionPlan, User
from app.models.enums import BillingInterval, SubscriptionStatus
from app.services import audit
from app.services.audit import AuditedEntity

#: Un abonnement dans l'un de ces états occupe la place. `canceled` ne
#: l'occupe pas : on peut en rouvrir un. `incomplete` l'occupe — il attend un
#: paiement, et en ouvrir un second créerait deux clients chez le fournisseur
#: pour un seul commerce.
VIVANTS = frozenset(
    {
        SubscriptionStatus.INCOMPLETE,
        SubscriptionStatus.TRIALING,
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PAST_DUE,
    }
)

#: Notre vocabulaire vers celui de Stripe. `monthly` et `month` disent la même
#: chose ; traduire ici évite de renommer notre énumération pour plaire à un
#: fournisseur qu'on pourrait changer.
INTERVALLES = {BillingInterval.MONTHLY: "month", BillingInterval.YEARLY: "year"}


class SubscriptionError(Exception):
    pass


class PlanNotFound(SubscriptionError):
    pass


class PlanInactive(SubscriptionError):
    """Un plan retiré ne se souscrit plus, même si son identifiant circule encore."""


class AlreadySubscribed(SubscriptionError):
    pass


class NotSubscribed(SubscriptionError):
    pass


@dataclass(frozen=True, slots=True)
class AbonnementOuvert:
    subscription: Subscription
    #: Où le commerce va saisir sa carte. Nulle en mode journal.
    checkout_url: str | None


async def courant(session: AsyncSession, *, business_id: uuid.UUID) -> Subscription | None:
    """L'abonnement qui occupe la place, s'il y en a un."""
    return await session.scalar(
        sa.select(Subscription)
        .where(Subscription.business_id == business_id, Subscription.status.in_(VIVANTS))
        .order_by(Subscription.id)
        .limit(1)
    )


async def souscrire(
    session: AsyncSession,
    *,
    business: Business,
    plan_id: uuid.UUID,
    actor: User,
    provider: BillingProvider,
) -> AbonnementOuvert:
    """Ouvre l'abonnement du commerce sur un plan.

    Le client de facturation est créé à chaque souscription plutôt que conservé
    sur le commerce : tant qu'il n'y a qu'un abonnement à la fois, le retrouver
    n'apporte rien, et le stocker imposerait de le garder synchronisé avec un
    système qu'on ne contrôle pas.
    """
    if await courant(session, business_id=business.id) is not None:
        raise AlreadySubscribed(str(business.id))

    plan = await session.get(SubscriptionPlan, plan_id)
    if plan is None:
        raise PlanNotFound(str(plan_id))
    if not plan.is_active:
        raise PlanInactive(str(plan_id))

    client = await provider.creer_le_client(business_id=str(business.id), email=actor.email or "")
    distant = await provider.ouvrir_un_abonnement(
        customer_id=client.external_id,
        price_cents=plan.price_cents,
        currency=plan.currency,
        interval=INTERVALLES[plan.billing_interval],
    )

    ligne = Subscription(
        business_id=business.id,
        plan_id=plan.id,
        # Le statut vient du fournisseur, jamais d'une supposition : un
        # abonnement créé et non payé est `incomplete`, et le noter `active`
        # ferait croire à un commerce qu'il participe.
        status=_statut(distant.status),
        current_period_end=None,
        stripe_customer_id=client.external_id,
        stripe_subscription_id=distant.external_id,
        # **L'heure d'écriture, pas celle de la transaction.** Deux
        # souscriptions du même commerce dans une même transaction — une
        # résiliation suivie d'une reprise — doivent s'ordonner ; `now()` leur
        # donnerait le même instant et la première paraîtrait durer zéro.
        started_at=sa.func.clock_timestamp(),
    )
    session.add(ligne)
    await session.flush()

    await audit.record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        to_status=f"subscription:{ligne.status.value}",
        actor=audit.Actor.from_user(actor),
        reason=f"plan {plan.name}",
    )

    # **Souscrire referme la période de grâce, et rend le fil au salon qui n'en
    # était sorti que pour ça.** Importé ici et non en tête de fichier : la
    # grâce a besoin de savoir ce qu'est un abonnement vivant, et se déclarer
    # mutuellement en haut des deux fichiers ferait un cycle. Un salon en
    # congés, lui, reste en congés — c'est la règle de `rendre_la_visibilite`.
    from app.services import grace

    await grace.rendre_la_visibilite(session, business=business, actor=actor)
    return AbonnementOuvert(subscription=ligne, checkout_url=distant.checkout_url)


async def resilier(
    session: AsyncSession, *, business: Business, actor: User, provider: BillingProvider
) -> Subscription:
    """Résilie l'abonnement en cours.

    Le commerce garde sa place jusqu'à la fin de la période payée : c'est le
    fournisseur qui le dit, et on n'anticipe pas sa décision. Ce qu'on écrit
    ici est ce qu'il a répondu.
    """
    ligne = await courant(session, business_id=business.id)
    if ligne is None:
        raise NotSubscribed(str(business.id))

    distant = await provider.resilier(subscription_id=ligne.stripe_subscription_id or "")
    precedent = ligne.status
    ligne.status = _statut(distant.status)
    # La fin, posée en même temps que le statut. Séparer les deux écritures
    # laisserait un abonnement résilié sans date de fin si la seconde échoue,
    # et il compterait alors pour toujours comme un abonnement en cours.
    ligne.ended_at = sa.func.clock_timestamp()
    await session.flush()
    await session.refresh(ligne, ["ended_at"])

    await audit.record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=f"subscription:{precedent.value}",
        to_status=f"subscription:{ligne.status.value}",
        actor=audit.Actor.from_user(actor),
        reason="résiliation demandée par le commerce",
    )
    return ligne


def _statut(brut: str) -> SubscriptionStatus:
    """Le statut du fournisseur, ramené au nôtre.

    Un statut inconnu devient `incomplete` et non `active` : dans le doute, on
    ne fait pas participer un commerce qui n'a peut-être pas payé. L'inverse
    coûterait des prestations offertes contre rien.
    """
    try:
        return SubscriptionStatus(brut)
    except ValueError:
        return SubscriptionStatus.INCOMPLETE
