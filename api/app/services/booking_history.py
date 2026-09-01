"""Les deux lectures d'une liste de réservations : celle du créateur, celle du comptoir.

Deux points de vue sur la même table, et volontairement deux fonctions. Ce ne
sont pas les mêmes colonnes, pas le même tri, pas la même unité de temps : le
créateur regarde son histoire du plus récent au plus ancien, le commerce
regarde une journée dans l'ordre du planning. Une fonction paramétrée aurait
mêlé les deux et forcé chaque appelant à savoir lequel il est.

**Aucun montant n'en sort.** `value_cents_snapshot` existe sur la réservation
et n'est rendu à aucun des deux : ni au créateur, pour qui la valeur s'exprime
en prestation, ni au commerce, dont l'application n'affiche pas davantage de
prix. C'est du reporting, pas un écran de journée.

**Le palier vient de l'offre, pas de la contrepartie.** Une réservation encore
en attente n'a pas de contrepartie — elle naît à la consommation. Passer par
elle rendrait le palier nul sur exactement les lignes que le créateur regarde
le plus, celles qui sont à venir.

**La journée du commerce se découpe dans son fuseau.** Une date arrive sans
heure ; la convertir en UTC depuis le serveur ferait commencer la journée d'un
salon de Miami à 20 h la veille pendant l'heure d'été et à 19 h le reste de
l'année. Le fuseau du commerce fait foi, comme partout ailleurs.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

# **La règle vient d'un seul endroit.** Elle était écrite deux fois — ici et
# dans `booking_states` — avec la même formule ; la première modification de
# l'une aurait fait mentir l'écran sur ce que le serveur accepte, et le défaut
# se serait lu comme un bouton ouvert qui se fait refuser.
from app.core.config import get_settings
from app.models import (
    AuditLog,
    Booking,
    Business,
    BusinessSupportAccess,
    CapacityException,
    CapacityRule,
    CatalogItem,
    Collaboration,
    CreatorProfile,
    Proof,
    SocialAccount,
    Tier,
    TierOffer,
)
from app.models.enums import (
    BookingStatus,
    BusinessCategory,
    CollaborationStatus,
    ContentFormat,
    Platform,
)
from app.services import availability, directory, eligibility, support
from app.services.audit import AuditedEntity
from app.services.booking_states import fin_de_l_annulation_libre, ouverture_de_l_absence

#: Une page d'historique. Au-delà, l'app pagine par `avant`.
PAGE_PAR_DEFAUT = 50
PAGE_MAXIMUM = 200


@dataclass(frozen=True, slots=True)
class CompteDeLaCreatrice:
    """Un réseau rattaché, tel que le salon le voit sur une demande.

    La même forme que dans l'annuaire — plateforme, poignée, volume — parce
    qu'un salon qui a vu une créatrice dans l'annuaire doit la retrouver
    identique sur sa demande. Aucun jeton, aucun état technique.
    """

    platform: Platform
    handle: str | None
    #: Nul quand aucun relevé n'existe. **Zéro serait un chiffre, et faux** :
    #: un compte tout juste rattaché n'a pas zéro abonné, il n'a pas encore été
    #: mesuré.
    followers: int | None
    #: Le taux d'engagement du dernier relevé, en pourcentage.
    #:
    #: **Le second chiffre de la décision**, et souvent le premier des deux à
    #: être regardé : cent mille abonnés à 0,4 % valent moins qu'un compte de
    #: huit mille à 6 %, et un salon qui ne lit que le volume choisit mal.
    #:
    #: Nul quand aucun relevé n'existe, comme les abonnés — jamais zéro, qui
    #: dirait « personne ne réagit » alors que personne n'a mesuré.
    engagement_rate: Decimal | None
    #: Les vues moyennes du dernier relevé.
    #:
    #: Ce qu'une publication touche réellement, quand la plateforme le dit. Nul
    #: sur les réseaux qui ne le rendent pas et sur un compte jamais relevé :
    #: l'absence de la mesure et l'absence de vues ne se confondent pas.
    avg_views: int | None


@dataclass(frozen=True, slots=True)
class LigneDeContrepartie:
    """Ce que la réservation a produit, une fois consommée."""

    collaboration_id: uuid.UUID
    status: CollaborationStatus
    deadline_at: datetime
    attempts_count: int
    #: Le plafond d'essais, **servi et non recopié**. L'écran écrit « essai 2
    #: sur 3 » ; le 3 en dur mentirait au premier ajustement, et il vit en
    #: configuration précisément pour qu'on puisse l'ajuster.
    max_attempts: int
    needs_human_review: bool
    #: La publication elle-même : son identifiant de preuve, son adresse
    #: d'origine, et si un objet est archivé.
    #:
    #: **Sans eux, « mes publications » illustrait chaque ligne avec la photo du
    #: service au catalogue du salon** — c'est-à-dire l'image d'autrui à la
    #: place de la sienne. Les trois existaient depuis la phase 7, sur la table
    #: `proof` ; ils ne descendaient simplement pas jusqu'à l'écran qui existe
    #: pour les montrer.
    proof_id: uuid.UUID | None
    post_url: str | None
    post_a_une_image: bool
    #: Ce que le salon a reproché à la dernière soumission. **Nul quand rien
    #: n'a été refusé.**
    #:
    #: Une créatrice invitée à resoumettre sans qu'on lui dise ce qui manquait
    #: ne peut pas corriger : elle renvoie la même chose, se fait refuser une
    #: seconde fois, et le dossier part en arbitrage sans qu'aucune phrase ait
    #: été échangée. Le motif existait depuis toujours sur la file
    #: d'arbitrage ; il ne descendait simplement pas jusqu'à elle.
    #:
    #: **Dérivé du journal d'audit, jamais stocké en double.** C'est la règle
    #: que la file d'arbitrage s'est donnée, pour la même raison : le journal
    #: est immuable, une colonne recopiée peut diverger sous un `UPDATE`.
    dernier_motif: str | None


@dataclass(frozen=True, slots=True)
class ReservationDuCreateur:
    booking_id: uuid.UUID
    status: BookingStatus
    starts_at: datetime | None
    ends_at: datetime | None
    valid_until: datetime
    #: Jusqu'à quand le commerce peut trancher. Nulle hors d'`awaiting_business`.
    approval_expires_at: datetime | None
    #: Jusqu'à quand l'annulation ne coûte rien. **Nulle veut dire « toujours
    #: libre »**, jamais « on ne sait pas » : un garde, un droit sans créneau et
    #: une demande que le salon n'a pas acceptée n'ont aucune échéance, et
    #: poser un instant sur l'un des trois ferait renoncer quelqu'un qui
    #: n'avait rien à perdre.
    #:
    #: Calculée par le serveur, comme `absence_signalable_a` et pour la même
    #: raison : le seuil est un réglage, et le recopier côté écran le ferait
    #: dériver au premier ajustement. Sans elle, l'écran peut avertir qu'annuler
    #: tard coûte, mais pas dire quand — et c'est l'heure qui décide, entre
    #: annuler maintenant et renoncer.
    annulation_sans_frais_jusqu_a: datetime | None
    created_at: datetime
    business_id: uuid.UUID
    business_name: str
    business_category: BusinessCategory
    business_address: str | None
    business_timezone: str
    business_cover_photo_key: str | None
    item_name: str
    item_photo_key: str | None
    duration_minutes: int | None
    platform: Platform
    content_format: ContentFormat
    #: Nulle tant que la réservation n'a pas été consommée : c'est la
    #: contrepartie qui porte l'échéance de publication, pas la réservation.
    contrepartie: LigneDeContrepartie | None


@dataclass(frozen=True, slots=True)
class HistoriqueDuCreateur:
    items: tuple[ReservationDuCreateur, ...]
    #: Un compteur par statut, calculé sur **tout** l'historique et non sur la
    #: page. Un onglet qui annonce « 3 » parce que la première page en contient
    #: trois ment dès la seconde. Les statuts sans réservation valent zéro et
    #: sont présents dans la clé : l'app n'a pas à connaître la liste.
    compteurs: dict[BookingStatus, int]


@dataclass(frozen=True, slots=True)
class ReservationDuCommerce:
    booking_id: uuid.UUID
    status: BookingStatus
    starts_at: datetime | None
    ends_at: datetime | None
    valid_until: datetime
    #: Jusqu'à quand le commerce peut trancher. Nulle hors d'`awaiting_business`.
    approval_expires_at: datetime | None
    creator_id: uuid.UUID
    #: **Le pseudonyme, jamais l'état civil.** Un salon n'a aucune raison de
    #: connaître le nom légal de quelqu'un : il sert une prestation à un compte
    #: qui publiera, et c'est le pseudonyme qui nomme ce compte partout — au
    #: comptoir, dans la journée, sur le réseau où la publication paraîtra.
    #:
    #: Le nom civil était servi *et préféré* à l'écran : la journée et la caisse
    #: affichaient « Léa Moreau » et ne retombaient sur `@lea.mrl` qu'à défaut.
    #: L'inverse exact de ce que le produit promet.
    creator_handle: str | None
    #: La créatrice a fermé son compte.
    #:
    #: **Un drapeau, jamais une phrase.** Le serveur ne compose pas de texte
    #: d'interface : « créatrice partie » se traduit dans les deux langues côté
    #: écran, et une chaîne posée ici arriverait en français au milieu d'une
    #: interface en espagnol.
    #:
    #: Et un drapeau plutôt qu'un nom vide, qui est ce que le commerce voyait :
    #: une ligne sans nom se lit comme un défaut d'affichage, pas comme un
    #: départ. L'historique reste — le salon ne perd pas ce qui a eu lieu — mais
    #: il dit ce qui s'est passé au lieu de le laisser deviner.
    creator_partie: bool
    #: Où le commerce va regarder la créatrice, sur le réseau de **cette**
    #: demande. Dérivé du pseudonyme, jamais stocké : deux vérités dont une
    #: qu'on ne rafraîchit pas laisseraient un lien mort au premier changement
    #: de pseudonyme. Nul quand la plateforme n'a pas d'adresse publique connue
    #: — mieux qu'un lien qui mène à une page d'erreur, que le salon lirait
    #: comme un compte supprimé.
    creator_profil_url: str | None
    #: Le visage que le salon voit, **par sa clé** — servi par `GET /media/{cle}`
    #: et jamais l'adresse de la plateforme, qui expire. Nul quand la créatrice
    #: n'en a pas ; l'écran rend alors le pseudonyme seul.
    #:
    #: La colonne existait et ne sortait que par l'annuaire : un salon qui
    #: décide d'accorder voyait un identifiant, quand la même donnée lui était
    #: rendue ailleurs. Décider d'une personne sans jamais la voir est
    #: précisément ce que ce champ corrige.
    creator_avatar_key: str | None
    item_name: str
    duration_minutes: int | None
    platform: Platform
    content_format: ContentFormat
    #: Ce qui sera exigé de la publication. Rendu au comptoir parce que c'est
    #: lui qui le vérifiera.
    required_mention: str | None
    required_geotag: bool
    #: Tous les réseaux de la créatrice, pas seulement celui de cette demande.
    #:
    #: **L'absence est une information.** Une demande porte un compte et un
    #: seul ; la décision, elle, se prend sur ce que la personne pèse en entier
    #: — et savoir qu'il n'y a pas de TikTok en fait partie autant que le nombre
    #: d'abonnés Instagram. Ne servir que le compte de la demande obligeait à
    #: ouvrir l'annuaire pour le savoir, ou à ne pas le savoir.
    #:
    #: Les comptes rattachés uniquement : une ligne par réseau du produit, dont
    #: certains ne seront jamais offerts, remplirait chaque demande de vides.
    #: C'est l'écran qui sait quels réseaux il propose, et qui lit le manque.
    comptes: tuple[CompteDeLaCreatrice, ...]
    contrepartie: LigneDeContrepartie | None
    #: L'instant à partir duquel l'absence peut être constatée, `None` quand
    #: elle ne le pourra jamais. Calculé ici pour que l'écran n'ait pas à
    #: connaître le délai : un seuil recopié dans l'application dérive du jour
    #: où on l'ajuste côté serveur, et cette dérive-là se lit comme un bouton
    #: grisé qui devrait être actif.
    absence_signalable_a: datetime | None


@dataclass(frozen=True, slots=True)
class JourneeDuCommerce:
    #: La date demandée, telle qu'elle a été lue dans le fuseau du commerce.
    jour: date
    timezone: str
    debut: datetime
    fin: datetime
    items: tuple[ReservationDuCommerce, ...]
    #: Ce qui attend une décision, **toutes dates confondues**.
    #:
    #: Hors de la journée, délibérément. Une réservation à trancher pour
    #: après-demain n'apparaîtrait dans aucune journée qu'on ouvre, et la
    #: créatrice attendrait une réponse que personne ne voit à donner. C'est
    #: une file, pas un planning : elle se lit là où le commerce regarde, et il
    #: regarde sa journée.
    a_trancher: tuple[ReservationDuCommerce, ...]
    #: Les plages d'ouverture **de ce jour-là**, en heures locales.
    #:
    #: La sous-ligne de la date : « 9 h – 19 h », ou rien du tout quand le salon
    #: est fermé. Une journée vide n'a pas la même lecture selon qu'on était
    #: fermé ou que personne n'est venu, et l'écran ne pouvait pas les
    #: distinguer.
    #:
    #: **Les fenêtres réelles, exceptions comprises** : c'est
    #: `availability.fenetres_du_jour` qui les produit, la même fonction qui
    #: décide des créneaux. Relire les règles hebdomadaires ici afficherait
    #: l'horaire habituel un jour férié aménagé — et le salon lirait sur son
    #: propre écran qu'il est ouvert alors qu'il a fermé.
    horaires: tuple[availability.Fenetre, ...]
    #: La reprise de compte qui court, s'il y en a une. Nulle presque toujours.
    #:
    #: **Une seule, et non l'historique.** Le bandeau demandait la liste des
    #: reprises à part, et le commentaire qui le justifiait avait raison sur le
    #: fond : la journée n'a pas à porter un historique qui ne la concerne pas,
    #: et qu'elle rechargerait à chaque changement de jour. Une ligne ou nulle
    #: ne pèse rien, et retire une requête de l'écran le plus ouvert du produit.
    #:
    #: L'historique reste sur `GET /business/{id}/support-access`, que l'écran
    #: des réglages lit — c'est là qu'on veut savoir qui est entré en mars.
    #:
    #: **La plus récemment ouverte** quand deux administrateurs sont entrés : le
    #: service ne refuse que la seconde du *même*. C'est celle que le bandeau
    #: nomme, et l'écran garde sa propre règle d'échéance — une reprise peut
    #: expirer pendant qu'on regarde l'écran, et le serveur ne le redira pas.
    reprise_en_cours: BusinessSupportAccess | None


def _colonnes_communes() -> tuple:
    return (
        Booking.id.label("booking_id"),
        Booking.status,
        Booking.starts_at,
        Booking.ends_at,
        Booking.valid_until,
        # **Dans les colonnes communes, donc rendue aux deux.** Le commerce doit
        # savoir jusqu'à quand il peut trancher ; la créatrice doit savoir
        # jusqu'à quand elle attend. C'est la même donnée, et la servir d'un
        # seul côté laisserait l'autre deviner.
        Booking.approval_expires_at,
        Booking.created_at,
        CatalogItem.name.label("item_name"),
        CatalogItem.photo_key.label("item_photo_key"),
        Booking.duration_minutes,
        Tier.platform,
        Tier.content_format,
        # Les critères que le salon devra vérifier sur la publication. Ils
        # vivent sur l'offre, déjà jointe : le comptoir doit les avoir sous
        # les yeux au moment de servir, pas les retrouver ailleurs.
        TierOffer.required_mention,
        TierOffer.required_geotag,
        Collaboration.id.label("collaboration_id"),
        Collaboration.status.label("collaboration_status"),
        Collaboration.deadline_at,
        Collaboration.attempts_count,
        Collaboration.needs_human_review,
    )


def _jointures_communes(requete):
    """Item, palier et contrepartie, accrochés de la même façon des deux côtés.

    Le palier passe par `tier_offer` : c'est le seul chemin qui existe dès la
    réservation. La contrepartie est en jointure externe, elle n'existe qu'après
    la consommation.
    """
    return (
        requete.join(CatalogItem, CatalogItem.id == Booking.catalog_item_id)
        .join(TierOffer, TierOffer.id == Booking.tier_offer_id)
        .join(Tier, Tier.id == TierOffer.tier_id)
        .outerjoin(Collaboration, Collaboration.booking_id == Booking.id)
    )


def _contrepartie(
    ligne,
    motifs: dict[uuid.UUID, str] | None = None,
    publications: dict[uuid.UUID, tuple[uuid.UUID, str | None, bool]] | None = None,
) -> LigneDeContrepartie | None:
    """`motifs` nul veut dire **« pas chargés »**, jamais « aucun refus ».

    La journée du commerce ne les charge pas, et c'est délibéré : le salon est
    l'auteur du motif, il n'a pas à se le faire relire au comptoir. Le distinguer
    d'un dossier sans refus tient au fait que la table est nulle et non vide —
    sans quoi ajouter un appelant qui oublie de charger ferait taire un reproche
    au lieu de lever une erreur.
    """
    if ligne.collaboration_id is None:
        return None
    return LigneDeContrepartie(
        collaboration_id=ligne.collaboration_id,
        status=ligne.collaboration_status,
        deadline_at=ligne.deadline_at,
        attempts_count=ligne.attempts_count,
        max_attempts=get_settings().collaboration_max_attempts,
        needs_human_review=ligne.needs_human_review,
        dernier_motif=(motifs or {}).get(ligne.collaboration_id),
        # **Nul quand rien n'a été soumis**, ce qui est le cas ordinaire d'une
        # contrepartie encore due. Trois nuls plutôt qu'un objet vide : l'écran
        # distingue « pas encore publié » de « publié sans image archivée ».
        **_publication((publications or {}).get(ligne.collaboration_id)),
    )


def _publication(trouvee: tuple[uuid.UUID, str | None, bool] | None) -> dict:
    if trouvee is None:
        return {"proof_id": None, "post_url": None, "post_a_une_image": False}
    proof_id, post_url, a_une_image = trouvee
    return {"proof_id": proof_id, "post_url": post_url, "post_a_une_image": a_une_image}


async def _dernieres_publications(
    session: AsyncSession, collaboration_ids: list[uuid.UUID | None]
) -> dict[uuid.UUID, tuple[uuid.UUID, str | None, bool]]:
    """La **dernière** soumission de chaque dossier : preuve, adresse, objet.

    **Un seul aller-retour**, comme les motifs, et pour la même raison : une
    requête par ligne sur un écran qui en affiche vingt.

    **La dernière et non l'acceptée.** Un dossier approuvé n'a qu'une soumission
    qui compte, et c'est la dernière ; un dossier refusé n'en a pas d'acceptée du
    tout, et c'est encore la dernière qu'on veut montrer — c'est celle qu'on
    corrige. Trié par `submitted_at`, qui est en `clock_timestamp()` : deux
    soumissions d'une même transaction s'ordonnent quand même.
    """
    ids = [identifiant for identifiant in collaboration_ids if identifiant is not None]
    if not ids:
        return {}

    publications: dict[uuid.UUID, tuple[uuid.UUID, str | None, bool]] = {}
    # Du plus ancien au plus récent : la dernière écriture pour un dossier
    # écrase les précédentes, et c'est celle-là qu'on garde.
    for collaboration_id, proof_id, source_url, media_key, screenshot_key in await session.execute(
        sa.select(
            Proof.collaboration_id,
            Proof.id,
            Proof.source_url,
            Proof.media_key,
            Proof.screenshot_key,
        )
        .where(Proof.collaboration_id.in_(ids))
        .order_by(Proof.submitted_at)
    ):
        publications[collaboration_id] = (
            proof_id,
            source_url,
            bool(media_key or screenshot_key),
        )
    return publications


async def _derniers_motifs(
    session: AsyncSession, collaboration_ids: list[uuid.UUID | None]
) -> dict[uuid.UUID, str]:
    """Le motif de la **dernière** demande de nouvelle soumission, par dossier.

    Lu dans le journal d'audit, comme la file d'arbitrage le lit : rien n'est
    stocké ailleurs, et le recopier sur la contrepartie créerait une seconde
    vérité qu'un `UPDATE` pourrait faire diverger du journal — lequel, lui, est
    immuable.

    **Le dernier seulement, et c'est la différence avec l'arbitrage.** Là-bas
    la répétition justifie l'escalade, et l'historique entier compte. Ici la
    créatrice a une chose à corriger : lui montrer les trois reproches
    précédents la ferait corriger ce qui l'est déjà.
    """
    ids = [identifiant for identifiant in collaboration_ids if identifiant is not None]
    if not ids:
        return {}

    motifs: dict[uuid.UUID, str] = {}
    # Trié du plus ancien au plus récent : la dernière écriture pour un dossier
    # écrase les précédentes, et c'est celle-là qu'on garde.
    for entity_id, reason in await session.execute(
        sa.select(AuditLog.entity_id, AuditLog.reason)
        .where(
            AuditLog.entity_type == AuditedEntity.COLLABORATION.value,
            AuditLog.entity_id.in_(ids),
            AuditLog.to_status == CollaborationStatus.RESUBMIT_REQUESTED.value,
            AuditLog.reason.is_not(None),
        )
        .order_by(AuditLog.occurred_at)
    ):
        motifs[entity_id] = reason

    return motifs


async def historique_du_createur(
    session: AsyncSession,
    *,
    creator_id: uuid.UUID,
    statuts: frozenset[BookingStatus] | None = None,
    avant: datetime | None = None,
    limite: int = PAGE_PAR_DEFAUT,
) -> HistoriqueDuCreateur:
    """Du plus récent au plus ancien, avec les compteurs de tous les onglets.

    Le tri est sur `created_at` et non sur `starts_at` : ce dernier est nul sur
    un item sans réservation, et trier sur une colonne nullable reléguerait
    silencieusement ces droits-là à un bout ou à l'autre de la liste.
    """
    limite = max(1, min(limite, PAGE_MAXIMUM))

    requete = _jointures_communes(
        sa.select(
            *_colonnes_communes(),
            Business.id.label("business_id"),
            Business.name.label("business_name"),
            Business.category.label("business_category"),
            Business.address.label("business_address"),
            Business.timezone.label("business_timezone"),
            Business.cover_photo_key.label("business_cover_photo_key"),
        ).join(Business, Business.id == Booking.business_id)
    ).where(
        Booking.creator_id == creator_id,
        *([Booking.status.in_(statuts)] if statuts else []),
        *([Booking.created_at < avant] if avant else []),
    )

    lignes = (
        await session.execute(
            requete.order_by(Booking.created_at.desc(), Booking.id.desc()).limit(limite)
        )
    ).all()

    # Les compteurs ignorent `statuts` et `avant` : ce sont ceux des onglets,
    # et un onglet ne se compte pas depuis le filtre d'un autre.
    # **Un seul aller-retour pour toute la page.** Le motif se lit dans le
    # journal d'audit ; le demander par ligne ferait une requête par
    # réservation, sur un écran qui en affiche vingt.
    identifiants = [ligne.collaboration_id for ligne in lignes]
    motifs = await _derniers_motifs(session, identifiants)
    publications = await _dernieres_publications(session, identifiants)

    compteurs = dict.fromkeys(BookingStatus, 0)
    for status, nombre in await session.execute(
        sa.select(Booking.status, sa.func.count())
        .where(Booking.creator_id == creator_id)
        .group_by(Booking.status)
    ):
        compteurs[status] = nombre

    return HistoriqueDuCreateur(
        items=tuple(
            ReservationDuCreateur(
                booking_id=ligne.booking_id,
                status=ligne.status,
                starts_at=ligne.starts_at,
                ends_at=ligne.ends_at,
                valid_until=ligne.valid_until,
                approval_expires_at=ligne.approval_expires_at,
                annulation_sans_frais_jusqu_a=fin_de_l_annulation_libre(
                    ligne.starts_at, ligne.status
                ),
                created_at=ligne.created_at,
                business_id=ligne.business_id,
                business_name=ligne.business_name,
                business_category=ligne.business_category,
                business_address=ligne.business_address,
                business_timezone=ligne.business_timezone,
                business_cover_photo_key=ligne.business_cover_photo_key,
                item_name=ligne.item_name,
                item_photo_key=ligne.item_photo_key,
                duration_minutes=ligne.duration_minutes,
                platform=ligne.platform,
                content_format=ligne.content_format,
                contrepartie=_contrepartie(ligne, motifs, publications),
            )
            for ligne in lignes
        ),
        compteurs=compteurs,
    )


def aujourd_hui(business: Business) -> date:
    """La date du jour chez le commerce, pas chez le serveur.

    Un serveur en UTC est déjà demain quand il est 20 h à Miami : sans cette
    conversion, la journée par défaut sauterait chaque soir.
    """
    return datetime.now(ZoneInfo(business.timezone)).date()


def _lire(ligne, comptes=None) -> ReservationDuCommerce:
    """Une ligne de requête en réservation du commerce.

    Écrit une fois : la journée et la file à trancher lisent les mêmes colonnes,
    et deux copies divergeraient au premier champ ajouté.

    `comptes` arrive du dehors parce qu'il se lit **en une requête pour tout le
    monde** : le chercher ici en ferait une par ligne, et une journée chargée
    paierait sa charge en allers-retours.
    """
    return ReservationDuCommerce(
        booking_id=ligne.booking_id,
        status=ligne.status,
        starts_at=ligne.starts_at,
        ends_at=ligne.ends_at,
        valid_until=ligne.valid_until,
        approval_expires_at=ligne.approval_expires_at,
        creator_id=ligne.creator_id,
        creator_handle=ligne.handle,
        creator_partie=ligne.anonymized_at is not None,
        creator_profil_url=directory.lien_public(ligne.platform, ligne.handle),
        creator_avatar_key=ligne.avatar_key,
        item_name=ligne.item_name,
        duration_minutes=ligne.duration_minutes,
        platform=ligne.platform,
        content_format=ligne.content_format,
        required_mention=ligne.required_mention,
        required_geotag=ligne.required_geotag,
        comptes=tuple((comptes or {}).get(ligne.creator_id, ())),
        contrepartie=_contrepartie(ligne),
        absence_signalable_a=ouverture_de_l_absence(ligne.starts_at),
    )


async def journee_du_commerce(
    session: AsyncSession, *, business: Business, jour: date
) -> JourneeDuCommerce:
    """Les réservations d'une journée, dans l'ordre du planning.

    Les réservations sans créneau — les items à fenêtre de validité — sont
    incluses quand la journée tombe dans leur fenêtre : elles se présentent au
    comptoir ce jour-là comme les autres, et les omettre ferait arriver
    quelqu'un qui n'est sur aucune liste.
    """
    fuseau = ZoneInfo(business.timezone)
    debut = datetime.combine(jour, time.min, tzinfo=fuseau)
    fin = debut + timedelta(days=1)

    requete = _jointures_communes(
        sa.select(
            *_colonnes_communes(),
            CreatorProfile.user_id.label("creator_id"),
            CreatorProfile.anonymized_at,
            SocialAccount.handle,
            SocialAccount.avatar_key,
        )
        .join(CreatorProfile, CreatorProfile.user_id == Booking.creator_id)
        .join(SocialAccount, SocialAccount.id == Booking.social_account_id)
    ).where(
        Booking.business_id == business.id,
        sa.or_(
            sa.and_(Booking.starts_at >= debut, Booking.starts_at < fin),
            sa.and_(
                Booking.starts_at.is_(None),
                Booking.created_at < fin,
                Booking.valid_until >= debut,
            ),
        ),
    )

    lignes = (
        await session.execute(
            # `nullslast` : les droits sans créneau se lisent après le planning,
            # pas avant l'ouverture.
            requete.order_by(sa.nullslast(Booking.starts_at.asc()), Booking.created_at.asc())
        )
    ).all()

    en_attente = (
        await session.execute(
            _jointures_communes(
                sa.select(
                    *_colonnes_communes(),
                    CreatorProfile.user_id.label("creator_id"),
                    CreatorProfile.anonymized_at,
                    SocialAccount.handle,
                    SocialAccount.avatar_key,
                )
                .join(CreatorProfile, CreatorProfile.user_id == Booking.creator_id)
                .join(SocialAccount, SocialAccount.id == Booking.social_account_id)
            )
            .where(
                Booking.business_id == business.id,
                Booking.status == BookingStatus.AWAITING_BUSINESS,
            )
            # La plus ancienne d'abord : c'est celle qui attend depuis le plus
            # longtemps, et une file qui se lit dans l'autre sens laisse le
            # premier arrivé au fond.
            .order_by(sa.nullslast(Booking.starts_at.asc()), Booking.created_at.asc())
        )
    ).all()

    comptes = await _comptes_des_creatrices(
        session, [ligne.creator_id for ligne in (*lignes, *en_attente)]
    )

    return JourneeDuCommerce(
        jour=jour,
        timezone=business.timezone,
        debut=debut,
        fin=fin,
        a_trancher=tuple(_lire(ligne, comptes) for ligne in en_attente),
        items=tuple(_lire(ligne, comptes) for ligne in lignes),
        horaires=tuple(await _horaires_du_jour(session, business_id=business.id, jour=jour)),
        # `[:1]` et non une requête à part : `toutes_en_cours` ordonne déjà par
        # ouverture décroissante, et c'est la même fonction que le salon appelle
        # pour refermer. Deux définitions de « la reprise qui court »
        # divergeraient, et celle-ci porte un bandeau qu'on ne veut pas voir
        # mentir.
        reprise_en_cours=next(
            iter(await support.toutes_en_cours(session, business_id=business.id)), None
        ),
    )


async def _comptes_des_creatrices(
    session: AsyncSession, creator_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[CompteDeLaCreatrice]]:
    """Tous les réseaux de toutes les créatrices de la journée, en une requête.

    Le relevé le plus récent par compte, par la même sous-requête que
    l'éligibilité : deux façons de dire « le dernier relevé » finiraient par
    donner deux chiffres différents pour la même créatrice sur deux écrans.

    Les comptes révoqués restent : le salon a devant lui une demande faite
    quand le compte vivait, et le faire disparaître de l'écran ferait croire à
    une créatrice sans réseau.
    """
    if not creator_ids:
        return {}

    releve = eligibility._dernier_releve()
    par_createur: dict[uuid.UUID, list[CompteDeLaCreatrice]] = {}
    for ligne in (
        await session.execute(
            sa.select(
                SocialAccount.creator_id,
                SocialAccount.platform,
                SocialAccount.handle,
                releve.c.followers_count,
                releve.c.engagement_rate,
                releve.c.avg_views,
            )
            .outerjoin(releve, releve.c.social_account_id == SocialAccount.id)
            .where(SocialAccount.creator_id.in_(set(creator_ids)))
            .order_by(SocialAccount.creator_id, SocialAccount.platform)
        )
    ).all():
        par_createur.setdefault(ligne.creator_id, []).append(
            CompteDeLaCreatrice(
                platform=ligne.platform,
                handle=ligne.handle,
                followers=ligne.followers_count,
                engagement_rate=ligne.engagement_rate,
                avg_views=ligne.avg_views,
            )
        )
    return par_createur


async def _horaires_du_jour(
    session: AsyncSession, *, business_id: uuid.UUID, jour: date
) -> list[availability.Fenetre]:
    """Les plages de ce jour, exception comprise.

    Deux lectures, et pas de calcul : la règle appartient à `availability`, qui
    l'applique déjà pour les créneaux. En écrire une seconde ici ferait diverger
    la sous-ligne de ce que la disponibilité propose réellement.
    """
    regles = list(
        await session.scalars(
            sa.select(CapacityRule).where(CapacityRule.business_id == business_id)
        )
    )
    exception = await session.scalar(
        sa.select(CapacityException).where(
            CapacityException.business_id == business_id,
            CapacityException.date == jour,
        )
    )
    return availability.fenetres_du_jour(jour, regles, exception)
