"""Ce que le créateur voit de ses paliers.

Le moteur d'éligibilité répond par couple (compte, palier) : c'est la bonne
forme pour filtrer un fil, pas pour peupler un écran. Un créateur à trois
comptes verrait le même palier trois fois, avec trois verdicts, et n'aurait
aucune idée de ce qu'il doit faire.

Ce module regroupe par palier : accessible dès qu'**un** compte l'ouvre, et
quand aucun ne l'ouvre, les obstacles de celui qui s'en approche le plus. Lui
montrer les obstacles de son compte le plus faible lui ferait viser la mauvaise
cible.

**Chaque palier annonce ce qu'il ouvre.** Le nombre de prestations proposées à
ce palier vient d'ici et non de l'app : elle n'a pas de quoi le compter, et le
déduire du fil donnerait un chiffre qui change avec le rayon de recherche.
Le compte ne filtre **pas** par distance ni par disponibilité — l'écran des
paliers n'a pas de position, et un créneau libre à cet instant ne dit rien de
ce qu'un palier ouvre en général. Le libellé le dit comme tel : ce qui est
proposé, pas ce qui est réservable tout de suite.

**Un créateur sans aucun compte social n'a aucun obstacle**, au sens du moteur :
il n'y a pas de couple à évaluer. C'est le piège de l'ensemble vide — l'écran
afficherait des paliers tous inaccessibles sans dire pourquoi, ce qui est la
pire chose à montrer à quelqu'un qui vient de s'inscrire. Le cas est donc nommé.
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import Coordinates
from app.models import Business, CatalogItem, CreatorProfile, Tier, TierOffer
from app.models.enums import BusinessStatus, ContentFormat, Neighborhood, Platform
from app.services import eligibility


@dataclass(frozen=True, slots=True)
class PalierVu:
    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    min_followers: int
    min_completed_collabs: int
    min_reliability_score: Decimal | None
    value_ratio_hint: Decimal | None
    display_order: int
    accessible: bool
    #: Le compte qui ouvre le palier, ou celui qui s'en approche le plus. Nul
    #: quand le créateur n'a aucun compte social.
    social_account_id: uuid.UUID | None
    obstacles: tuple[eligibility.Obstacle, ...]
    #: Combien de prestations les commerces proposent à ce palier.
    offres_disponibles: int
    #: Combien de **prestations** ce palier ouvre dans le rayon demandé.
    #:
    #: La même grandeur qu'`offres_disponibles`, restreinte à la distance :
    #: « douze au total, dont neuf à moins de quinze kilomètres » compare deux
    #: fois des prestations. Y mettre un compte de salons ferait comparer deux
    #: grandeurs dans la même phrase.
    offres_dans_le_rayon: int | None
    #: Combien de **commerces** proposent ce palier dans le rayon demandé.
    #:
    #: `None` quand aucune position n'a été fournie, et c'est une absence, pas
    #: un zéro : l'écran doit pouvoir distinguer « on n'a pas demandé » de
    #: « il n'y en a aucun autour de vous ». La route ne dépend jamais d'une
    #: position, elle en tire parti quand elle est là.
    commerces_dans_le_rayon: int | None


@dataclass(frozen=True, slots=True)
class Fiabilite:
    """Ce que l'écran a le droit de dire du score, et rien de plus.

    Le score **ferme des paliers** — `reliability_score_too_low` est une raison
    de refus à part entière — et il n'était renvoyé nulle part : l'écran
    annonçait une condition sans jamais donner la valeur, ce qui est la
    définition d'une règle opaque.

    Les deux champs viennent des caches de `creator_profile`, écrits par
    `reliability.rafraichir` et recalculables depuis les événements. Rien n'est
    calculé ici : un second calcul du score serait une seconde vérité.

    **Nul veut dire neutre, jamais zéro.** Un créateur sans historique n'a pas
    un mauvais score, il n'en a pas ; l'écran doit alors montrer la définition
    sans le chiffre, et surtout pas une barre à zéro.
    """

    #: Zéro à cent. Nul tant qu'aucun événement n'a été enregistré.
    reliability_score: Decimal | None
    #: Le second terme, celui qui donne au score son assise : sans lui, « 92 »
    #: ne dit pas s'il est tiré de douze collaborations ou d'une seule.
    completed_collabs_count: int


@dataclass(frozen=True, slots=True)
class ProchainPalier:
    """Le palier fermé le plus proche, et ce qu'il ouvrirait.

    **Il vivait sur le fil, et son sujet est parti sans lui.** L'écran qui le
    montre lit `mesPaliers` depuis la refonte, pas le fil : le champ était
    servi à chaque chargement du fil et lu nulle part. Le ranger en « contrat »
    aurait fait passer un déménagement pour une intention.

    **Le classement est ici et non dans l'écran.** C'est une règle de produit —
    on classe sur le **nombre** de conditions qui manquent, jamais sur leur
    ampleur — et la recopier côté client en ferait une seconde vérité. Une
    première version triait sur l'écart brut : elle plaçait « une collaboration
    de plus » devant « cinq mille abonnés de plus » parce que 1 < 5000, ce qui
    revient à comparer deux grandeurs sans rapport. À égalité, l'échelle du
    produit tranche — story, puis post, puis reel.

    **Rien n'est recalculé.** Tout vient des paliers déjà évalués au-dessus :
    aucune requête de plus, et le compte dans le rayon est celui que le palier
    porte déjà.
    """

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    #: Le premier obstacle, celui que l'écran affiche. Les autres restent
    #: lisibles sur le palier lui-même.
    obstacle: eligibility.Obstacle
    #: Combien de commerces le proposent à portée. `None` sans position — la
    #: même absence que sur le palier, et pour la même raison.
    #:
    #: **Ce n'est plus « de plus ».** Sur le fil, le compte excluait les
    #: commerces déjà listés — « combien de salons en plus de ceux que vous
    #: voyez ». Hors du fil il n'y a rien à exclure, et garder le mot ferait
    #: promettre une soustraction qui n'a plus d'opérande.
    commerces_dans_le_rayon: int | None


@dataclass(frozen=True, slots=True)
class VueDesPaliers:
    creator_id: uuid.UUID
    #: Le badge : aucun historique de fiabilité, donc jugé sur son volume seul.
    #: Calculé par la base, pas ici — il ne peut pas diverger de sa source.
    is_new_creator: bool
    fiabilite: Fiabilite
    paliers: tuple[PalierVu, ...]
    #: Le palier fermé le plus proche. `None` quand ils sont tous ouverts, ou
    #: qu'aucun de ceux qui restent ne porte d'obstacle nommable.
    prochain_palier: ProchainPalier | None


def _le_plus_proche(acces: list[eligibility.AccesPalier]) -> eligibility.AccesPalier:
    """Le compte qui s'approche le plus du palier.

    D'abord le moins d'obstacles, puis le plus petit écart d'abonnés. Deux
    comptes bloqués pour des raisons différentes ne se comparent pas par leur
    nombre d'abonnés seul : celui qui n'a qu'un relevé à attendre est plus
    proche que celui à qui il manque dix mille abonnés.
    """

    def rang(a: eligibility.AccesPalier) -> tuple[int, int]:
        ecarts = [
            o.ecart
            for o in a.obstacles
            if o.raison is eligibility.RaisonRefus.NOT_ENOUGH_FOLLOWERS and o.ecart is not None
        ]
        return (len(a.obstacles), int(ecarts[0]) if ecarts else 0)

    return min(acces, key=rang)


@dataclass(frozen=True, slots=True)
class OffreDuPalier:
    """Une prestation ouverte à ce palier, où qu'elle soit."""

    tier_offer_id: uuid.UUID
    catalog_item_id: uuid.UUID
    business_id: uuid.UUID
    nom: str
    nom_du_commerce: str
    neighborhood: Neighborhood | None
    price_cents: int
    currency: str
    duration_minutes: int | None
    photo_key: str | None
    #: La distance depuis la position, quand elle est fournie. `None` sinon —
    #: c'est ce qui distingue « loin » de « on ne sait pas d'où ».
    distance_metres: float | None


