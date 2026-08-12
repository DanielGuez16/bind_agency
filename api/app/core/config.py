"""Configuration de l'API.

Règle dure (CLAUDE.md) : aucune valeur de repli sur un secret. L'absence d'une
variable d'environnement est une erreur de démarrage, jamais un défaut silencieux.
Aucun seuil de palier, aucun prix, aucun délai métier ne vit ici en dur non plus.
"""

import os
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


def fichier_de_configuration() -> str:
    """Le fichier lu, `api/.env` sauf indication contraire.

    **Il remplace le fichier local, il ne s'y ajoute pas.** Viser un autre
    environnement en exportant quelques variables laissait toutes les autres
    retomber sur `api/.env` : une valeur oubliée dans le fichier distant se
    comblait en silence avec celle de la machine, et la commande visait un
    mélange des deux sans que rien ne le dise.

    **Résolu à l'appel, jamais à l'import.** Posé dans une constante de module,
    il était figé avant que quiconque ait pu le choisir : le premier import du
    module — celui d'un autre module d'`app` — décidait pour tout le reste. La
    commande de déploiement affichait alors `environnement : local` en visant
    un fichier `demo`, sans que rien ne le signale.
    """
    return os.environ.get("BIND_ENV_FILE") or str(API_ROOT / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: str = "local"

    #: La base que le jeu de données accepte de détruire, nommée explicitement.
    #:
    #: Exigée sur les environnements dont la base est distante. Le nom de
    #: l'environnement dit ce que la configuration prétend être ; celui-ci dit
    #: ce qu'on vise réellement. Viser autre chose demande alors deux gestes
    #: délibérés au lieu d'un oubli.
    seed_database_name: str | None = None
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

    #: Durée de vie d'un droit de lecture de preuve.
    #:
    #: Courte : l'adresse voyage dans un historique de navigateur et dans le
    #: cache d'images. Assez longue pour afficher ce qu'on vient d'ouvrir, trop
    #: courte pour être transmise utilement.
    proof_read_ttl_seconds: int = 300

    #: Les schémas d'adresse vers lesquels le rappel OAuth accepte de renvoyer.
    #:
    #: Le rappel arrive sur le serveur ; c'est lui qui doit ramener la personne
    #: dans l'application. L'adresse de retour est donc fournie par le client —
    #: et une adresse fournie par le client, suivie sans contrôle, est une
    #: redirection ouverte : de quoi faire aboutir un parcours d'autorisation
    #: sur un site tiers. La liste est donc fermée.
    #:
    #: `exp` est Expo Go, `bind` le schéma de l'application compilée. `https`
    #: n'y est pas : rien n'en a besoin aujourd'hui, et l'ajouter demanderait
    #: une liste d'hôtes, pas seulement de schémas.
    oauth_return_schemes: CommaSeparated = ["exp", "bind"]

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
    #: Les élargissements proposés quand le fil est maigre, en mètres.
    #:
    #: En configuration, comme tout seuil. Le fil ne les propose que s'ils sont
    #: **plus larges** que le rayon courant, et chacun est annoncé avec ce qu'il
    #: rapporterait — « Élargir à 5 km · 9 salons ». Proposer un élargissement
    #: sans son gain reviendrait à faire chercher à l'aveugle, et un gain faux
    #: est pire qu'aucun.
    feed_radius_options_metres: tuple[int, ...] = (3_000, 5_000, 10_000, 25_000)
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

    # Fiabilité. Le score part de cette base et bouge avec les pondérations
    # ci-dessous, bornées à zéro et cent. Aucune valeur en dur dans le code :
    # c'est en observant les premières collaborations qu'on saura ce qu'une
    # absence doit coûter, et l'ajuster ne doit demander qu'un redémarrage.
    # Extraction de carte. `manual` n'extrait rien : le commerce saisit sa
    # carte, ce qui reste le chemin de la phase 2. `vision` exige une clé,
    # vérifiée au démarrage.
    menu_extraction_provider: Literal["manual", "vision"] = "manual"
    menu_extraction_api_key: SecretStr | None = Field(default=None, repr=False)
    menu_extraction_model: str = "claude-sonnet-5"
    menu_extraction_timeout_seconds: float = 60.0

    # Plateformes sociales. `demo` répond de mémoire et n'appelle personne : le
    # mode du développement, des tests et de la démonstration. Il emprunte le
    # même chemin que le vrai — état signé, échange de code, relevé — parce
    # qu'un raccourci ferait croire que le parcours marche alors qu'on ne
    # l'aurait pas parcouru.
    social_provider: Literal["demo", "live"] = "demo"

    # TikTok. En bac à sable tant que l'application n'est pas revue : les
    # identifiants existent, l'audience est limitée aux comptes de test.
    tiktok_client_key: str | None = None
    tiktok_client_secret: SecretStr | None = Field(default=None, repr=False)
    tiktok_redirect_uri: str | None = None
    tiktok_scopes: CommaSeparated = ["user.info.basic", "user.info.stats"]
    #: Le bac à sable de TikTok ne sert que des comptes explicitement inscrits.
    #: Le drapeau ne change aucun appel — il sert à ce que l'écran d'erreur
    #: puisse dire « compte non inscrit au bac à sable » plutôt que « échec ».
    tiktok_sandbox: bool = True

    # Dépôt d'objets. `memory` pour les tests, `local` pour le développement et
    # la démonstration, `s3` non branché — il refuse de démarrer plutôt que de
    # retomber en silence sur le disque.
    object_store_provider: Literal["memory", "local", "s3"] = "memory"
    object_store_local_root: str = "/tmp/bind-objets"

    #: **Deux compartiments, jamais un seul avec un filtre de préfixe.**
    #:
    #: Un compartiment public s'énumère : qui connaît son adresse en liste le
    #: contenu. Ranger les preuves dedans et compter sur l'API pour ne servir
    #: que `photos/` protégerait la route et rien d'autre — le compartiment,
    #: lui, resterait ouvert.
    #:
    #: Les photos de salon et de prestation sont publiques, c'est acté. Les
    #: preuves de publication ne le sont jamais : elles ne se lisent qu'à
    #: travers l'API, par le commerce concerné et par l'administration.
    object_store_bucket_public: str | None = None
    object_store_bucket_prive: str | None = None

    #: Point d'entrée compatible S3. Nul chez AWS, renseigné chez les autres.
    object_store_endpoint: str | None = None
    object_store_region: str = "auto"
    object_store_access_key: str | None = None
    object_store_secret_key: SecretStr | None = Field(default=None, repr=False)

    #: Durée de vie d'une adresse signée de preuve.
    #:
    #: Courte : l'adresse est un droit de lecture transmissible, et elle voyage
    #: dans un historique de navigateur. Assez longue pour ouvrir l'image qu'on
    #: vient de demander, trop courte pour être partagée utilement.
    object_store_signed_url_seconds: int = 300

    # Récupération d'un média depuis une URL publique — niveau 2 de la capture
    # de preuve. Tous les garde-fous sont ici, aucun en dur dans le code : une
    # limite écrite dans une fonction ne se règle pas sans redéploiement.
    proof_fetch_enabled: bool = True
    proof_fetch_timeout_seconds: float = 8.0
    proof_fetch_max_bytes: int = 15 * 1024 * 1024
    proof_fetch_max_redirects: int = 3

    #: Le poids maximal d'une capture téléversée par la créatrice.
    #:
    #: Plus bas que la récupération par URL : celle-ci prend ce que la
    #: plateforme sert, celle-là ce qu'un téléphone produit — et un téléphone
    #: récent produit des images de vingt mégaoctets que personne n'a besoin
    #: d'archiver pour vérifier une mention.
    proof_upload_max_bytes: int = 8 * 1024 * 1024
    proof_fetch_allowed_types: CommaSeparated = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4",
    ]

    # Abonnement commerce. `log` n'appelle personne et trace : le mode du
    # développement et de la démonstration. `stripe` exige une clé de test ou
    # de production, vérifiée au démarrage.
    billing_provider: Literal["log", "stripe"] = "log"
    stripe_secret_key: SecretStr | None = Field(default=None, repr=False)
    stripe_webhook_secret: SecretStr | None = Field(default=None, repr=False)
    stripe_api_timeout_seconds: float = 20.0

    reliability_base_score: int = 70
    #: Poids par type d'événement. Un ajustement est rétroactif : le recalcul
    #: relit l'historique avec la grille du jour.
    reliability_weights: dict[str, Decimal] = Field(
        default_factory=lambda: {
            "collab_completed": Decimal("5"),
            "published_on_time": Decimal("3"),
            "published_late": Decimal("-2"),
            "first_pass_compliant": Decimal("2"),
            "resubmit_required": Decimal("-3"),
            "no_show": Decimal("-25"),
            "unfulfilled": Decimal("-30"),
            "business_rating": Decimal("0"),
            # **Zéro, et il le reste** tant qu'aucun abus réel n'a été observé.
            # Un signalement écarté n'est pas un mensonge : c'est un arbitre qui
            # ne l'a pas retenu, et pénaliser les deux de la même façon
            # découragerait de signaler — ce qui est exactement ce qu'on essaie
            # de rendre possible.
            "abusive_report": Decimal("0"),
        }
    )

    #: Fenêtre pendant laquelle un créateur peut signaler s'être déplacé pour
    #: rien, à compter de l'heure du créneau. Quatre heures : assez pour
    #: rentrer chez soi et y penser, trop court pour que le souvenir se
    #: reconstruise. Au-delà, plus personne ne peut vérifier quoi que ce soit.
    venue_report_window_seconds: int = 4 * 3600

    # Notifications push. `log` n'appelle personne et trace : c'est le mode en
    # service tant qu'aucun compte Expo n'existe. Aucun repli silencieux — un
    # mode inconnu refuse de démarrer.
    push_provider: Literal["log", "expo"] = "log"
    push_timeout_seconds: float = 10.0

    #: Longueur maximale d'une note libre attachée à une décision ou à une
    #: soumission. Cinq cents caractères : de quoi expliquer ce qu'un code ne
    #: dit pas, pas de quoi ouvrir une messagerie par la bande.
    collaboration_note_max_length: int = 500

    # ----------------------------------------------------------------------
    # Lien traqué : mesurer la portée réelle au lieu de la prédire.
    # ----------------------------------------------------------------------
    #: Base MMDB locale pour résoudre une adresse IP en ville. Absente, les
    #: clics sont enregistrés sans géographie plutôt qu'avec une géographie
    #: inventée. **Aucune adresse n'est jamais stockée, avec ou sans base.**
    geoip_database_path: str | None = None
    #: Longueur de l'identifiant court d'un lien. Dix caractères dans un
    #: alphabet de trente-deux font cinquante bits : un lien ne se devine pas,
    #: et il tient dans un sticker de story.
    link_slug_length: int = 10
    #: Où la redirection envoie le visiteur. Sans elle, la route refuse de
    #: rendre une adresse plutôt que d'en inventer une.
    link_redirect_base_url: str | None = None
    #: Fenêtre de déduplication d'une même empreinte. Trente minutes : assez
    #: pour absorber le va-et-vient d'une même personne dans une story, assez
    #: court pour ne pas confondre deux visites d'intention différente.
    #:
    #: C'est **aussi** la durée de vie de l'empreinte et de son sel : passé ce
    #: délai, plus rien ne permet de relier deux clics, même à nous.
    link_click_dedup_seconds: int = 1800
    #: Combien de temps garder les coups écartés — robots, préchargements. Ils
    #: ne comptent dans aucun agrégat ; ils servent à voir une anomalie, et
    #: c'est tout ce qui justifie de les garder un temps.
    link_click_rejected_retention_days: int = 30
    #: Rayon dans lequel un clic est dit « local », en mètres. Trente
    #: kilomètres couvrent l'agglomération de Miami, qui est l'unité qu'un
    #: salon a en tête quand il parle de sa clientèle.
    link_local_radius_metres: int = 30_000
    #: Période de la purge des empreintes. Cinq minutes : la fenêtre de
    #: déduplication est de trente, et une purge plus lente laisserait vivre
    #: des empreintes au-delà de leur seul usage.
    link_click_purge_interval_seconds: int = 300
    #: Poids du score d'impact local. **Zéro, et il le reste** tant qu'aucune
    #: donnée réelle n'a été observée : la mécanique existe, se teste et
    #: s'expose, et ne pèse sur rien. Le jour où elle pèsera, ce sera une
    #: décision prise sur des chiffres, pas un effet de bord de sa livraison.
    local_impact_weight: Decimal = Decimal("0")

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
    # `setdefault` : un appelant qui pose explicitement `_env_file` — les tests
    # qui épinglent leurs propres réglages — garde la main.
    overrides.setdefault("_env_file", fichier_de_configuration())
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
