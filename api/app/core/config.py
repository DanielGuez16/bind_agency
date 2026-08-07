"""Configuration de l'API.

Règle dure (CLAUDE.md) : aucune valeur de repli sur un secret. L'absence d'une
variable d'environnement est une erreur de démarrage, jamais un défaut silencieux.
Aucun seuil de palier, aucun prix, aucun délai métier ne vit ici en dur non plus.
"""

from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

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

    # Travail planifié. Le report croissant plafonné et l'arrêt après un nombre
    # de tentatives sont la seule chose qui empêche un job cassé de marteler la
    # plateforme d'en face jusqu'à ce qu'elle nous bannisse.
    job_max_attempts: int = 5
    job_retry_base_seconds: int = 300
    job_retry_factor: int = 4
    #: Six heures. Un délai qui double indéfiniment finit par ne plus jamais
    #: réessayer, et un compte se réparerait après que le créateur a renoncé.
    job_retry_max_seconds: int = 21_600
    #: Le message d'erreur est tronqué : il sert à comprendre, pas à archiver.
    job_error_max_length: int = 500
    #: Période du relevé de métriques planifié.
    metrics_refresh_interval_seconds: int = 86_400
    #: Marge avant expiration en deçà de laquelle on renouvelle un jeton. Sept
    #: jours : les jetons Meta durent soixante jours, et un renouvellement au
    #: dernier moment ne laisse aucune marge si Meta est indisponible ce jour-là.
    token_refresh_margin_seconds: int = 604_800
    #: Fréquence de repassage du job de renouvellement quand il n'y a rien à
    #: faire — le jeton est encore loin de son échéance.
    token_refresh_interval_seconds: int = 86_400

    # Géocodage. `manual` ne résout rien et rend les coordonnées déclarées :
    # c'est le mode du développement, des tests et du jeu de données, qui n'ont
    # ni clé ni réseau. `geocodio` exige une clé, vérifiée au démarrage.
    geocoding_provider: Literal["manual", "geocodio"] = "manual"
    geocoding_api_key: SecretStr | None = Field(default=None, repr=False)
    #: En deçà, la résolution est refusée comme si elle n'avait rien rendu. Un
    #: commerce placé à quarante kilomètres apparaîtrait dans le mauvais fil, et
    #: l'erreur ne se verrait pas — contrairement à l'absence.
    geocoding_min_accuracy: float = 0.8
    geocoding_timeout_seconds: float = 5.0

    # Réservation.
    #: Horizon au-delà duquel on ne propose plus de créneau. Trente jours : le
    #: catalogue et les horaires d'un commerce bougent, proposer un créneau dans
    #: six mois reviendrait à promettre ce qu'on ne peut pas tenir.
    booking_horizon_days: int = 30
    #: Rayon du fil, en mètres. Dix kilomètres : au-delà, un créateur de Miami
    #: ne se déplace pas pour un soin, et le fil se remplit de bruit.
    feed_radius_metres: int = 10_000
    #: Durée du garde posé à la création. Dix minutes : assez pour confirmer,
    #: assez court pour qu'une place abandonnée revienne vite.
    booking_hold_seconds: int = 600
    #: Fenêtre de validité d'un droit sans créneau. Le créateur se présente
    #: quand il veut avant l'échéance.
    booking_open_validity_days: int = 30
    #: Fenêtre d'annulation sans pénalité avant le créneau. Vingt-quatre heures :
    #: au-delà, le commerce a bloqué un poste qu'il ne remplira plus.
    booking_free_cancellation_seconds: int = 86_400
    #: Période du balayage des gardes dépassés. Deux minutes : le calcul de
    #: disponibilité les ignore déjà à l'échéance, ce balayage ne fait que
    #: mettre l'état en accord avec ce qui est vrai.
    booking_sweep_interval_seconds: int = 120
    #: Rotation du code de retrait. Trente secondes, avec tolérance d'une
    #: fenêtre : le temps qu'un créateur montre son écran et qu'un commerce
    #: scanne, on franchit parfois une frontière.
    redemption_rotation_seconds: int = 30
    #: Essais infructueux tolérés sur un même code avant fermeture. C'est cette
    #: limite qui protège le code de secours, pas sa longueur.
    redemption_max_failed_attempts: int = 5

    # Contrepartie.
    #: Délai de publication après consommation. Vingt-quatre heures : les
    #: stories disparaissent en vingt-quatre heures, et une preuve demandée
    #: après leur mort n'existe plus.
    collaboration_publication_seconds: int = 86_400
    #: Nouveau délai accordé après un refus de conformité. Plus court : le
    #: créateur sait déjà quoi faire, il lui reste à le refaire.
    collaboration_resubmit_seconds: int = 43_200
    #: Tentatives avant que `needs_human_review` se lève.
    collaboration_max_attempts: int = 3
    #: Période du balayage des échéances. Cinq minutes : une échéance dépassée
    #: n'a pas besoin d'être vue à la seconde, mais un créateur qui publie juste
    #: à temps ne doit pas tomber pour un balayage trop paresseux.
    collaboration_sweep_interval_seconds: int = 300

    # Emails transactionnels. `log` n'envoie rien et trace : c'est le mode du
    # développement et des tests. `resend` exige clé et expéditeur, vérifiés au
    # démarrage — pas de repli silencieux.
    email_provider: Literal["log", "resend"] = "log"
    email_api_key: SecretStr | None = Field(default=None, repr=False)
    #: L'expéditeur doit relever d'un domaine vérifié : un transactionnel envoyé
    #: depuis un domaine non authentifié finit en indésirable, et un rappel qui
    #: n'arrive pas vaut un rappel qui n'existe pas.
    email_from: str | None = None
    email_timeout_seconds: float = 10.0
    #: Avance du rappel d'échéance. Six heures : assez tôt pour agir, assez tard
    #: pour que la publication soit encore en ligne.
    collaboration_reminder_lead_seconds: int = 21_600
    #: Période du balayage des rappels. Une heure : un rappel envoyé deux
    #: fois est moins grave qu'un rappel jamais envoyé, mais pas de beaucoup.
    collaboration_reminder_interval_seconds: int = 3_600

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