async def offres_du_palier(
    session: AsyncSession,
    *,
    tier_id: uuid.UUID,
    autour_de: Coordinates | None = None,
) -> tuple[OffreDuPalier, ...]:
    """Toutes les prestations d'un palier, **sans borne de distance**.

    **Ce que le fil ne peut pas rendre.** `/businesses` est borné par un rayon
    par construction, et le déborner n'y suffirait pas : il exige une position
    et trie par distance, ce qui n'a pas de sens pour « tout BIND ». La bascule
    « près de vous / les douze » a besoin des objets, pas d'un nombre — et ses
    deux états doivent montrer deux listes différentes, sinon elle ne vaut pas
    d'exister.

    **Trié par quartier, puis par nom de prestation.** C'est le seul axe que le
    produit connaît déjà et qui ne classe personne : trier par palier
    hiérarchiserait des prestations que la créatrice peut toutes réserver, trier
    par salon supposerait un ordre entre eux, et ne rien trier ferait une liste
    sans forme. Les salons sans quartier viennent en dernier — ils ne sont pas
    situés, pas relégués.

    **Le même tamis que le compte.** Offre active, commerce actif, item
    disponible, parent disponible. Deux tamis différents feraient qu'une liste
    de douze porterait onze lignes, et personne ne saurait laquelle manque.

    La disponibilité n'est **pas** vérifiée : c'est une lecture de catalogue, et
    la vérifier ici coûterait le calcul le plus cher du produit pour un panneau
    qu'on déplie. Le fil la vérifie à l'arrivée.
    """
    parent = sa.orm.aliased(CatalogItem)
    distance = (
        sa.func.ST_Distance(
            sa.cast(Business.geo, Geography),
            sa.func.ST_GeogFromText(f"SRID=4326;{autour_de.as_wkt()}"),
        ).label("distance")
        if autour_de is not None
        else sa.null().label("distance")
    )

    lignes = (
        await session.execute(
            sa.select(
                TierOffer.id.label("tier_offer_id"),
                CatalogItem.id.label("catalog_item_id"),
                Business.id.label("business_id"),
                CatalogItem.name.label("nom"),
                Business.name.label("nom_du_commerce"),
                Business.neighborhood,
                CatalogItem.price_cents,
                Business.currency,
                CatalogItem.duration_minutes,
                CatalogItem.photo_key,
                distance,
            )
            .join(Business, Business.id == TierOffer.business_id)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
            .where(
                TierOffer.tier_id == tier_id,
                TierOffer.is_active.is_(True),
                Business.status == BusinessStatus.ACTIVE,
                CatalogItem.is_available.is_(True),
                sa.or_(parent.id.is_(None), parent.is_available.is_(True)),
            )
            # `nullslast` est **explicite et redondant**, et c'est voulu : en
            # Postgres, `NULLS LAST` est déjà le défaut d'un tri ascendant —
            # l'exercice de mutation le confirme, le retirer ne change rien.
            # Mais le défaut dépend du **sens** du tri : passer un jour ce
            # `asc()` en `desc()` remonterait silencieusement les salons non
            # situés en tête de liste. L'écrire fige l'intention plutôt que de
            # la faire dépendre d'une direction.
            .order_by(sa.nullslast(Business.neighborhood.asc()), CatalogItem.name.asc())
        )
    ).all()

    return tuple(
        OffreDuPalier(
            tier_offer_id=ligne.tier_offer_id,
            catalog_item_id=ligne.catalog_item_id,
            business_id=ligne.business_id,
            nom=ligne.nom,
            nom_du_commerce=ligne.nom_du_commerce,
            neighborhood=ligne.neighborhood,
            price_cents=ligne.price_cents,
            currency=ligne.currency,
            duration_minutes=ligne.duration_minutes,
            photo_key=ligne.photo_key,
            distance_metres=None if ligne.distance is None else round(ligne.distance, 1),
        )
        for ligne in lignes
    )


