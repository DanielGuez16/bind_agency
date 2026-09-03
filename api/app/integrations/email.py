"""Envoi d'emails transactionnels.

**Le reste du système ne connaît que cette interface, jamais un fournisseur.**
Le même raisonnement que pour le géocodage et les plateformes sociales : le jour
où l'on change de service d'envoi, un seul fichier bouge.

**Aucun envoi ne fait échouer ce qui l'a déclenché.** Un rappel d'échéance qui
ne part pas ne doit pas annuler la transition qui l'a provoqué : le créateur
préfère une contrepartie correctement ouverte sans email à un email parfait sur
une contrepartie qui n'existe pas. Les envois passent donc par la file de jobs,
avec son report et son épuisement.

**En développement, rien ne part.** `LogEmailSender` écrit dans le journal
d'exploitation. Ce n'est pas un repli silencieux : c'est le mode déclaré par
`EMAIL_PROVIDER`, et demander un fournisseur réel sans clé empêche de démarrer.
"""

import logging
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx

from app.core.config import ConfigurationError, get_settings
from app.models.enums import Locale

logger = logging.getLogger(__name__)


class EmailError(Exception):
    """L'envoi n'a pas abouti. Toujours transitoire du point de vue de l'appelant."""


@dataclass(frozen=True, slots=True)
class Message:
    destinataire: str
    sujet: str
    corps: str
    locale: Locale
    #: Le même message, mis en forme par `app.services.email_render`. `None`
    #: reste possible — un appelant qui n'a pas encore de gabarit HTML pour ce
    #: message envoie du texte seul, jamais une exception.
    corps_html: str | None = None


@runtime_checkable
class EmailSender(Protocol):
    async def envoyer(self, message: Message) -> None:
        """Lève `EmailError` si l'envoi échoue. Ne rend rien : il n'y a pas de
        demi-envoi."""
        ...


class LogEmailSender:
    """N'envoie rien, trace tout. Le mode du développement et des tests."""

    async def envoyer(self, message: Message) -> None:
        logger.info(
            "email non envoyé (mode journal) : à=%s sujet=%s locale=%s",
            message.destinataire,
            message.sujet,
            message.locale.value,
        )


RESEND = "https://api.resend.com/emails"


class ResendSender:
    """Resend : facturation à l'usage, domaine à vérifier, pas d'abonnement.

    Le domaine vérifié n'est pas une formalité : un email transactionnel envoyé
    depuis un domaine non authentifié finit en indésirable, et un rappel
    d'échéance qui n'arrive pas vaut un rappel qui n'existe pas.
    """

    def __init__(self, client: httpx.AsyncClient) -> None:
        settings = get_settings()
        if settings.email_api_key is None or not settings.email_from:
            raise ConfigurationError("EMAIL_PROVIDER=resend exige EMAIL_API_KEY et EMAIL_FROM")

        self._client = client
        self._cle = settings.email_api_key.get_secret_value()
        self._expediteur = settings.email_from
        self._delai = httpx.Timeout(settings.email_timeout_seconds)

    async def envoyer(self, message: Message) -> None:
        charge = {
            "from": self._expediteur,
            "to": [message.destinataire],
            "subject": message.sujet,
            "text": message.corps,
        }
        # **Les deux, quand le gabarit HTML existe.** Le texte reste dans
        # tous les cas : un client qui ne rend pas le HTML — un lecteur
        # d'écran, un filtre d'entreprise — retombe dessus, et Resend l'exige
        # de toute façon comme repli.
        if message.corps_html is not None:
            charge["html"] = message.corps_html

        try:
            reponse = await self._client.post(
                RESEND,
                headers={"Authorization": f"Bearer {self._cle}"},
                json=charge,
                timeout=self._delai,
            )
        except httpx.HTTPError as error:
            raise EmailError(f"service d'envoi injoignable : {type(error).__name__}") from error

        if reponse.status_code >= 400:
            # Le message du fournisseur n'est pas renvoyé : il parle de son API,
            # et peut contenir l'adresse du destinataire.
            raise EmailError(f"service d'envoi a répondu {reponse.status_code}")


def get_sender(client: httpx.AsyncClient | None = None) -> EmailSender:
    """Le fournisseur déclaré en configuration. Pas de repli silencieux."""
    settings = get_settings()
    if settings.email_provider != "resend":
        return LogEmailSender()

    if client is None:
        raise ConfigurationError("un client HTTP est requis pour EMAIL_PROVIDER=resend")
    return ResendSender(client)


def check_email_configuration() -> None:
    """Appelé au démarrage. Découvrir la clé manquante au premier rappel
    d'échéance signifierait des créateurs qui ne reçoivent rien, et personne
    pour s'en apercevoir avant que les dossiers tombent en non honoré."""
    settings = get_settings()
    if settings.email_provider == "resend" and (
        settings.email_api_key is None or not settings.email_from
    ):
        raise ConfigurationError("EMAIL_PROVIDER=resend exige EMAIL_API_KEY et EMAIL_FROM")
