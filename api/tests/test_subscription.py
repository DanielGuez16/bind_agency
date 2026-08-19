"""Abonnement du commerce.

Le seul flux d'argent du produit, et il ne concerne jamais un créateur.

Trois propriétés. **Le prix vient de nos données**, pas du fournisseur : deux
sources de tarification divergeraient, et c'est la nôtre qui fait foi. **Un
statut inconnu ne fait pas participer** : dans le doute on ne laisse pas un
commerce donner des prestations sans avoir payé. **Une seule ligne vivante par
commerce** : deux abonnements actifs feraient payer deux fois, et personne ne
s'en apercevrait avant le relevé bancaire.
"""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.billing import (
    AbonnementDistant,
    BillingError,
    ClientDeFacturation,
    LogBillingProvider,
)
from app.models import Subscription, SubscriptionPlan
from app.models.enums import (
    BillingInterval,
    BusinessCategory,
    SubscriptionStatus,
    UserRole,
)
from app.services import subscription as service
from tests.conftest import inscrire_verifie
from tests.test_activation import commerce_en_cours

PREFIX = get_settings().api_v1_prefix
MOT_DE_PASSE = "tourbillon-cactus-91-vermeil"


async def _plan(session: AsyncSession, **overrides) -> SubscriptionPlan:
    plan = SubscriptionPlan(
        category=overrides.pop("category", BusinessCategory.BEAUTY),
        name=overrides.pop("name", "Essentiel"),
        price_cents=overrides.pop("price_cents", 9_900),
        currency="USD",
        billing_interval=overrides.pop("billing_interval", BillingInterval.MONTHLY),
        features={},
        **overrides,
    )
    session.add(plan)
    await session.flush()
    return plan


class FournisseurQuiNote:
    """Un fournisseur qui retient ce qu'on lui a demandé.

    C'est le seul moyen de vérifier que le prix envoyé est le nôtre : un
    fournisseur muet laisserait passer un jour où quelqu'un lirait le prix
    ailleurs.
    """

    def __init__(self, statut: str = "incomplete") -> None:
        self.statut = statut
        self.demandes: list[dict] = []
        #: Un identifiant différent à chaque ouverture, comme le vrai. Un
        #: identifiant figé violerait l'unicité posée en base — laquelle a
        #: raison : deux abonnements distincts chez le fournisseur ne peuvent
        #: pas partager le leur.
        self._rang = 0

    async def creer_le_client(self, *, business_id: str, email: str) -> ClientDeFacturation:
        return ClientDeFacturation(external_id=f"cus_{business_id}")

    async def ouvrir_un_abonnement(
        self, *, customer_id: str, price_cents: int, currency: str, interval: str
    ) -> AbonnementDistant:
        self.demandes.append(
            {"price_cents": price_cents, "currency": currency, "interval": interval}
        )
        self._rang += 1
        return AbonnementDistant(
            external_id=f"sub_essai_{uuid.uuid4()}",
            status=self.statut,
            current_period_end=None,
            checkout_url="https://checkout.test/essai",
        )

    async def resilier(self, *, subscription_id: str) -> AbonnementDistant:
        return AbonnementDistant(
            external_id=subscription_id, status="canceled", current_period_end=None
        )


# --------------------------------------------------------------------------


async def test_le_prix_envoye_est_celui_de_nos_donnees(session: AsyncSession) -> None:
    """La tarification vit dans `subscription_plan`, pas dans le tableau de bord
    du fournisseur. Deux sources divergeraient."""
    business, proprietaire = await commerce_en_cours(session)
    plan = await _plan(session, price_cents=19_900, billing_interval=BillingInterval.YEARLY)
    fournisseur = FournisseurQuiNote()

    await service.souscrire(
        session,
        business=business,
        plan_id=plan.id,
        actor=proprietaire,
        provider=fournisseur,
    )

    assert fournisseur.demandes == [
        # `year`, pas `yearly` : notre vocabulaire est traduit à la frontière,
        # et notre énumération n'est pas renommée pour plaire au fournisseur.
        {"price_cents": 19_900, "currency": "USD", "interval": "year"}
    ]


async def test_le_statut_vient_du_fournisseur(session: AsyncSession) -> None:
    """Un abonnement créé et non payé est `incomplete`.

    Le noter `active` ferait croire à un commerce qu'il participe alors qu'il
    n'a rien réglé.
    """
    business, proprietaire = await commerce_en_cours(session)
    plan = await _plan(session)

    ouvert = await service.souscrire(
        session,
        business=business,
        plan_id=plan.id,
        actor=proprietaire,
        provider=FournisseurQuiNote("incomplete"),
    )

    assert ouvert.subscription.status is SubscriptionStatus.INCOMPLETE
    assert ouvert.checkout_url == "https://checkout.test/essai"


async def test_un_statut_inconnu_ne_fait_pas_participer(session: AsyncSession) -> None:
    """Dans le doute, on ne laisse pas un commerce donner sans avoir payé.

    L'inverse coûterait des prestations offertes contre rien.
    """
    business, proprietaire = await commerce_en_cours(session)
    plan = await _plan(session)

    ouvert = await service.souscrire(
        session,
        business=business,
        plan_id=plan.id,
        actor=proprietaire,
        provider=FournisseurQuiNote("un_statut_que_stripe_inventera"),
    )

    assert ouvert.subscription.status is SubscriptionStatus.INCOMPLETE