async def _commerces_par_palier_dans_le_rayon(
    session: AsyncSession, autour_de: Coordinates, rayon_metres: int
) -> dict[uuid.UUID, tuple[int, int]]:
    """Ce que chaque palier ouvre à portée : combien de salons, combien de prestations.

    **Les deux grandeurs, et c'est le point.** L'écran écrit « douze prestations
    ouvertes, dont neuf à moins de quinze kilomètres » : les deux nombres de
    cette phrase doivent compter la même chose, sinon elle compare des salons à
    des prestations et personne ne s'en aperçoit jamais. `offres_dans_le_rayon`
    répond à ça. `commerces_dans_le_rayon` répond à l'autre phrase — « chez N
    salons » — et un salon qui propose trois prestations au même palier n'y
    compte qu'une fois. Deux faits différents, deux champs, une seule requête.

    Mêmes conditions que le compte total — offre active, commerce actif, item
    disponible, parent disponible — plus la distance. Deux tamis différents
    donneraient deux nombres dont l'un contredirait l'autre sur le même écran.
    """
    point = sa.func.ST_GeogFromText(f"SRID=4326;{autour_de.as_wkt()}")
    parent = sa.orm.aliased(CatalogItem)
    lignes = await session.execute(
        sa.select(
            TierOffer.tier_id,
            sa.func.count(sa.distinct(Business.id)),
            sa.func.count(TierOffer.id),
        )
        .join(Business, Business.id == TierOffer.business_id)
        .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
        .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
        .where(
            TierOffer.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE,
            Business.geo.is_not(None),
            sa.func.ST_DWithin(sa.cast(Business.geo, Geography), point, rayon_metres),
            CatalogItem.is_available.is_(True),
            sa.or_(parent.id.is_(None), parent.is_available.is_(True)),
        )
        .group_by(TierOffer.tier_id)
    )
    return {tier_id: (salons, offres) for tier_id, salons, offres in lignes.all()}


