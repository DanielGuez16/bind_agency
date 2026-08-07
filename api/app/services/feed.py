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

import sqlalchemy as sa
from geoalchemy2 import Geography
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.geocoding import Coordinates
from app.models import Business, CatalogItem, Tier, TierOffer
from app.models.enums import BusinessCategory, BusinessStatus, ContentFormat, Platform
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


@dataclass(frozen=True, slots=True)
class CommerceDuFil:
    business_id: uuid.UUID
    name: str
    category: BusinessCategory
    address: str | None
    cover_photo_key: str | None
    distance_metres: float
    items: tuple[ItemDuFil, ...]


@dataclass(frozen=True, slots=True)
class Fil:
    commerces: tuple[CommerceDuFil, ...]
    #: Ce qui empêche d'accéder aux paliers non représentés. Vide quand tous
    #: sont accessibles. C'est ce qui permet à l'app de distinguer « il n'y a
    #: rien près de chez toi » de « tu n'as pas encore accès ».
    obstacles: tuple[eligibility.Obstacle, ...]


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

    verdict = await eligibility.evaluer_createur(session, creator_id)
    accessibles = verdict.couples_accessibles

    if not accessibles:
        # Aucun palier ouvert : le fil est vide, et il faut dire pourquoi.
        # Rendre une liste vide sans obstacle laisserait croire qu'il n'y a
        # aucun commerce, ce qui est faux et décourageant.
        return Fil(commerces=(), obstacles=_obstacles_les_plus_proches(verdict))

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
                Business.cover_photo_key,
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
                sa.func.ST_DWithin(sa.cast(Business.geo, Geography), point, rayon),
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                Tier.id.in_(paliers_ouverts),
                CatalogItem.is_available.is_(True),
                sa.or_(parent.id.is_(None), parent.is_available.is_(True)),
                *([Business.category == categorie] if categorie else []),
            )
            .order_by(distance, Business.id, CatalogItem.name)
        )
    ).all()

    par_commerce: dict[uuid.UUID, list] = {}
    entetes: dict[uuid.UUID, tuple] = {}

    for ligne in lignes:
        if ligne.requires_booking and not await _reste_un_creneau(session, ligne):
            # Plus aucun créneau dans l'horizon : l'item n'existe pas pour ce
            # créateur aujourd'hui. C'est le filtre le plus coûteux, donc le
            # dernier — tout ce qui pouvait être écarté par une requête l'a été.
            continue

        entetes.setdefault(
            ligne.id,
            (ligne.name, ligne.category, ligne.address, ligne.cover_photo_key, ligne.distance),
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
            name=entetes[business_id][0],
            category=entetes[business_id][1],
            address=entetes[business_id][2],
            cover_photo_key=entetes[business_id][3],
            distance_metres=round(entetes[business_id][4], 1),
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
    )


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
    """Les obstacles de tous les paliers hors d'atteinte, dédoublonnés."""
    return eligibility.dedoublonner(
        obstacle for acces in verdict.acces if not acces.accessible for obstacle in acces.obstacles
    )
