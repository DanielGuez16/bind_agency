"""Plans d'abonnement, en lecture, côté administrateur.

Le seul endroit du produit où des montants sortent. Deux choses à prouver : que
la conversion annuelle est faite ici et non dans l'écran, et que la route est
fermée à tout le monde sauf l'administrateur.
"""

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, Subscription, SubscriptionPlan
from app.models.enums import (
    BillingInterval,
    BusinessCategory,
    SubscriptionStatus,
    UserRole,
)
from app.services import auth as auth_service
from app.services import plans as service

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def plan(session: AsyncSession, **overrides) -> SubscriptionPlan:
    ligne = SubscriptionPlan(
        category=overrides.pop("category", BusinessCategory.BEAUTY),
        name=overrides.pop("name", "Essentiel"),
        price_cents=overrides.pop("price_cents", 9900),
        currency="USD",
        billing_interval=overrides.pop("billing_interval", BillingInterval.MONTHLY),
        features={},
        **overrides,
    )
    session.add(ligne)
    await session.flush()
    return ligne


async def commerce(session: AsyncSession) -> Business:
    ligne = Business(
        name="Salon d'essai",
        category=BusinessCategory.BEAUTY,
        currency="USD",
        timezone="America/New_York",
    )
    session.add(ligne)
    await session.flush()
    return ligne


async def abonner(session: AsyncSession, *, plan_id: uuid.UUID, status: SubscriptionStatus) -> None:
    session.add(
        Subscription(business_id=(await commerce(session)).id, plan_id=plan_id, status=status)
    )
    await session.flush()


def par_nom(lignes) -> dict:
    return {ligne.name: ligne for ligne in lignes}


async def test_un_plan_annuel_est_ramene_au_mois(session: AsyncSession) -> None:
    """La conversion est une règle de facturation, pas une mise en page.

    Laisser l'écran diviser par douze obligerait chaque client à réécrire la
    règle, et l'un d'eux la réécrirait mal.
    """
    annuel = await plan(
        session,
        name="Annuel",
        price_cents=118_800,
        billing_interval=BillingInterval.YEARLY,
    )
    await abonner(session, plan_id=annuel.id, status=SubscriptionStatus.ACTIVE)

    lu = par_nom(await service.lister(session))["Annuel"]

    assert lu.price_cents == 118_800, "le prix affiché reste celui du plan"
    assert lu.mrr_cents == 9_900


async def test_la_mensualisation_arrondit_plutot_que_de_tronquer(session: AsyncSession) -> None:
    """Douze mois de troncature perdent jusqu'à onze centimes par plan.

    Et le total cesse alors d'être vérifiable à la main, ce qui est la seule
    chose qu'on demande à un tableau de revenus.
    """
    assert service.mensualiser(100, BillingInterval.YEARLY) == 8
    assert service.mensualiser(1_100, BillingInterval.YEARLY) == 92
    assert service.mensualiser(9_900, BillingInterval.MONTHLY) == 9_900


async def test_seuls_les_abonnements_qui_courent_font_le_revenu(session: AsyncSession) -> None:
    """Un abonnement résilié n'est pas du revenu récurrent.

    Le compter reviendrait à annoncer un chiffre qui ne baisse jamais.
    """
    p = await plan(session, name="Essentiel", price_cents=9_900)
    await abonner(session, plan_id=p.id, status=SubscriptionStatus.ACTIVE)
    await abonner(session, plan_id=p.id, status=SubscriptionStatus.CANCELED)

    lu = par_nom(await service.lister(session))["Essentiel"]

    assert lu.subscriptions_count == 2, "les deux sont comptés comme abonnés"
    assert lu.active_subscriptions_count == 1
    assert lu.mrr_cents == 9_900


async def test_un_prelevement_en_retard_reste_du_revenu(session: AsyncSession) -> None:
    """La facture n'est pas encaissée, l'abonnement court toujours.

    Le sortir du total ferait apparaître une chute de revenu là où il n'y a
    qu'un prélèvement en retard.
    """
    p = await plan(session, name="Essentiel", price_cents=9_900)
    await abonner(session, plan_id=p.id, status=SubscriptionStatus.PAST_DUE)

    assert par_nom(await service.lister(session))["Essentiel"].mrr_cents == 9_900


async def test_un_plan_sans_abonne_est_rendu_a_zero(session: AsyncSession) -> None:
    """Rendu, pas omis : un plan que personne ne prend est une information."""
    await plan(session, name="Jamais pris")

    lu = par_nom(await service.lister(session))["Jamais pris"]

    assert lu.subscriptions_count == 0
    assert lu.mrr_cents == 0


async def test_la_route_est_reservee_aux_administrateurs(
    client: AsyncClient, session: AsyncSession
) -> None:
    await plan(session)
    comptes = {}
    for role in (UserRole.CREATOR, UserRole.BUSINESS_MEMBER, UserRole.ADMIN):
        comptes[role] = await auth_service.register(
            session,
            email=f"{uuid.uuid4()}@example.com",
            password=MOT_DE_PASSE,
            role=role,
        )
    await session.commit()

    async def entetes(user) -> dict:
        jetons = (
            await client.post(
                f"{PREFIX}/auth/login", json={"email": user.email, "password": MOT_DE_PASSE}
            )
        ).json()
        return {"Authorization": f"Bearer {jetons['access_token']}"}

    for role in (UserRole.CREATOR, UserRole.BUSINESS_MEMBER):
        refuse = await client.get(f"{PREFIX}/admin/plans", headers=await entetes(comptes[role]))
        assert refuse.status_code == 403, role
        assert refuse.json()["detail"] == "insufficient_role"

    accepte = await client.get(
        f"{PREFIX}/admin/plans", headers=await entetes(comptes[UserRole.ADMIN])
    )
    assert accepte.status_code == 200, accepte.text
    assert accepte.json()[0]["price_cents"] == 9900
