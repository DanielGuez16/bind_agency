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
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, Subscription, SubscriptionPlan
from app.models.enums import (
    BillingInterval,
    BusinessCategory,
    Neighborhood,
    SubscriptionStatus,
)

#: Ce qui compte comme du revenu récurrent. `past_due` en fait partie : la
#: facture n'est pas encaissée mais l'abonnement court toujours, et le sortir
#: du total ferait apparaître une chute de revenu là où il n'y a qu'un
#: prélèvement en retard.
ACTIFS = frozenset({SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE})


@dataclass(frozen=True, slots=True)
class Abonne:
    """Un salon abonné à un plan. Le statut est celui de l'abonnement."""

    business_id: uuid.UUID
    name: str
    neighborhood: Neighborhood | None
    category: BusinessCategory
    status: SubscriptionStatus
    since: datetime


@dataclass(frozen=True, slots=True)
class AbonnesParCategorie:
    """Combien de commerces d'une catégorie ont souscrit à ce plan.

    **À ne pas confondre avec `PlanAdministrateur.category`**, qui dit à quelle
    catégorie le plan *s'adresse*. Celle-ci dit qui a souscrit, et l'écart entre
    les deux est tout l'intérêt : un plan « Maison » qui n'a jamais séduit un
    seul salon d'ongles se voit là et nulle part ailleurs.

    C'est l'argument chiffré de la tarification par catégorie. Un prix unique
    pour un salon d'ongles et un musée n'est pas un prix, c'est une moyenne — et
    la moyenne se voit ici : une catégorie qui souscrit peu et part vite paie
    trop cher, une catégorie qui souscrit massivement et ne part jamais paie
    trop peu.
    """

    categorie: BusinessCategory
    #: Tous statuts confondus : c'est une histoire de souscriptions, pas un
    #: instantané de revenu. Une catégorie qui a souscrit puis est partie a
    #: quelque chose à dire sur le prix, et la compter à zéro l'effacerait.
    abonnes: int
    #: Ceux qui courent encore. L'écart avec le précédent est le signal.
    abonnes_actifs: int


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

    #: La médiane des abonnements **terminés**, en jours. Nulle tant qu'aucun
    #: n'est fini.
    #:
    #: **Médiane et non moyenne** : un seul abonné parti au bout d'un an fausse
    #: une moyenne sur douze souscriptions.
    #:
    #: **Terminés seulement, et servie avec son effectif.** Mélanger les
    #: abonnements finis et ceux qui courent rendrait un nombre dont personne ne
    #: peut dire ce qu'il mesure : une durée terminée est un fait, une durée
    #: courue est un minimum. C'est le problème classique de la censure à
    #: droite, et le résoudre en moyennant les deux ne le résout pas, il le
    #: cache.
    #:
    #: Le biais qui reste est connu et il est vers le bas : on ne mesure que
    #: ceux qui sont partis. `duree_mediane_en_cours_jours` est là pour qu'il se
    #: voie — quand elle dépasse largement la médiane terminée, c'est que les
    #: fidèles ne sont pas encore comptés.
    duree_mediane_terminee_jours: int | None
    #: Sur combien d'abonnements la médiane terminée est calculée.
    #:
    #: **Sans lui, « 7 mois » se lit comme un fait quand il sort de trois
    #: départs.** Il compte aussi ce que la reprise n'a pas pu retrouver : un
    #: abonnement sans date d'ouverture n'entre dans aucun calcul.
    abonnements_termines: int
    #: La médiane des durées **courues** des abonnements vivants, en jours.
    #:
    #: Un minimum, jamais une durée de vie : ces abonnements continuent. Servie
    #: parce que son absence laisserait croire que la médiane terminée est la
    #: réponse, alors qu'elle n'en est que la moitié observable.
    duree_mediane_en_cours_jours: int | None
    #: Sur combien d'abonnements vivants elle est calculée.
    abonnements_en_cours: int

    #: Qui a souscrit, par catégorie de commerce. Vide quand personne n'a
    #: souscrit — et c'est le bon vide : une liste de zéros par catégorie ne se
    #: lit pas, et ferait croire à un échantillon là où il n'y a rien.
    abonnes_par_categorie: tuple[AbonnesParCategorie, ...]


