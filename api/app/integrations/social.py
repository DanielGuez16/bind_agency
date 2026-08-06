"""Interface commune aux plateformes sociales.

`SPEC.md` §5.1 prévoit quatre opérations : `authorize`, `refresh`,
`fetch_profile_metrics`, `fetch_media`. Seules celles dont cette tâche a besoin
sont déclarées ici — les autres arriveront avec la leur, avec la connaissance de
ce qu'elles doivent vraiment porter.

Le reste du système ne connaît que cette interface, jamais un réseau.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

from app.models.enums import Platform


class SocialProviderError(Exception):
    """L'échange avec la plateforme n'a pas abouti."""


@dataclass(frozen=True, slots=True)
class JetonEchange:
    access_token: str
    #: Meta délivre des jetons de longue durée à échéance connue. Une plateforme
    #: qui n'en donnerait pas laisse ce champ nul.
    expires_at: datetime | None = None
    refresh_token: str | None = None


@dataclass(frozen=True, slots=True)
class IdentiteSociale:
    """Le strict nécessaire pour rattacher le compte.

    Ce n'est pas de la métrique : sans identifiant ni pseudonyme, il n'y a
    simplement rien à enregistrer. Les abonnés et les vues sont la tâche
    suivante.
    """

    external_id: str
    handle: str


@runtime_checkable
class SocialProvider(Protocol):
    platform: Platform

    def authorization_url(self, *, state: str) -> str:
        """URL vers laquelle envoyer le créateur pour qu'il autorise."""
        ...

    async def exchange_code(self, code: str) -> JetonEchange:
        """Transforme le code de retour en jeton utilisable."""
        ...

    async def fetch_identity(self, access_token: str) -> IdentiteSociale:
        """Qui est ce compte. Rien de plus."""
        ...
