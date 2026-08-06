"""Interface commune aux plateformes sociales.

`SPEC.md` §5.1 prévoit quatre opérations : `authorize`, `refresh`,
`fetch_profile_metrics`, `fetch_media`. Seules celles dont cette tâche a besoin
sont déclarées ici — les autres arriveront avec la leur, avec la connaissance de
ce qu'elles doivent vraiment porter.

Le reste du système ne connaît que cette interface, jamais un réseau.

**Deux familles d'échec, pas une.** L'appelant ne peut pas réagir pareil à
« la plateforme nous a refusé le jeton » et à « la plateforme n'a pas répondu ».
Le premier est définitif et se règle en reconnectant le compte, le second passe
tout seul. C'est au fournisseur de trancher, parce que lui seul lit la réponse ;
plus haut, il ne resterait qu'un code HTTP à interpréter à l'aveugle.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

from app.models.enums import Platform


class SocialProviderError(Exception):
    """L'échange n'a pas abouti, mais rien ne dit que le compte est en cause.

    Réseau coupé, plateforme en panne, réponse illisible : c'est passager, on
    réessaiera. Aucun état local ne change.
    """


class SocialAuthError(SocialProviderError):
    """La plateforme a refusé notre jeton : révoqué, expiré, ou périmé.

    Réessayer ne servira à rien tant que le créateur n'aura pas reconnecté son
    compte. Hérite de `SocialProviderError` pour qu'un appelant qui ne fait pas
    la distinction reste correct — il traite juste le cas moins finement.
    """


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


@dataclass(frozen=True, slots=True)
class MetriquesProfil:
    """Ce qu'une lecture de profil rapporte, et rien d'autre.

    Les trois compteurs sont obligatoires parce que la table les déclare
    obligatoires : mettre zéro pour « je ne sais pas » inventerait un chiffre
    que personne ne pourrait distinguer d'un vrai. Ce qui est nullable en base
    l'est ici aussi, et peut donc manquer sans empêcher d'enregistrer.

    `avg_views` et `engagement_rate` n'y figurent pas : ils se calculent sur les
    publications, pas sur le profil. Ils viendront avec `fetch_media`.
    """

    followers_count: int
    following_count: int
    media_count: int
    #: Répartition de l'audience, quand la plateforme la donne.
    audience_demographics: dict | None
    #: Conservé tel quel : quand un chiffre surprendra, c'est la seule preuve
    #: de ce que la plateforme a réellement répondu ce jour-là.
    raw_payload: dict


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

    async def refresh_token(
        self, *, access_token: str, refresh_token: str | None = None
    ) -> JetonEchange:
        """Repousse l'échéance du jeton, avant qu'elle n'arrive.

        Les deux paramètres parce que les plateformes ne s'accordent pas :
        Meta renouvelle le jeton d'accès avec lui-même, d'autres exigent un
        jeton de renouvellement distinct. Un seul paramètre obligerait la
        moitié des implémentations à mentir sur ce qu'elles reçoivent.

        Lève `SocialAuthError` si la plateforme refuse le jeton — il n'y a plus
        rien à renouveler — et `SocialProviderError` pour tout le reste.
        """
        ...

    async def fetch_profile_metrics(
        self, access_token: str, *, external_id: str
    ) -> MetriquesProfil:
        """Les chiffres du profil à l'instant de l'appel.

        Lève `SocialAuthError` si la plateforme refuse le jeton,
        `SocialProviderError` pour tout le reste. Ne rend jamais un résultat
        partiel : sans les compteurs obligatoires, c'est une erreur, pas un
        objet à moitié rempli.
        """
        ...
