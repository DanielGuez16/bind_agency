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


class Neighborhood(StrEnum):
    """Les quartiers de Miami où BIND ouvre.

    **Une liste fermée, et déclarée par le commerce.** Le géocodeur ne rend que
    des coordonnées — l'adaptateur Geocodio jette les composants d'adresse, et
    `ManualGeocoder`, celui de la démonstration et du jeu de données, ne résout
    rien du tout. Déduire le quartier d'une chaîne d'adresse ne marcherait pas
    davantage : « 2250 NW 2nd Ave, Miami, FL 33127 » est à Wynwood et ne le dit
    nulle part.

    **Fermée plutôt que libre**, parce que c'est un axe de navigation : deux
    salons qui écriraient « South Beach » et « SoBe » ne se compteraient pas
    ensemble, et le fil annoncerait deux quartiers là où il y en a un.

    **Nullable sur le commerce**, sans valeur « autre » : un salon hors de ces
    neuf quartiers n'a pas de quartier chez nous, et le dire par l'absence vaut
    mieux que par une catégorie fourre-tout qui se remplirait de tout Miami.
    """

    WYNWOOD = "wynwood"
    BRICKELL = "brickell"
    SOUTH_BEACH = "south_beach"
    LITTLE_HAVANA = "little_havana"
    LITTLE_HAITI = "little_haiti"
    DESIGN_DISTRICT = "design_district"
    CORAL_GABLES = "coral_gables"
    MIDTOWN = "midtown"
    EDGEWATER = "edgewater"
    COCONUT_GROVE = "coconut_grove"


class BusinessCategory(StrEnum):
    BEAUTY = "beauty"
    RESTAURANT = "restaurant"
    MUSEUM = "museum"
    FITNESS = "fitness"
    FAMILY_ACTIVITY = "family_activity"
    OTHER = "other"


class BusinessStatus(StrEnum):
    #: **Une fiche préparée par quelqu'un d'autre, que personne n'assume
    #: encore.** C'est ce que la fondatrice remplit au comptoir pendant la
    #: démonstration : des faits, aucun engagement, aucun membre. Distinct de
    #: `onboarding`, qui désigne un commerce dont quelqu'un a déjà le compte et
    #: qui n'a pas fini de se décrire. Les confondre reviendrait à ne plus
    #: savoir si un commerce a un propriétaire.
    DRAFT = "draft"
    ONBOARDING = "onboarding"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class SuspensionReason(StrEnum):
    """Pourquoi un commerce a quitté le fil. **Deux raisons, et elles ne se
    rattrapent pas de la même façon.**

    Sans cette colonne, souscrire ramènerait en ligne un salon qui s'était mis
    en pause pour travaux — ou, dans l'autre sens, laisserait hors du fil un
    salon qui vient de payer. Le journal d'audit porte bien la raison de la
    transition, mais lire un état courant dans un journal d'événements est
    exactement ce qui a déjà coûté cher ici.
    """

    #: Le salon s'est retiré lui-même. Congés, travaux : il reviendra quand il
    #: le décidera, et un paiement ne décide pas à sa place.
    PAUSED_BY_BUSINESS = "paused_by_business"
    #: La période de grâce s'est terminée sans abonnement. Souscrire le ramène
    #: en ligne — c'est la seule chose qui manquait.
    GRACE_EXPIRED = "grace_expired"


class MessageChannel(StrEnum):
    """Par où un message sort de la boîte d'envoi.

    Les deux vivent dans la même table : ils disent la même chose à deux
    endroits — la boîte pour la trace, l'écran verrouillé pour l'urgence — et
    les séparer ferait deux mécaniques de report à tenir d'accord.
    """

    EMAIL = "email"
    PUSH = "push"