def mediane(valeurs: list[int]) -> int | None:
    """La médiane d'une liste, entière, ou `None` si la liste est vide.

    Écrite plutôt qu'empruntée à `statistics` : `median` rend un flottant sur un
    nombre pair de valeurs, et une durée à 212,5 jours n'a pas de sens à
    l'écran. La moyenne des deux valeurs centrales est arrondie ici, une fois.
    """
    if not valeurs:
        return None
    triees = sorted(valeurs)
    milieu = len(triees) // 2
    if len(triees) % 2:
        return triees[milieu]
    return round((triees[milieu - 1] + triees[milieu]) / 2)


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

    # **Deux lectures de plus, et pas une par plan.** Les durées et les
    # catégories se chargent en masse puis se regroupent en mémoire : une
    # requête par plan serait un N+1 sur l'écran qui décide des prix, c'est-à-
    # dire celui qu'on ouvre en réunion.
    durees = await _durees(session)
    categories = await _abonnes_par_categorie(session)

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
            duree_mediane_terminee_jours=mediane(durees.get(plan.id, ([], []))[0]),
            abonnements_termines=len(durees.get(plan.id, ([], []))[0]),
            duree_mediane_en_cours_jours=mediane(durees.get(plan.id, ([], []))[1]),
            abonnements_en_cours=len(durees.get(plan.id, ([], []))[1]),
            abonnes_par_categorie=tuple(categories.get(plan.id, ())),
        )
        for plan, nombre, actifs in lignes
    )


async def _durees(
    session: AsyncSession,
) -> dict[uuid.UUID, tuple[list[int], list[int]]]:
    """Par plan, les durées terminées et les durées courues, en jours.

    Deux listes séparées et jamais fusionnées : une durée terminée est un fait,
    une durée courue est un minimum. Les additionner rendrait une médiane dont
    personne ne pourrait dire ce qu'elle mesure.

    **Les abonnements sans date d'ouverture sont écartés**, pas comptés à zéro.
    Ce sont les lignes antérieures aux colonnes de dates, et celles dont la
    reprise n'a pas pu retrouver l'ouverture sans deviner. Zéro dirait « parti
    tout de suite », ce qui est un mensonge sur le prix.
    """
    par_plan: dict[uuid.UUID, tuple[list[int], list[int]]] = {}
    for plan_id, debut, fin in await session.execute(
        sa.select(Subscription.plan_id, Subscription.started_at, Subscription.ended_at).where(
            Subscription.started_at.is_not(None)
        )
    ):
        terminees, en_cours = par_plan.setdefault(plan_id, ([], []))
        if fin is not None:
            terminees.append((fin - debut).days)
        else:
            en_cours.append((datetime.now(UTC) - debut).days)
    return par_plan


async def _abonnes_par_categorie(
    session: AsyncSession,
) -> dict[uuid.UUID, list[AbonnesParCategorie]]:
    """Par plan, qui a souscrit — par catégorie de commerce.

    La catégorie de l'abonné, pas celle du plan : ce sont deux choses
    différentes, et c'est leur écart qui informe un prix.
    """
    par_plan: dict[uuid.UUID, list[AbonnesParCategorie]] = {}
    for plan_id, categorie, total, actifs in await session.execute(
        sa.select(
            Subscription.plan_id,
            Business.category,
            sa.func.count(),
            sa.func.count().filter(Subscription.status.in_(ACTIFS)),
        )
        .join(Business, Business.id == Subscription.business_id)
        .group_by(Subscription.plan_id, Business.category)
        # Le plus gros contingent en tête : c'est celui qui décide du prix.
        .order_by(Subscription.plan_id, sa.func.count().desc(), Business.category)
    ):
        par_plan.setdefault(plan_id, []).append(
            AbonnesParCategorie(categorie=categorie, abonnes=total, abonnes_actifs=actifs)
        )
    return par_plan


async def abonnes_du_plan(session: AsyncSession, *, plan_id: uuid.UUID) -> tuple[Abonne, ...]:
    """Les salons abonnés à un plan, du plus ancien au plus récent.

    **Tous statuts confondus, et c'est le point.** Un salon parti a autant à
    dire sur un prix qu'un salon resté : ne rendre que les actifs ferait lire
    « douze abonnés » sur un plan qui en a perdu huit, et c'est exactement le
    chiffre qui manquerait pour décider. Le statut voyage avec chaque ligne.

    **Le plus ancien d'abord.** L'écran répond à « ce prix tient-il dans la
    durée » ; l'ancienneté est donc l'axe, pas le nom.
    """
    lignes = (
        await session.execute(
            sa.select(
                Business.id,
                Business.name,
                Business.neighborhood,
                Business.category,
                Subscription.status,
                Subscription.created_at,
            )
            .join(Subscription, Subscription.business_id == Business.id)
            .where(Subscription.plan_id == plan_id)
            .order_by(Subscription.created_at, Business.name)
        )
    ).all()

    return tuple(
        Abonne(
            business_id=ligne.id,
            name=ligne.name,
            neighborhood=ligne.neighborhood,
            category=ligne.category,
            status=ligne.status,
            since=ligne.created_at,
        )
        for ligne in lignes
    )