async def _offres_par_palier(session: AsyncSession) -> dict[uuid.UUID, int]:
    """Combien de prestations chaque palier ouvre, tous commerces confondus.

    Une seule requête groupée : une par palier ferait six allers-retours pour
    un écran qui en affiche six.
    """
    parent = sa.orm.aliased(CatalogItem)
    lignes = await session.execute(
        sa.select(TierOffer.tier_id, sa.func.count(TierOffer.id))
        .join(Business, Business.id == TierOffer.business_id)
        .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
        # Un item dont le parent est désactivé ne se propose pas : l'état n'est
        # pas recopié sur l'enfant, il est joint. Même règle que le fil.
        .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
        .where(
            TierOffer.is_active.is_(True),
            Business.status == BusinessStatus.ACTIVE,
            CatalogItem.is_available.is_(True),
            sa.or_(parent.id.is_(None), parent.is_available.is_(True)),
        )
        .group_by(TierOffer.tier_id)
    )
    return {tier_id: nombre for tier_id, nombre in lignes.all()}


async def vue_des_paliers(
    session: AsyncSession,
    creator_id: uuid.UUID,
    *,
    autour_de: Coordinates | None = None,
    rayon_metres: int | None = None,
) -> VueDesPaliers:
    """La vue des paliers, et ce qu'ils ouvrent — au total, et près d'ici.

    **La position est facultative, et c'est tout le sujet.** Faire dépendre un
    écran d'identité d'une position avait été écarté, et à raison : les paliers
    d'un créateur ne changent pas parce qu'il a bougé. Mais rien n'interdit d'en
    tirer parti quand elle est là. Sans coordonnées, la réponse est celle
    d'avant au champ près ; avec, chaque palier porte en plus combien de
    commerces le proposent à portée.
    """
    verdict = await eligibility.evaluer_createur(session, creator_id)

    # Les trois champs du profil d'un coup. Trois `scalar` séparés poseraient
    # trois fois la même question à la même ligne, et surtout laisseraient le
    # badge « nouveau créateur » et le score se contredire s'ils étaient lus à
    # deux instants différents — c'est le même null qui produit les deux.
    profil = (
        await session.execute(
            sa.select(
                CreatorProfile.is_new_creator,
                CreatorProfile.reliability_score,
                CreatorProfile.completed_collabs_count,
            ).where(CreatorProfile.user_id == creator_id)
        )
    ).one_or_none()

    paliers = (
        await session.execute(
            sa.select(Tier)
            .where(Tier.is_active.is_(True))
            .order_by(Tier.platform, Tier.display_order)
        )
    ).scalars()

    offres = await _offres_par_palier(session)
    # **Une seconde requête, et seulement si on a une position.** Sans
    # coordonnées la réponse est celle d'hier au champ près : le compte vaut
    # `None`, pas zéro, et l'écran sait qu'il n'a rien demandé.
    dans_le_rayon = (
        None
        if autour_de is None
        else await _commerces_par_palier_dans_le_rayon(
            session, autour_de, rayon_metres or get_settings().feed_radius_metres
        )
    )

    par_palier: dict[uuid.UUID, list[eligibility.AccesPalier]] = {}
    for acces in verdict.acces:
        par_palier.setdefault(acces.tier_id, []).append(acces)

    vus = []
    for palier in paliers:
        candidats = par_palier.get(palier.id, [])
        ouvert = next((a for a in candidats if a.accessible), None)
        proche = ouvert or (_le_plus_proche(candidats) if candidats else None)

        vus.append(
            PalierVu(
                tier_id=palier.id,
                platform=palier.platform,
                content_format=palier.content_format,
                min_followers=palier.min_followers,
                min_completed_collabs=palier.min_completed_collabs,
                min_reliability_score=palier.min_reliability_score,
                value_ratio_hint=palier.value_ratio_hint,
                display_order=palier.display_order,
                accessible=ouvert is not None,
                social_account_id=proche.social_account_id if proche else None,
                offres_disponibles=offres.get(palier.id, 0),
                offres_dans_le_rayon=(
                    None if dans_le_rayon is None else dans_le_rayon.get(palier.id, (0, 0))[1]
                ),
                commerces_dans_le_rayon=(
                    None if dans_le_rayon is None else dans_le_rayon.get(palier.id, (0, 0))[0]
                ),
                obstacles=(
                    proche.obstacles
                    if proche is not None
                    # Aucun compte social : le moteur n'a rien à évaluer, donc
                    # rien à reprocher. Sans cette branche l'écran dirait
                    # « inaccessible » sans dire quoi faire.
                    else (eligibility.Obstacle(raison=eligibility.RaisonRefus.NO_SOCIAL_ACCOUNT),)
                ),
            )
        )

    return VueDesPaliers(
        prochain_palier=_prochain_palier(vus),
        creator_id=creator_id,
        # Sans profil, aucun historique : c'est exactement l'état d'un nouveau
        # créateur, et non une erreur à remonter sur un écran de lecture.
        is_new_creator=bool(profil.is_new_creator) if profil else True,
        fiabilite=Fiabilite(
            reliability_score=profil.reliability_score if profil else None,
            completed_collabs_count=profil.completed_collabs_count if profil else 0,
        ),
        paliers=tuple(vus),
    )


