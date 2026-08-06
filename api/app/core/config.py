"""Configuration de l'API.

Règle dure (CLAUDE.md) : aucune valeur de repli sur un secret. L'absence d'une
variable d'environnement est une erreur de démarrage, jamais un défaut silencieux.
Aucun seuil de palier, aucun prix, aucun délai métier ne vit ici en dur non plus.
"""

from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import BeforeValidator, Field, PostgresDsn, SecretStr, ValidationError
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Ancré sur `api/` et non sur le répertoire courant : le `.env` doit être trouvé
# quel que soit l'endroit d'où l'on lance uvicorn, pytest ou alembic.
API_ROOT = Path(__file__).resolve().parents[2]


def _split_csv(value: object) -> object:
    """Accepte `a,b` dans le `.env` plutôt que d'imposer un tableau JSON."""
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


# `NoDecode` désactive le json.loads que pydantic-settings applique d'office aux
# champs complexes lus depuis un `.env`, sinon il échoue avant tout validateur.
CommaSeparated = Annotated[list[str], NoDecode, BeforeValidator(_split_csv)]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: str = "local"
    api_v1_prefix: str = "/api/v1"
    cors_origins: CommaSeparated = ["http://localhost:8081", "http://localhost:19006"]

    # Sans valeur par défaut : porte un secret et désigne une base réelle.
    # `repr=False` : l'URL contient le mot de passe, elle n'a rien à faire dans
    # un `repr(settings)` recopié dans un ticket ou un log de mise au point.
    # Le type reste `PostgresDsn`, SQLAlchemy et Alembic en ont besoin tel quel.
    database_url: PostgresDsn = Field(repr=False)

    # `SecretStr` : la valeur ne sort qu'avec `.get_secret_value()`. Une clé de
    # signature qui apparaît dans un repr ou une trace est une clé perdue.
    # Sans valeur par défaut non plus : une clé de repli serait une clé connue,
    # donc pas une clé.
    jwt_secret_key: SecretStr
    jwt_algorithm: str = "HS256"

    # Durées de vie des jetons, en configuration comme tout délai.
    # Accès court, rafraîchissement long et révocable côté serveur.
    access_token_ttl_seconds: int = 900
    refresh_token_ttl_seconds: int = 2_592_000

    # `SecretStr` et sans valeur de repli, même traitement que la clé de
    # signature : une clé de chiffrement de repli serait une clé connue.
    token_encryption_key: SecretStr
    # Écrit dans chaque valeur chiffrée. Changer de clé revient à ajouter la
    # nouvelle, déplacer cet identifiant, et laisser l'ancienne au trousseau le
    # temps qu'un travail de fond réécrive les valeurs.
    token_encryption_key_id: str = "v1"
    # Clés encore acceptées en déchiffrement, format « identifiant:clé ».
    token_encryption_previous_keys: CommaSeparated = []

    # Durée de vie de l'état OAuth. Court : c'est le temps d'aller autoriser et
    # de revenir, pas celui d'une session.
    oauth_state_ttl_seconds: int = 600

    # Application Meta. Facultatives : l'API doit pouvoir démarrer sans elles —
    # l'absence n'est pas un repli, le fournisseur refuse simplement de servir.
    instagram_app_id: str | None = None
    instagram_app_secret: SecretStr | None = Field(default=None, repr=False)
    instagram_redirect_uri: str | None = None
    instagram_scopes: CommaSeparated = ["instagram_business_basic"]

    # Au-delà de cet âge, un relevé de métriques ne donne plus accès à rien.
    # Le rafraîchissement est quotidien : sept jours veut dire que plusieurs
    # passages ont échoué, et une éligibilité calculée sur de vieux chiffres
    # n'est pas une éligibilité. Valeur unique, la même sur toutes les
    # plateformes — le job est le même partout.
    metrics_max_age_seconds: int = 604_800
    #: Deux relevés d'un même compte ne peuvent pas être plus rapprochés. Le
    #: quota de la plateforme se compte par compte, la limite aussi.
    metrics_min_refresh_interval_seconds: int = 3_600

    # Seuils de la vérification de cohérence, SPEC.md §3.2. Aucun n'est en dur
    # dans le code : ce sont eux qu'on ajustera en voyant la file se remplir.
    #: En dessous, le compte n'a pas encore montré grand-chose.
    verification_min_media_count: int = 12
    #: Beaucoup d'abonnés pour très peu de publications : signature du compte acheté.
    verification_max_followers_per_media: int = 2_000
    #: Fenêtre sur laquelle se juge la régularité de publication.
    verification_regularity_window_days: int = 21
    #: Publications attendues sur cette fenêtre.
    verification_min_media_in_window: int = 1
    #: Engagement aberrant dans un sens comme dans l'autre : abonnés achetés en
    #: dessous, pod d'engagement au-dessus.
    verification_min_engagement_rate: Decimal = Decimal("0.005")
    verification_max_engagement_rate: Decimal = Decimal("0.25")

    # Lue uniquement par la session pytest, jamais par l'application.
    # Sa présence est vérifiée dans tests/conftest.py, qui refuse de tourner sans.
    test_database_url: PostgresDsn | None = Field(default=None, repr=False)


class ConfigurationError(RuntimeError):
    """Configuration invalide.

    Ne cite jamais les valeurs reçues, seulement les champs en cause. Une trace
    de démarrage finit toujours collée dans un ticket ou une conversation.
    """


def _describe(error: ValidationError) -> str:
    """Nomme les champs fautifs et la nature du défaut, sans leur contenu.

    On lit `loc` et `type`, jamais `input` ni `msg` : le premier porte la valeur
    reçue, le second peut la citer selon le validateur.
    """
    problems = sorted(
        f"{'.'.join(str(part) for part in item['loc'])} ({item['type']})" for item in error.errors()
    )
    return (
        "Configuration invalide. Champs en cause : "
        + ", ".join(problems)
        + ". Voir api/.env.example. Les valeurs reçues ne sont pas affichées, "
        "volontairement."
    )


def build_settings(**overrides: object) -> Settings:
    try:
        return Settings(**overrides)  # type: ignore[arg-type]
    except ValidationError as error:
        # `from None` est le cœur du masquage : sans lui, la ValidationError
        # d'origine reste chaînée et son affichage recrache le dictionnaire
        # d'entrée, valeurs comprises.
        raise ConfigurationError(_describe(error)) from None


@lru_cache
def get_settings() -> Settings:
    return build_settings()