async def test_un_seul_abonnement_vivant_par_commerce(session: AsyncSession) -> None:
    """Deux abonnements actifs feraient payer deux fois."""
    business, proprietaire = await commerce_en_cours(session)
    plan = await _plan(session)

    await service.souscrire(
        session,
        business=business,
        plan_id=plan.id,
        actor=proprietaire,
        provider=FournisseurQuiNote("active"),
    )

    with pytest.raises(service.AlreadySubscribed):
        await service.souscrire(
            session,
            business=business,
            plan_id=plan.id,
            actor=proprietaire,
            provider=FournisseurQuiNote("active"),
        )


async def test_un_abonnement_resilie_libere_la_place(session: AsyncSession) -> None:
    """Le pendant : sans lui, un commerce qui a résilié ne pourrait plus jamais
    revenir."""
    business, proprietaire = await commerce_en_cours(session)
    plan = await _plan(session)
    fournisseur = FournisseurQuiNote("active")

    await service.souscrire(
        session, business=business, plan_id=plan.id, actor=proprietaire, provider=fournisseur
    )
    await service.resilier(session, business=business, actor=proprietaire, provider=fournisseur)

    assert await service.courant(session, business_id=business.id) is None
    await service.souscrire(
        session, business=business, plan_id=plan.id, actor=proprietaire, provider=fournisseur
    )


async def test_un_plan_retire_ne_se_souscrit_plus(session: AsyncSession) -> None:
    business, proprietaire = await commerce_en_cours(session)
    plan = await _plan(session, is_active=False)

    with pytest.raises(service.PlanInactive):
        await service.souscrire(
            session,
            business=business,
            plan_id=plan.id,
            actor=proprietaire,
            provider=FournisseurQuiNote(),
        )


async def test_une_panne_du_fournisseur_ne_laisse_rien_derriere(
    session: AsyncSession,
) -> None:
    """Le commerce peut réessayer sans abonnement fantôme."""
    business, proprietaire = await commerce_en_cours(session)
    plan = await _plan(session)

    class Panne(FournisseurQuiNote):
        async def ouvrir_un_abonnement(self, **_):
            raise BillingError("le fournisseur ne répond pas")

    with pytest.raises(BillingError):
        await service.souscrire(
            session, business=business, plan_id=plan.id, actor=proprietaire, provider=Panne()
        )

    assert (
        await session.scalar(
            sa.select(sa.func.count())
            .select_from(Subscription)
            .where(Subscription.business_id == business.id)
        )
    ) == 0


async def test_le_mode_journal_n_offre_aucun_lien_mort() -> None:
    """Offrir une adresse de paiement qui ne mène nulle part serait pire que
    n'en offrir aucune : l'app retire le bouton quand elle n'en reçoit pas."""
    distant = await LogBillingProvider().ouvrir_un_abonnement(
        customer_id="cus_x", price_cents=9_900, currency="USD", interval="month"
    )
    assert distant.checkout_url is None


async def test_la_route_est_isolee_entre_commerces(
    client: AsyncClient, session: AsyncSession
) -> None:
    a, _ = await commerce_en_cours(session)
    b, proprietaire_de_b = await commerce_en_cours(session)
    await _plan(session)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire_de_b.email, "password": MOT_DE_PASSE},
        )
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    refuse = await client.get(f"{PREFIX}/business/{a.id}/subscription", headers=entetes)
    assert refuse.status_code == 403
    assert refuse.json()["detail"] == "not_a_member"

    # Le pendant : sur son propre commerce, `null` et non 404 — ne pas être
    # abonné est un état normal, pas une ressource absente.
    accepte = await client.get(f"{PREFIX}/business/{b.id}/subscription", headers=entetes)
    assert accepte.status_code == 200, accepte.text
    assert accepte.json() is None


async def test_les_plans_offerts_sont_ceux_de_sa_categorie(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Proposer à un salon le plan d'un musée lui demanderait de comprendre une
    tarification qui ne le concerne pas."""
    business, proprietaire = await commerce_en_cours(session)
    await _plan(session, name="Pour salons", category=BusinessCategory.BEAUTY)
    await _plan(session, name="Pour musées", category=BusinessCategory.MUSEUM)
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": proprietaire.email, "password": MOT_DE_PASSE},
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/plans",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 200, reponse.text
    assert [plan["name"] for plan in reponse.json()] == ["Pour salons"]


async def test_un_createur_n_atteint_pas_l_abonnement(
    client: AsyncClient, session: AsyncSession
) -> None:
    business, _ = await commerce_en_cours(session)
    createur = await inscrire_verifie(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password=MOT_DE_PASSE,
        role=UserRole.CREATOR,
    )
    await session.commit()

    jetons = (
        await client.post(
            f"{PREFIX}/auth/login",
            json={"email": createur.email, "password": MOT_DE_PASSE},
        )
    ).json()
    reponse = await client.get(
        f"{PREFIX}/business/{business.id}/subscription",
        headers={"Authorization": f"Bearer {jetons['access_token']}"},
    )

    assert reponse.status_code == 403
    assert reponse.json()["detail"] == "insufficient_role"