#: L'échelle du produit, du moins au plus exigeant. Elle départage deux paliers
#: à qui il manque le même nombre de conditions.
_ECHELLE = {ContentFormat.STORY: 0, ContentFormat.POST: 1, ContentFormat.REEL: 2}


def _prochain_palier(vus: list[PalierVu]) -> ProchainPalier | None:
    """Le plus proche des paliers fermés, sur les paliers déjà évalués.

    **Classé sur le nombre de conditions qui manquent, pas sur leur ampleur.**
    Voir `ProchainPalier` : comparer un écart d'abonnés à un nombre de
    collaborations revient à inventer un ordre.

    Un palier fermé sans obstacle nommable est écarté : il n'y aurait rien à
    afficher, et « il vous manque quelque chose » n'aide personne.

    **Les deux conditions du filtre sont aujourd'hui redondantes, et gardées.**
    Retirer `not palier.accessible` ne change aucun verdict — vérifié par
    mutation — parce qu'un palier accessible ne porte jamais d'obstacle : la
    seconde condition l'écarte déjà. Elles ne disent pourtant pas la même chose.
    `not accessible` est la règle : on ne propose pas de viser ce qui est
    ouvert. `obstacles` est une sûreté : `obstacles[0]`, deux lignes plus bas,
    lèverait sur une liste vide.

    Le jour où l'éligibilité rendrait un palier accessible **avec** une réserve
    — un plafond de score, une condition en sursis — la première reprendrait
    seule le travail. Écrire la règle et compter sur la sûreté pour l'appliquer
    marcherait, jusqu'à ce que ça cesse.
    """
    fermes = sorted(
        (palier for palier in vus if not palier.accessible and palier.obstacles),
        key=lambda p: (len(p.obstacles), _ECHELLE.get(p.content_format, 9)),
    )
    if not fermes:
        return None

    plus_proche = fermes[0]
    return ProchainPalier(
        tier_id=plus_proche.tier_id,
        platform=plus_proche.platform,
        content_format=plus_proche.content_format,
        obstacle=plus_proche.obstacles[0],
        commerces_dans_le_rayon=plus_proche.commerces_dans_le_rayon,
    )
