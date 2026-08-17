"""Le fil du créateur.

**Le fil liste des commerces, pas des offres.** Un créateur se déplace vers un
lieu ; lui présenter quinze lignes du même salon parce qu'il propose quinze
soins ferait disparaître les autres commerces du quartier.

**Un item n'apparaît jamais s'il n'est pas réservable.** Palier inéligible, item
désactivé — directement ou par son parent — aucun créneau libre dans l'horizon :
dans tous les cas il ne s'affiche pas. Un fil qui montre des choses
indisponibles détruit la confiance en deux jours, et le créateur cesse de
regarder avant qu'on ait eu le temps de corriger.

**Les obstacles sont renvoyés à part.** Un fil vide ou maigre sans explication
est indistinguable d'un produit cassé : le créateur conclut qu'il n'y a rien à
Miami, alors qu'il lui manque un relevé de métriques ou mille abonnés. Les
paliers hors d'atteinte ne sont pas affichés dans le fil — ils l'encombreraient
— mais leurs obstacles accompagnent la réponse, et l'app peut dire pourquoi.

C'est la différence exacte avec l'écran des paliers, où tous les paliers sont
montrés : là-bas un palier fermé oriente, ici il encombre.
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import NamedTuple

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import Coordinates
from app.models import Business, CatalogItem, Tier, TierOffer
from app.models.enums import (
    BusinessCategory,
    BusinessStatus,
    ContentFormat,
    Neighborhood,
    Platform,
)
from app.services import availability, eligibility


@dataclass(frozen=True, slots=True)
class ItemDuFil:
    tier_offer_id: uuid.UUID
    catalog_item_id: uuid.UUID
    tier_id: uuid.UUID
    social_account_id: uuid.UUID
    name: str
    description: str | None
    price_cents: int
    currency: str
    duration_minutes: int | None
    requires_booking: bool
    photo_key: str | None
    platform: Platform
    content_format: ContentFormat
    #: Rapport entre la valeur de l'item et la référence du palier. En dessous
    #: de 1, l'offre est en deçà de ce que le palier suggère. Renvoyé, jamais
    #: utilisé pour masquer : le commerce compose ce qu'il veut, le créateur
    #: sait ce qu'il accepte.
    value_ratio: Decimal | None


class _EnTete(NamedTuple):
    """Ce qu'on retient d'un commerce en parcourant ses lignes.

    Nommé et non positionnel : c'était un tuple lu par indices, et y insérer un
    champ décalait tout ce qui suivait — l'adresse serait devenue le quartier
    sans qu'aucun type ne s'en plaigne.
    """

    nom: str
    categorie: BusinessCategory
    adresse: str | None
    quartier: Neighborhood | None
    couverture: str | None
    couverture_verticale: str | None
    distance: float


@dataclass(frozen=True, slots=True)
class CommerceDuFil:
    business_id: uuid.UUID
    name: str
    category: BusinessCategory
    address: str | None
    #: Le quartier déclaré par le commerce. `None` hors des quartiers ouverts.
    neighborhood: Neighborhood | None
    cover_photo_key: str | None
    #: La couverture verticale du mur. `None` : le mur retombe sur la paysage.
    cover_portrait_key: str | None
    distance_metres: float
    items: tuple[ItemDuFil, ...]


@dataclass(frozen=True, slots=True)
class CompteParCategorie:
    """Ce qu'une catégorie rapporterait, dans le rayon courant.

    Compté **sans** le filtre de catégorie en vigueur : c'est ce qui permet
    d'écrire « Retirer le filtre Spa · 34 salons » et de n'afficher que les
    pastilles qui mènent quelque part.
    """

    categorie: BusinessCategory
    commerces: int
    prestations: int


@dataclass(frozen=True, slots=True)
class CompteParQuartier:
    """Un quartier du fil courant : combien de salons, et à quelle distance.

    **La distance est celle du salon le plus proche**, jamais une moyenne. Un
    quartier se choisit pour s'y rendre : « Wynwood · 4 salons · 1,2 km » dit
    qu'il y a quelque chose à 1,2 km, ce qui est une information vérifiable sur
    place. Une moyenne ne désignerait aucun salon existant.

    **Compté sur le fil rendu**, comme les catégories : mêmes paliers, mêmes
    items disponibles. Un compte plus large promettrait des salons que l'écran
    suivant ne rendrait pas.

    Les salons sans quartier déclaré ne sont dans aucun groupe. Ils restent
    dans le fil : ils sont réservables, ils ne sont simplement pas situés.
    """

    quartier: Neighborhood
    commerces: int
    prestations: int
    #: La distance du salon le plus proche de ce quartier, en mètres.
    distance_metres: float


@dataclass(frozen=True, slots=True)
class ProchainPalier:
    """Le palier le plus proche d'être atteint, et ce qu'il ouvrirait.

    **Le seul endroit du produit où une créatrice croise ce qui lui manque sans
    l'avoir cherché**, et le seul depuis que les paliers ont quitté les onglets.
    Un pied de fil qui dirait « d'autres salons » sans les compter serait une
    bannière ; c'est le chiffre qui en fait une promesse.

    **Le plus proche, pas le plus généreux.** On classe sur l'écart qui reste à
    combler, jamais sur le nombre de salons gagnés : proposer le palier le plus
    rémunérateur enverrait chercher ce qui est le plus loin, ce qui décourage
    exactement la personne qu'on veut aider.

    **Compté sur le même tamis que la liste** — mêmes commerces dans le rayon,
    mêmes items disponibles, même contrôle de créneau. Un compte plus large
    promettrait des salons que l'écran suivant ne rendrait pas.
    """

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    #: Les commerces que ce palier ouvrirait **en plus** de ceux déjà rendus.
    commerces_de_plus: int
    #: Ce qui manque pour l'atteindre : la raison, le requis, l'écart.
    obstacle: eligibility.Obstacle


@dataclass(frozen=True, slots=True)
class CompteParRayon:
    """Ce qu'un élargissement rapporterait, filtre de catégorie conservé.

    Seuls les rayons **plus larges** que le rayon courant sont proposés :
    rétrécir n'est pas une issue à un fil vide.
    """

    rayon_metres: int
    commerces: int
    prestations: int


@dataclass(frozen=True, slots=True)
class Fil:
    commerces: tuple[CommerceDuFil, ...]
    #: Ce qui empêche d'accéder aux paliers non représentés. Vide quand tous
    #: sont accessibles. C'est ce qui permet à l'app de distinguer « il n'y a
    #: rien près de chez toi » de « tu n'as pas encore accès ».
    obstacles: tuple[eligibility.Obstacle, ...]
    #: Le rayon réellement appliqué. Demandé ou par défaut, l'app ne le devine
    #: pas : c'est lui qui s'écrit dans « Wynwood · rayon 3 km ».
    rayon_metres: int
    #: Le nombre de prestations du fil rendu. Le titre l'annonce, et le compter
    #: dans l'app obligerait à additionner ce qu'elle vient de recevoir — juste
    #: aujourd'hui, faux le jour où la liste sera paginée.
    total_prestations: int
    #: Les catégories qui mènent quelque part, dans le rayon courant. Une
    #: catégorie sans commerce réservable n'y figure pas : une pastille qui
    #: ouvre sur du vide est une action impossible, et `components.md` §1 les
    #: retire au lieu de les griser.
    categories: tuple[CompteParCategorie, ...]
    #: Les élargissements possibles, avec leur gain. Vide quand aucun rayon
    #: configuré n'est plus large que celui en vigueur.
    rayons: tuple[CompteParRayon, ...]
    #: Les quartiers représentés dans le fil rendu, du plus proche au plus
    #: lointain. Vide quand aucun salon rendu n'a déclaré de quartier.
    quartiers: tuple[CompteParQuartier, ...]
    #: Le palier le plus proche, et ce qu'il ouvrirait. `None` quand tout est
    #: ouvert, qu'aucun n'est atteignable, ou qu'il n'ouvrirait aucun salon.
    prochain_palier: ProchainPalier | None


async def fil_du_createur(
    session: AsyncSession,
    *,
    creator_id: uuid.UUID,
    autour_de: Coordinates,
    rayon_metres: int | None = None,
    categorie: BusinessCategory | None = None,
) -> Fil:
    settings = get_settings()
    rayon = rayon_metres or settings.feed_radius_metres
    # Les élargissements proposés, et le rayon le plus large à balayer. On
    # interroge une fois au plus large et on découpe ensuite : compter chaque
    # rayon par une requête de plus multiplierait le contrôle de disponibilité,
    # qui est déjà le calcul le plus cher du fil.
    elargissements = tuple(
        sorted(option for option in settings.feed_radius_options_metres if option > rayon)
    )
    balayage = max((rayon, *elargissements))

    verdict = await eligibility.evaluer_createur(session, creator_id)
    accessibles = verdict.couples_accessibles

    if not accessibles:
        # Aucun palier ouvert : le fil est vide, et il faut dire pourquoi.
        # Rendre une liste vide sans obstacle laisserait croire qu'il n'y a
        # aucun commerce, ce qui est faux et décourageant.
        #
        # Aucun compte non plus : élargir le rayon ou changer de catégorie n'y
        # changerait rien, et proposer ces issues enverrait chercher ailleurs
        # une cause qui est ici. Les listes sont vides, délibérément.
        return Fil(
            commerces=(),
            obstacles=_obstacles_les_plus_proches(verdict),
            rayon_metres=rayon,
            total_prestations=0,
            categories=(),
            rayons=(),
            quartiers=(),
            prochain_palier=None,
        )

    paliers_ouverts = {tier_id for _, tier_id in accessibles}
    #: Quel compte social ouvre quel palier. La réservation en aura besoin :
    #: elle se fait au nom d'un compte précis, pas du créateur en général.
    compte_par_palier = {tier_id: compte for compte, tier_id in accessibles}

    point = sa.func.ST_GeogFromText(f"SRID=4326;{autour_de.as_wkt()}")
    distance = sa.func.ST_Distance(sa.cast(Business.geo, Geography), point).label("distance")

    lignes = (
        await session.execute(
            sa.select(
                Business.id,
                Business.name,
                Business.category,
                Business.address,
                Business.neighborhood,
                Business.cover_photo_key,
                Business.cover_portrait_key,
                Business.currency,
                distance,
                TierOffer.id.label("tier_offer_id"),
                TierOffer.tier_id,
                CatalogItem.id.label("catalog_item_id"),
                CatalogItem.name.label("item_name"),
                CatalogItem.description,
                CatalogItem.price_cents,
                CatalogItem.duration_minutes,
                CatalogItem.requires_booking,
                CatalogItem.photo_key,
                Tier.platform,
                Tier.content_format,
                Tier.value_ratio_hint,
            )
            .join(TierOffer, TierOffer.business_id == Business.id)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .join(Tier, Tier.id == TierOffer.tier_id)
            # `parent` : un item dont le parent est désactivé ne s'affiche pas.
            # L'état n'est pas recopié sur l'enfant, il est joint.
            .outerjoin(
                parent := sa.orm.aliased(CatalogItem),
                parent.id == CatalogItem.parent_item_id,
            )
            .where(
                Business.status == BusinessStatus.ACTIVE,
                Business.geo.is_not(None),
                # **Le balayage, pas le rayon demandé.** Les comptes annoncés
                # sur les issues — « Élargir à 5 km · 9 salons » — doivent
                # sortir du même tamis que la liste, sinon ils promettent ce
                # que l'écran suivant ne rendra pas. Une seconde requête plus
                # large les rendrait vrais aussi ; elle referait aussi tout le
                # contrôle de disponibilité.
                sa.func.ST_DWithin(sa.cast(Business.geo, Geography), point, balayage),
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                Tier.id.in_(paliers_ouverts),
                CatalogItem.is_available.is_(True),
                sa.or_(parent.id.is_(None), parent.is_available.is_(True)),
                # Le filtre de catégorie ne s'applique pas ici non plus : les
                # pastilles annoncent ce que **les autres** catégories
                # rapporteraient, et le filtre les aurait effacées.
            )
            .order_by(distance, Business.id, CatalogItem.name)
        )
    ).all()

    # Toutes les lignes réservables du balayage, filtres d'affichage exclus.
    # Le contrôle de disponibilité ne se fait qu'ici : la liste et chacun des
    # comptes se découpent ensuite dans le même ensemble, et ne peuvent donc
    # pas se contredire.
    reservables = [
        ligne
        for ligne in lignes
        if not ligne.requires_booking or await _reste_un_creneau(session, ligne)
    ]

    categories = _compter_par_categorie(reservables, rayon)
    rayons = _compter_par_rayon(reservables, elargissements, categorie)

    par_commerce: dict[uuid.UUID, list] = {}
    entetes: dict[uuid.UUID, tuple] = {}

    for ligne in reservables:
        if ligne.distance > rayon:
            continue
        if categorie is not None and ligne.category != categorie:
            continue

        entetes.setdefault(
            ligne.id,
            _EnTete(
                nom=ligne.name,
                categorie=ligne.category,
                adresse=ligne.address,
                quartier=ligne.neighborhood,
                couverture=ligne.cover_photo_key,
                couverture_verticale=ligne.cover_portrait_key,
                distance=ligne.distance,
            ),
        )
        par_commerce.setdefault(ligne.id, []).append(
            ItemDuFil(
                tier_offer_id=ligne.tier_offer_id,
                catalog_item_id=ligne.catalog_item_id,
                tier_id=ligne.tier_id,
                social_account_id=compte_par_palier[ligne.tier_id],
                name=ligne.item_name,
                description=ligne.description,
                price_cents=ligne.price_cents,
                currency=ligne.currency,
                duration_minutes=ligne.duration_minutes,
                requires_booking=ligne.requires_booking,
                photo_key=ligne.photo_key,
                platform=ligne.platform,
                content_format=ligne.content_format,
                value_ratio=ratio_de_valeur(ligne.price_cents, ligne.value_ratio_hint),
            )
        )

    commerces = tuple(
        CommerceDuFil(
            business_id=business_id,
            name=entetes[business_id].nom,
            category=entetes[business_id].categorie,
            address=entetes[business_id].adresse,
            neighborhood=entetes[business_id].quartier,
            cover_photo_key=entetes[business_id].couverture,
            cover_portrait_key=entetes[business_id].couverture_verticale,
            distance_metres=round(entetes[business_id].distance, 1),
            items=tuple(items),
        )
        for business_id, items in par_commerce.items()
    )

    return Fil(
        commerces=commerces,
        # Même quand le fil n'est pas vide : un créateur qui accède au palier
        # story mais pas au palier reel doit savoir ce qui lui manque pour le
        # second, sinon il croit avoir tout vu.
        obstacles=_obstacles_les_plus_proches(verdict),
        rayon_metres=rayon,
        total_prestations=sum(len(commerce.items) for commerce in commerces),
        categories=categories,
        rayons=rayons,
        quartiers=_compter_par_quartier(commerces),
        prochain_palier=await _prochain_palier(
            session,
            verdict=verdict,
            commerces=commerces,
            point=point,
            rayon=rayon,
            paliers_ouverts=paliers_ouverts,
        ),
    )


async def _prochain_palier(
    session: AsyncSession,
    *,
    verdict: eligibility.Eligibilite,
    commerces: tuple[CommerceDuFil, ...],
    point,
    rayon: int,
    paliers_ouverts: set[uuid.UUID],
) -> ProchainPalier | None:
    """Le palier hors d'atteinte le plus proche, et les salons qu'il ouvrirait.

    **Classé sur le nombre de conditions qui manquent, pas sur leur ampleur.**
    Une première version triait sur l'écart brut : elle plaçait « une
    collaboration de plus » devant « cinq mille abonnés de plus » parce que
    1 < 5000. Ce sont deux grandeurs sans rapport, et les comparer revenait à
    inventer un ordre. Le nombre de conditions non remplies, lui, se compare :
    à qui il manque une chose est plus proche qu'à qui il en manque deux. À
    égalité, l'échelle du produit tranche — story, puis post, puis reel.

    **On essaie les candidats dans l'ordre**, et on rend le premier qui ouvre
    vraiment quelque chose. S'arrêter au plus proche ferait taire le pied dès
    que ce palier-là n'a aucun salon dans le rayon, alors que le suivant en a.
    """
    ECHELLE = {ContentFormat.STORY: 0, ContentFormat.POST: 1, ContentFormat.REEL: 2}

    fermes = sorted(
        (
            acces
            for acces in verdict.acces
            if not acces.accessible and acces.tier_id not in paliers_ouverts
        ),
        key=lambda a: (len(a.obstacles), ECHELLE.get(a.content_format, 9)),
    )

    deja = {commerce.business_id for commerce in commerces}

    for plus_proche in fermes:
        if not plus_proche.obstacles:
            continue

        # Ce que ce palier ouvrirait **en plus**. Une requête à part, et c'est
        # obligé : la requête du fil filtre sur `Tier.id.in_(paliers_ouverts)`,
        # donc aucune ligne d'un palier fermé n'en sort. Compter sur elle aurait
        # toujours rendu zéro — un pied muet, sans que rien ne le signale.
        de_plus = await session.scalar(
            sa.select(sa.func.count(sa.distinct(Business.id)))
            .select_from(Business)
            .join(TierOffer, TierOffer.business_id == Business.id)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .where(
                Business.status == BusinessStatus.ACTIVE,
                Business.geo.is_not(None),
                sa.func.ST_DWithin(sa.cast(Business.geo, Geography), point, rayon),
                TierOffer.tier_id == plus_proche.tier_id,
                TierOffer.is_active.is_(True),
                CatalogItem.is_available.is_(True),
                Business.id.not_in(deja) if deja else sa.true(),
            )
        )
        if not de_plus:
            continue

        return ProchainPalier(
            tier_id=plus_proche.tier_id,
            platform=plus_proche.platform,
            content_format=plus_proche.content_format,
            commerces_de_plus=de_plus,
            # Le premier obstacle du palier : ils sont déjà rangés par le moteur
            # d'éligibilité, et le premier est celui qu'on affiche.
            obstacle=plus_proche.obstacles[0],
        )

    return None


def _compter_par_quartier(commerces: tuple[CommerceDuFil, ...]) -> tuple[CompteParQuartier, ...]:
    """Groupe le fil **déjà rendu** par quartier.

    Sur la liste et non sur une seconde requête : deux comptes calculés
    séparément divergent dès qu'un filtre change, et c'est le compte affiché qui
    aurait tort. Le tri suit la distance du plus proche, parce que c'est l'ordre
    dans lequel on choisit où aller.
    """
    groupes: dict[Neighborhood, list[CommerceDuFil]] = {}
    for commerce in commerces:
        if commerce.neighborhood is None:
            continue
        groupes.setdefault(commerce.neighborhood, []).append(commerce)

    return tuple(
        sorted(
            (
                CompteParQuartier(
                    quartier=quartier,
                    commerces=len(lot),
                    prestations=sum(len(c.items) for c in lot),
                    distance_metres=min(c.distance_metres for c in lot),
                )
                for quartier, lot in groupes.items()
            ),
            key=lambda compte: compte.distance_metres,
        )
    )


def _compter_par_categorie(reservables: list, rayon: int) -> tuple[CompteParCategorie, ...]:
    """Ce que chaque catégorie rapporte dans le rayon courant.

    **Sans le filtre de catégorie en vigueur** : une pastille dit ce qu'elle
    ouvrirait, pas ce que la sélection actuelle contient. Les catégories sans
    commerce réservable n'apparaissent pas — une pastille qui ouvre sur du vide
    est une action impossible, et on les retire au lieu de les griser.

    L'ordre suit celui de l'énumération, pas le nombre : des pastilles qui
    changent de place à chaque rafraîchissement se repèrent mal.
    """
    commerces: dict[BusinessCategory, set] = {}
    prestations: dict[BusinessCategory, int] = {}

    for ligne in reservables:
        if ligne.distance > rayon:
            continue
        commerces.setdefault(ligne.category, set()).add(ligne.id)
        prestations[ligne.category] = prestations.get(ligne.category, 0) + 1

    return tuple(
        CompteParCategorie(
            categorie=categorie,
            commerces=len(commerces[categorie]),
            prestations=prestations[categorie],
        )
        for categorie in BusinessCategory
        if categorie in commerces
    )


def _compter_par_rayon(
    reservables: list,
    elargissements: tuple[int, ...],
    categorie: BusinessCategory | None,
) -> tuple[CompteParRayon, ...]:
    """Ce que chaque élargissement rapporte, **filtre de catégorie conservé**.

    Les deux issues d'un fil vide ne se mélangent pas : « Élargir à 5 km »
    garde le filtre Spa, « Retirer le filtre Spa » garde le rayon. Compter l'un
    en relâchant l'autre annoncerait un total que ni l'une ni l'autre ne rend.
    """
    retenues = [ligne for ligne in reservables if categorie is None or ligne.category == categorie]

    comptes = []
    for option in elargissements:
        dedans = [ligne for ligne in retenues if ligne.distance <= option]
        comptes.append(
            CompteParRayon(
                rayon_metres=option,
                commerces=len({ligne.id for ligne in dedans}),
                prestations=len(dedans),
            )
        )
    return tuple(comptes)


async def _reste_un_creneau(session: AsyncSession, ligne) -> bool:
    """Un seul suffit. `limite=1` arrête le parcours au premier trouvé."""
    creneaux = await availability.creneaux_libres(
        session,
        business_id=ligne.id,
        catalog_item_id=ligne.catalog_item_id,
        limite=1,
    )
    return bool(creneaux)


def ratio_de_valeur(price_cents: int, value_ratio_hint: Decimal | None) -> Decimal | None:
    """Situe la valeur de l'item par rapport à la référence du palier.

    Rendu tel quel, sans jugement : SPEC.md §3.3 demande de *signaler* une offre
    nettement en dessous, pas de la masquer ni de la bloquer. Le commerce reste
    libre de composer ce qu'il veut, le créateur sait ce qu'il accepte.
    """
    if value_ratio_hint is None or value_ratio_hint == 0:
        return None
    return (Decimal(price_cents) / Decimal(100) / value_ratio_hint).quantize(Decimal("0.01"))


def _obstacles_les_plus_proches(verdict: eligibility.Eligibilite) -> tuple:
    """Les obstacles de tous les paliers hors d'atteinte, dédoublonnés.

    **Un créateur sans aucun compte social n'a aucun obstacle**, au sens du
    moteur : il n'y a pas de couple (compte, palier) à évaluer, donc rien à
    reprocher. Le fil rendait alors zéro commerce **et** zéro obstacle, et
    l'app n'avait plus qu'une explication possible à donner — « rien autour de
    toi » — qui est fausse et décourageante. C'est le piège de l'ensemble vide,
    déjà nommé dans `creator_tiers` ; il valait aussi ici.
    """
    obstacles = eligibility.dedoublonner(
        obstacle for acces in verdict.acces if not acces.accessible for obstacle in acces.obstacles
    )
    if obstacles or verdict.acces:
        return obstacles
    return (eligibility.Obstacle(raison=eligibility.RaisonRefus.NO_SOCIAL_ACCOUNT),)
