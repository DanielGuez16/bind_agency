"""Énumérations applicatives.

Toutes rendues en `VARCHAR` + `CHECK`, jamais en type ENUM natif Postgres.
Les valeurs stockées sont celles écrites ici, pas les noms des membres.
"""

from enum import StrEnum


class UserRole(StrEnum):
    CREATOR = "creator"
    BUSINESS_MEMBER = "business_member"
    ADMIN = "admin"


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    ANONYMIZED = "anonymized"


class Locale(StrEnum):
    EN = "en"
    ES = "es"


class Platform(StrEnum):
    INSTAGRAM = "instagram"
    TIKTOK = "tiktok"
    SNAPCHAT = "snapchat"
    YOUTUBE = "youtube"


class SocialAccountStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"


class VerificationStatus(StrEnum):
    """Résultat du contrôle de cohérence de SPEC.md §3.2."""

    VERIFIED = "verified"
    NEEDS_REVIEW = "needs_review"
    REJECTED = "rejected"


class BusinessCategory(StrEnum):
    BEAUTY = "beauty"
    RESTAURANT = "restaurant"
    MUSEUM = "museum"
    FITNESS = "fitness"
    FAMILY_ACTIVITY = "family_activity"
    OTHER = "other"


class BusinessStatus(StrEnum):
    ONBOARDING = "onboarding"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class BusinessMemberRole(StrEnum):
    OWNER = "owner"
    STAFF = "staff"


