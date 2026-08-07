"""Abonnement du commerce, derrière une interface.

**Stripe est le seul flux d'argent du produit**, et il ne touche jamais un
créateur : un commerce paie son abonnement, rien d'autre ne circule. Aucune
table ne porte de solde, aucun transfert n'existe entre deux utilisateurs.

Deux implémentations. `log` n'appelle personne et trace ce qu'elle aurait fait —
le mode du développement et de la démonstration, où l'on veut voir un abonnement
naître, se renouveler et se résilier sans compte marchand. `stripe` parle à
l'API réelle avec une clé de test ou de production.

**Le mode test de Stripe fonctionne sans entité juridique.** C'est ce qui permet
de brancher le vrai flux dès maintenant : les clés `sk_test_...` s'obtiennent
sans société, les cartes de test existent, et les webhooks se rejouent. Ce qui
attend l'entité, c'est le passage en production — une clé à changer, pas un
code à écrire.

**Les montants sont en centimes entiers, partout.** La conversion en somme
lisible se fait à l'affichage et sur un seul écran.
"""

import logging
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx

from app.core.config import get_settings

logger = logging.getLogger("bind.billing")


class BillingError(Exception):
    """L'opération de facturation n'a pas abouti."""


class BillingUnavailable(BillingError):
    """Le fournisseur déclaré n'est pas utilisable."""


@dataclass(frozen=True, slots=True)
class ClientDeFacturation:
    """Le commerce, chez le fournisseur. Aucune donnée bancaire ne transite ici."""

    external_id: str


@dataclass(frozen=True, slots=True)
class AbonnementDistant:
    external_id: str
    status: str
    #: Fin de la période en cours, en ISO 8601. `None` tant que le fournisseur
    #: ne l'a pas fixée — un abonnement créé et non payé n'en a pas.
    current_period_end: str | None
    #: L'adresse où le commerce va saisir sa carte. Le produit ne la voit
    #: jamais : c'est le fournisseur qui la collecte, et c'est le seul moyen de
    #: ne pas avoir à la protéger.
    checkout_url: str | None = None


@runtime_checkable
class BillingProvider(Protocol):
    async def creer_le_client(self, *, business_id: str, email: str) -> ClientDeFacturation: ...

    async def ouvrir_un_abonnement(
        self, *, customer_id: str, price_cents: int, currency: str, interval: str
    ) -> AbonnementDistant: ...

    async def resilier(self, *, subscription_id: str) -> AbonnementDistant: ...


class LogBillingProvider:
    """N'appelle personne, trace tout. Le mode du développement et de la démo.

    Ce n'est pas un repli silencieux : c'est le mode déclaré par
    `BILLING_PROVIDER=log`, et les identifiants qu'il rend sont reconnaissables
    — personne ne les prendra pour de vrais identifiants Stripe en lisant une
    base.
    """

    async def creer_le_client(self, *, business_id: str, email: str) -> ClientDeFacturation:
        logger.info("client de facturation non créé (mode journal) : commerce=%s", business_id)
        return ClientDeFacturation(external_id=f"cus_journal_{business_id}")

    async def ouvrir_un_abonnement(
        self, *, customer_id: str, price_cents: int, currency: str, interval: str
    ) -> AbonnementDistant:
        logger.info(
            "abonnement non ouvert (mode journal) : client=%s montant=%s %s / %s",
            customer_id,
            price_cents,
            currency,
            interval,
        )
        return AbonnementDistant(
            external_id=f"sub_journal_{customer_id}",
            status="active",
            current_period_end=None,
            # Aucune URL : offrir un lien mort serait pire que n'en offrir
            # aucun. L'app retire le bouton quand elle n'en reçoit pas.
            checkout_url=None,
        )

    async def resilier(self, *, subscription_id: str) -> AbonnementDistant:
        logger.info("abonnement non résilié (mode journal) : %s", subscription_id)
        return AbonnementDistant(
            external_id=subscription_id, status="canceled", current_period_end=None
        )