class HandoverChannel(StrEnum):
    """Comment le lien de prise en main est parvenu au salon.

    Les deux cas se présentent réellement, et le second est celui où la visite
    se perdait : ou bien le décideur est là et scanne le QR de la tablette — il
    n'a rien à taper, et la personne qui active est manifestement celle qui est
    présente — ou bien le propriétaire n'est pas dans le salon, et le lien doit
    le suivre.
    """

    QR = "qr"
    EMAIL = "email"


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
    #: Clos par l'arbitrage **sans faute de personne**.
    #:
    #: La quatrième issue, et la seule qui ne met le dossier au débit de
    #: personne. Trois refus pour le **même** motif ne disent pas qu'une
    #: créatrice est de mauvaise foi : ils disent que la demande n'a jamais été
    #: comprise, et que la liste fermée de motifs n'a pas su la porter. Trois
    #: motifs différents disent l'inverse.
    #:
    #: Dans le premier cas, ni approuver ni refuser n'est juste. Refuser
    #: punirait quelqu'un pour un défaut du produit ; approuver ferait payer au
    #: salon une publication qu'il n'a pas eue. Le dossier se ferme, et
    #: personne ne perd rien de plus que ce qui est déjà arrivé.
    CLOSED_NO_FAULT = "closed_no_fault"


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
    #: Annulation prévenue trop tard, mais prévenue.
    #:
    #: **Entre les deux, parce que les deux ne coûtent pas la même chose au
    #: salon.** Prévenu à onze heures, il remplit son créneau de quatorze heures
    #: trente ; s'il l'apprend à quatorze heures quarante-cinq, il a perdu son
    #: après-midi. Faire payer les deux au même prix revenait à dire qu'il n'y a
    #: aucun intérêt à prévenir — et quand prévenir ne rapporte rien, on
    #: disparaît.
    #:
    #: Son poids vit en configuration comme les autres, et il est négatif :
    #: annuler tard coûte, moins qu'une absence.
    CANCELLED_LATE = "cancelled_late"
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
    #: Ouvre, avertit, et ferme les périodes de grâce d'abonnement. Balayage
    #: global : un job par commerce coûterait une ligne par salon pour une
    #: échéance qu'on regarde une fois par jour.
    SUBSCRIPTION_GRACE_SWEEP = "subscription_grace_sweep"
    #: Vide la boîte d'envoi. Balayage global lui aussi : un job par message
    #: casserait l'invariant « une ligne par travail, pour toujours » — un
    #: message est une occurrence, pas un travail récurrent.
    OUTBOX_SWEEP = "outbox_sweep"
    #: Applique les suppressions de compte dont le délai est écoulé. Balayage
    #: global : trente jours séparent la demande de l'effet, et un job par
    #: compte tiendrait une ligne un mois pour un seul réveil.
    ACCOUNT_DELETION_SWEEP = "account_deletion_sweep"


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
    """Les dix événements qui méritent de sortir de l'application.

    **Fermée, et c'est le point.** Chaque valeur est une préférence que
    quelqu'un peut couper ; une liste ouverte ferait apparaître des
    notifications qu'on n'aurait jamais proposé de refuser.

    Six s'adressent au créateur, les quatre dernières au commerce. Celles qui
    remontent dans l'autre sens manquaient le plus : un salon ne savait qu'une
    réservation attendait sa décision qu'en ouvrant l'application, et il
    n'aurait appris la fin de sa période d'essai qu'en disparaissant du fil.
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
    #: La contrepartie s'ouvre : la prestation est consommée, le délai de
    #: publication court. **Son propre genre, et non celui du rappel** : couper
    #: les rappels ne doit pas faire disparaître le message qui dit ce qu'on
    #: doit faire et pour quand.
    COLLABORATION_OPENED = "collaboration_opened"
    #: L'échéance est passée sans publication acceptée. **Son propre genre
    #: aussi** : cela touche le score de fiabilité, et quelqu'un qui coupe les
    #: rappels ne doit pas cesser d'apprendre qu'une contrepartie n'a pas été
    #: honorée.
    COLLABORATION_UNFULFILLED = "collaboration_unfulfilled"
    #: **Des deux côtés, et le seul qui ne se coupe pas dans les faits** :
    #: sans adresse confirmée, un compte ne réserve pas et ne met rien en
    #: ligne. Le message qui porte le lien est donc la porte d'entrée, pas une
    #: notification d'agrément.
    ACCOUNT_VERIFICATION = "account_verification"
    #: **Côté commerce.** Une réservation attend sa décision.
    BOOKING_TO_REVIEW = "booking_to_review"
    #: **Côté commerce.** La période d'essai se termine bientôt. Prévenir
    #: avant est la moitié de la règle : disparaître du fil sans l'avoir dit
    #: se lit comme une panne, et c'est le support qui l'apprend.
    SUBSCRIPTION_GRACE_ENDING = "subscription_grace_ending"
    #: **Côté commerce.** Elle s'est terminée : les offres ne paraissent plus.
    #: Les réservations déjà prises sont honorées, et le message le dit — c'est
    #: la première question que le salon se posera.
    SUBSCRIPTION_ENDED = "subscription_ended"
    #: **Côté commerce.** L'administration est entrée dans le compte, et dit
    #: pourquoi. Un accès de support silencieux est un accès dont personne ne
    #: peut demander compte : c'est cette notification qui fait la différence
    #: entre un accès déclaré et un accès qu'on découvre.
    SUPPORT_ACCESS_STARTED = "support_access_started"


class PorteeDeReprise(StrEnum):
    """Ce qu'une reprise ouvre, et rien d'autre.

    **Une durée ne borne pas, une portée si.** Une reprise bornée par le seul
    temps se renouvelle : il suffit d'en rouvrir une quand la précédente
    s'éteint, et l'accès redevient permanent en trois gestes espacés. Ce qu'on
    déclare ici ne se renouvelle pas — un administrateur venu débloquer une
    carte n'entre pas dans les chiffres du salon, quel que soit le temps qu'il
    y passe.

    **Les valeurs sont des écrans, pas des routes.** Le salon lira cette liste :
    « la carte et les prestations » se comprend, `POST /catalog/items` non. Et
    un découpage par route ferait une déclaration de trente cases que personne
    ne remplirait honnêtement.

    Une requête qui ne relève d'aucune portée n'est couverte par aucune reprise.
    C'est le sens qui refuse plutôt que celui qui laisse passer : un écran neuf
    dont personne n'a dit à quelle portée il appartient bloque le support, et se
    voit tout de suite. L'inverse ouvrirait une porte que personne n'a déclarée.
    """

    #: La fiche : identité, adresse, horaires, photos, carte importée.
    FICHE = "fiche"
    #: Les prestations offertes, leurs paliers et leurs contreparties.
    CATALOGUE = "catalogue"
    #: Les réservations et la capacité — ce qui se passe aujourd'hui.
    AGENDA = "agenda"
    #: Les contreparties : preuves, décisions, file d'attente.
    CONTREPARTIES = "contreparties"
    #: L'annuaire des créatrices atteignables depuis ce salon.
    ANNUAIRE = "annuaire"
    #: L'abonnement, son plan et son échéance.
    ABONNEMENT = "abonnement"
    #: Les chiffres : rapports, liens suivis, audience.
    CHIFFRES = "chiffres"