class BillingInterval(StrEnum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class SubscriptionStatus(StrEnum):
    #: Créé chez le fournisseur, pas encore payé. C'est l'état par défaut d'un
    #: abonnement Stripe ouvert en `default_incomplete`, et c'est aussi celui
    #: qu'on retient quand le fournisseur rend un statut qu'on ne connaît pas :
    #: dans le doute, on ne fait pas participer un commerce qui n'a peut-être
    #: pas payé.
    INCOMPLETE = "incomplete"
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"


class CatalogItemSource(StrEnum):
    MANUAL = "manual"
    IMPORT = "import"


class MenuImportStatus(StrEnum):
    UPLOADED = "uploaded"
    EXTRACTED = "extracted"
    UNDER_REVIEW = "under_review"
    VALIDATED = "validated"
    FAILED = "failed"


class ContentFormat(StrEnum):
    STORY = "story"
    POST = "post"
    REEL = "reel"


class BookingStatus(StrEnum):
    HELD = "held"
    #: Le créateur a confirmé, le commerce n'a pas encore tranché.
    #:
    #: La place reste tenue pendant ce temps : la relâcher permettrait de la
    #: vendre deux fois pendant que le commerce regarde le profil.
    AWAITING_BUSINESS = "awaiting_business"
    CONFIRMED = "confirmed"
    CONSUMED = "consumed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    EXPIRED = "expired"


class CollaborationStatus(StrEnum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    RESUBMIT_REQUESTED = "resubmit_requested"
    UNFULFILLED = "unfulfilled"


class CaptureMethod(StrEnum):
    """Niveau de capture de preuve, du plus fiable au moins fiable."""

    API = "api"
    URL_FETCH = "url_fetch"
    UPLOAD = "upload"


class ReliabilityEventType(StrEnum):
    COLLAB_COMPLETED = "collab_completed"
    PUBLISHED_ON_TIME = "published_on_time"
    PUBLISHED_LATE = "published_late"
    FIRST_PASS_COMPLIANT = "first_pass_compliant"
    RESUBMIT_REQUIRED = "resubmit_required"
    NO_SHOW = "no_show"
    UNFULFILLED = "unfulfilled"
    BUSINESS_RATING = "business_rating"
    #: Un signalement de déplacement pour rien, écarté par l'arbitrage.
    #:
    #: **Son poids vaut zéro**, et le restera tant qu'on n'aura pas vu de vrais
    #: abus. Le mécanisme existe pour que la décision se prenne sur des
    #: chiffres — pas pour punir dès le premier jour quelqu'un dont le
    #: signalement n'a pas été retenu, ce qui n'est pas la même chose qu'un
    #: mensonge.
    ABUSIVE_REPORT = "abusive_report"


class VenueReportStatus(StrEnum):
    """Ce qu'est devenu un signalement de déplacement pour rien.

    **Un signalement est une allégation, jamais un verdict.** Tant qu'il est
    `pending`, il ne compte contre personne : ni contre le salon, qui n'a pas
    été entendu, ni contre le créateur, qui n'a fait que dire ce qu'il a vu.
    C'est l'arbitrage qui tranche, comme pour les contreparties.
    """

    PENDING = "pending"
    #: Le salon n'a pas honoré. Compté contre lui, jamais contre le créateur.
    CONFIRMED = "confirmed"
    #: Écarté. Ne prouve pas le mensonge — seulement que l'arbitre n'a pas
    #: retenu le signalement.
    REJECTED = "rejected"


class ActorKind(StrEnum):
    SYSTEM = "system"
    CREATOR = "creator"
    BUSINESS_MEMBER = "business_member"
    ADMIN = "admin"


class CatalogItemAvailability(StrEnum):
    """État logique d'un item, déduit de `is_available`.

    Aucune colonne ne le porte : il n'existe que comme vocabulaire du journal
    d'audit, qui doit nommer les états qu'il décrit.
    """

    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"


class TierOfferState(StrEnum):
    """État logique d'une offre, déduit de `is_active`. Vocabulaire du journal."""

    ACTIVE = "active"
    INACTIVE = "inactive"


class TierState(StrEnum):
    """État logique d'un palier, déduit de `is_active`.

    Aucune colonne ne le porte : vocabulaire du journal d'audit uniquement.
    """

    ACTIVE = "active"
    INACTIVE = "inactive"


class RefreshTokenState(StrEnum):
    """État logique d'un jeton de rafraîchissement.

    Aucune colonne ne le porte : il se déduit de `revoked_at`. Il n'existe que
    comme vocabulaire du journal d'audit, qui doit nommer les états qu'il décrit.
    """

    ISSUED = "issued"
    REVOKED = "revoked"


class JobType(StrEnum):
    """Chaque type nomme un traitement, jamais une cible.

    « Renouveler le jeton d'un compte », pas « compte social » : c'est le
    traitement qui décide quoi lire, et deux traitements peuvent viser la même
    ligne sans se gêner.
    """

    TOKEN_REFRESH = "token_refresh"
    METRICS_REFRESH = "metrics_refresh"
    #: Balayage global, sans cible propre : sa `target_id` est un identifiant
    #: fixe. Un job par réservation coûterait une ligne par place tenue.
    BOOKING_HOLD_SWEEP = "booking_hold_sweep"
    #: Échéances de publication dépassées. Balayage global lui aussi.
    COLLABORATION_DEADLINE_SWEEP = "collaboration_deadline_sweep"
    #: Rappels d'échéance de publication. Balayage global.
    COLLABORATION_REMINDER_SWEEP = "collaboration_reminder_sweep"
    #: Efface les empreintes de clic échues, leur sel, et les coups écartés
    #: trop vieux. Balayage global. **C'est ce job qui rend l'oubli réel** :
    #: sans lui, la promesse de purge ne serait qu'une fonction que personne
    #: n'appelle.
    LINK_CLICK_PURGE_SWEEP = "link_click_purge_sweep"


class JobStatus(StrEnum):
    """Deux états, pas trois.

    Il n'y a pas d'état « en cours » : un job réclamé l'est par un verrou de
    ligne, qui disparaît si le processus meurt. Un état stocké, lui, resterait
    coincé.
    """

    PENDING = "pending"
    #: Abandonné après le nombre de tentatives autorisé. Ne repartira pas seul :
    #: il attend un administrateur. Un job qui échoue en silence pour toujours
    #: est pire qu'un job qui n'existe pas.
    EXHAUSTED = "exhausted"


class DeviceFamily(StrEnum):
    """Famille de terminal, déduite de l'agent utilisateur.

    Trois familles et un repli, pas davantage. Un agent utilisateur ne dit pas
    de façon fiable le modèle, la version ni la marque, et prétendre le
    contraire produirait une statistique fausse. Ce qu'on veut savoir tient
    dans la question : est-ce qu'on lit depuis un téléphone.
    """

    MOBILE = "mobile"
    TABLET = "tablet"
    DESKTOP = "desktop"
    #: Ni l'un ni l'autre, ou rien d'exploitable. Se dit plutôt que de ranger
    #: d'office dans « bureau », qui gonflerait la famille la moins probable.
    UNKNOWN = "unknown"


class ClickOutcome(StrEnum):
    """Ce qu'on a fait d'un passage sur un lien.

    Un seul de ces états entre dans les agrégats. Les autres existent pour dire
    **pourquoi** un passage n'a pas compté : un compteur qui descend sans
    explication se lit comme une panne, et la forme des rejets est le principal
    signal d'une campagne fabriquée.
    """

    #: Compté. Le seul qui figure dans un agrégat.
    COUNTED = "counted"
    #: Agent utilisateur de robot déclaré. Ce n'est pas une accusation : la
    #: plupart s'annoncent honnêtement.
    BOT = "bot"
    #: Préchargement du navigateur ou de la plateforme. Personne n'a cliqué —
    #: c'est un aperçu fabriqué pour aller plus vite.
    PREFETCH = "prefetch"
    #: Même empreinte, même lien, dans la fenêtre de déduplication.
    DUPLICATE = "duplicate"


class DevicePlatform(StrEnum):
    """Sur quoi tourne le terminal qui a donné son jeton.

    Rendu par l'app, pas déduit : Expo distingue déjà les trois, et le déduire
    d'un jeton reviendrait à lire un format qui ne nous appartient pas.
    """

    IOS = "ios"
    ANDROID = "android"
    WEB = "web"


class DeviceTokenStatus(StrEnum):
    """Deux états, comme un jeton social — et pour la même raison.

    Un jeton de terminal se révoque : l'application est désinstallée, les
    notifications sont coupées dans les réglages du téléphone, ou Expo répond
    que le terminal n'est plus enregistré. Il ne se supprime pas, il se marque
    — sinon le même jeton se réinscrirait à la première ouverture et on ne
    saurait jamais qu'il avait cessé de valoir.
    """

    ACTIVE = "active"
    REVOKED = "revoked"


class NotificationKind(StrEnum):
    """Les sept événements qui méritent de sortir de l'application.

    **Fermée, et c'est le point.** Chaque valeur est une préférence que
    quelqu'un peut couper ; une liste ouverte ferait apparaître des
    notifications qu'on n'aurait jamais proposé de refuser.

    Six s'adressent au créateur, la dernière au commerce. C'est la seule qui
    remonte dans l'autre sens, et elle manquait le plus : un salon ne savait
    qu'une réservation attendait sa décision qu'en ouvrant l'application.
    """

    #: Le salon a accepté. La place est tenue, le code existe.
    BOOKING_APPROVED = "booking_approved"
    #: Le salon a refusé, avec son motif.
    BOOKING_DECLINED = "booking_declined"
    #: Le salon s'est désisté après avoir accepté. Ne dégrade jamais le score.
    BOOKING_CANCELLED_BY_BUSINESS = "booking_cancelled_by_business"
    #: L'échéance de publication approche.
    PUBLICATION_REMINDER = "publication_reminder"
    #: La publication est acceptée. La collaboration est close, du bon côté.
    PUBLICATION_APPROVED = "publication_approved"
    #: Une nouvelle soumission est demandée, avec son motif et sa note.
    PUBLICATION_RESUBMIT = "publication_resubmit"
    #: **Côté commerce.** Une réservation attend sa décision.
    BOOKING_TO_REVIEW = "booking_to_review"