class StripeProvider:
    """L'API réelle, en test comme en production — c'est la clé qui décide.

    Écrit contre l'API HTTP plutôt que contre le SDK : une dépendance de moins,
    et trois appels ne justifient pas d'en ajouter une.
    """

    BASE = "https://api.stripe.com/v1"

    def __init__(self, client: httpx.AsyncClient) -> None:
        settings = get_settings()
        if settings.stripe_secret_key is None:
            raise BillingUnavailable("BILLING_PROVIDER=stripe sans STRIPE_SECRET_KEY")
        self._cle = settings.stripe_secret_key.get_secret_value()
        self._client = client
        self._delai = settings.stripe_api_timeout_seconds

    async def _poster(self, chemin: str, donnees: dict[str, str]) -> dict:
        try:
            reponse = await self._client.post(
                f"{self.BASE}{chemin}",
                data=donnees,
                auth=(self._cle, ""),
                timeout=self._delai,
            )
        except httpx.HTTPError as error:
            raise BillingError(str(error)) from error

        if reponse.status_code >= 400:
            # Le message de Stripe n'est pas rendu à l'appelant : il contient
            # des identifiants internes et n'est pas traduit.
            logger.warning("stripe %s : %s", reponse.status_code, reponse.text[:300])
            raise BillingError(f"stripe {reponse.status_code}")
        return reponse.json()

    async def creer_le_client(self, *, business_id: str, email: str) -> ClientDeFacturation:
        corps = await self._poster(
            "/customers", {"email": email, "metadata[business_id]": business_id}
        )
        return ClientDeFacturation(external_id=corps["id"])

    async def ouvrir_un_abonnement(
        self, *, customer_id: str, price_cents: int, currency: str, interval: str
    ) -> AbonnementDistant:
        # Le prix est créé à la volée depuis nos données : la tarification vit
        # dans `subscription_plan`, pas dans le tableau de bord Stripe. Deux
        # sources de prix divergeraient, et c'est la nôtre qui fait foi.
        corps = await self._poster(
            "/subscriptions",
            {
                "customer": customer_id,
                "items[0][price_data][currency]": currency.lower(),
                "items[0][price_data][product_data][name]": "BIND",
                "items[0][price_data][unit_amount]": str(price_cents),
                "items[0][price_data][recurring][interval]": interval,
                "payment_behavior": "default_incomplete",
            },
        )
        return AbonnementDistant(
            external_id=corps["id"],
            status=corps.get("status", "incomplete"),
            current_period_end=_iso(corps.get("current_period_end")),
        )

    async def resilier(self, *, subscription_id: str) -> AbonnementDistant:
        corps = await self._poster(
            f"/subscriptions/{subscription_id}", {"cancel_at_period_end": "true"}
        )
        return AbonnementDistant(
            external_id=corps["id"],
            status=corps.get("status", "canceled"),
            current_period_end=_iso(corps.get("current_period_end")),
        )


def _iso(horodatage: int | None) -> str | None:
    """Stripe rend des secondes Unix. On rend de l'ISO, comme partout ailleurs."""
    if horodatage is None:
        return None
    from datetime import UTC, datetime

    return datetime.fromtimestamp(horodatage, tz=UTC).isoformat()


def get_billing_provider(client: httpx.AsyncClient | None = None) -> BillingProvider:
    settings = get_settings()
    if settings.billing_provider == "log":
        return LogBillingProvider()
    if client is None:
        raise BillingUnavailable("le fournisseur Stripe demande un client HTTP")
    return StripeProvider(client)


def check_billing_configuration() -> None:
    """Refuse de démarrer plutôt que d'échouer au premier abonnement.

    Découvrir la clé manquante au moment où un commerce paie signifierait un
    commerce bloqué à l'inscription, et personne pour le voir avant lui.
    """
    settings = get_settings()
    if settings.billing_provider == "stripe" and settings.stripe_secret_key is None:
        raise BillingUnavailable(
            "BILLING_PROVIDER=stripe sans STRIPE_SECRET_KEY : "
            "l'abonnement ne pourrait pas être ouvert."
        )
