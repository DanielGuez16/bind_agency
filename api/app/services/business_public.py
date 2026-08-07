"""La fiche d'un commerce, lue par un créateur qui n'en est pas membre.

C'est la seule vue d'un commerce accessible sans appartenance, et elle est
volontairement étroite : profil, photos, offres, disponibilités. Pas les
réservations, pas les membres, pas le chiffre d'affaires. Le résolveur
d'appartenance protège `/business/{id}` ; ici il n'y a rien à protéger parce
qu'il n'y a rien de confidentiel à rendre.

**Le fil mène droit ici.** Sans cette route le parcours principal s'arrête à la
carte du fil : le créateur voit un commerce, ne peut pas l'ouvrir, et n'a aucun
moyen de choisir entre deux prestations du même salon.

**Contrairement au fil, un palier fermé ne disparaît pas.** Le fil masque ce
qui n'est pas réservable parce qu'un fil encombré de prestations inaccessibles
détruit la confiance. Une fiche, elle, est déjà ouverte : le créateur a choisi
ce commerce, et masquer la moitié de sa carte lui ferait croire que le salon
propose trois soins quand il en propose huit. Chaque offre porte donc son
`accessible` et, quand elle est fermée, les obstacles qui la ferment — la même
logique que l'écran des paliers.

**Un commerce inactif n'existe pas ici.** Il répond 404 et non 403 : il n'y a
pas de droit à refuser, la ressource n'est pas publiée. Aucune information
n'est divulguée par cette distinction, puisque la même réponse couvre le
commerce absent.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, CatalogItem, Tier, TierOffer
from app.models.enums import BusinessCategory, BusinessStatus, ContentFormat, Platform
from app.services import availability, eligibility
from app.services.feed import ratio_de_valeur

#: Assez pour écrire « prochaine place mardi 14 h », pas assez pour composer un
#: écran de choix de créneau. Celui-là appelle `/businesses/{id}/availability`,
#: qui sait viser une date. Calculer trente jours de créneaux pour chaque item
#: d'une carte de quinze lignes coûterait le prix d'un écran complet pour
#: afficher une phrase.
PROCHAINS_CRENEAUX = 3


class BusinessPublicError(Exception):
    pass


class BusinessNotPublic(BusinessPublicError):
    """Absent, ou pas encore actif. Les deux se répondent pareil."""


@dataclass(frozen=True, slots=True)
class OffreDeLaFiche:
    tier_offer_id: uuid.UUID
    catalog_item_id: uuid.UUID
    tier_id: uuid.UUID
    name: str
    description: str | None
    price_cents: int
    currency: str
    duration_minutes: int | None
    requires_booking: bool
    photo_key: str | None
    platform: Platform
    content_format: ContentFormat
    required_mention: str | None
    required_geotag: bool
    value_ratio: Decimal | None
    #: Le palier est-il ouvert à ce créateur, aujourd'hui.
    accessible: bool
    #: Le compte social qui ouvre le palier. Nul quand l'offre est fermée : la
    #: réservation se fait au nom d'un compte précis, et il n'y en a pas.
    social_account_id: uuid.UUID | None
    #: Ce qui ferme le palier. Vide quand il est ouvert.
    obstacles: tuple[eligibility.Obstacle, ...]
    #: Vide sur un item sans réservation — il n'a pas de créneaux, il a une
    #: fenêtre de validité. Vide aussi sur un item complet, ce qui n'est pas la
    #: même chose et se distingue par `requires_booking`.
    prochains_creneaux: tuple[datetime, ...]


@dataclass(frozen=True, slots=True)
class FichePublique:
    business_id: uuid.UUID
    name: str
    category: BusinessCategory
    address: str | None
    timezone: str
    phone: str | None
    cover_photo_key: str | None
    offres: tuple[OffreDeLaFiche, ...]


async def fiche(
    session: AsyncSession, *, business_id: uuid.UUID, creator_id: uuid.UUID
) -> FichePublique:
    business = await session.scalar(
        sa.select(Business).where(
            Business.id == business_id, Business.status == BusinessStatus.ACTIVE
        )
    )
    if business is None:
        raise BusinessNotPublic(business_id)

    verdict = await eligibility.evaluer_createur(session, creator_id)
    compte_par_palier = {tier_id: compte for compte, tier_id in verdict.couples_accessibles}
    # Un palier peut être évalué pour plusieurs comptes sociaux : ses
    # obstacles sont donc rassemblés, puis dédoublonnés par raison comme dans
    # le fil. Prendre ceux du dernier compte rencontré donnerait une réponse
    # qui dépend de l'ordre des lignes.
    obstacles_par_palier: dict[uuid.UUID, list[eligibility.Obstacle]] = {}
    for acces in verdict.acces:
        if not acces.accessible:
            obstacles_par_palier.setdefault(acces.tier_id, []).extend(acces.obstacles)

    parent = sa.orm.aliased(CatalogItem)
    lignes = (
        await session.execute(
            sa.select(
                TierOffer.id.label("tier_offer_id"),
                TierOffer.tier_id,
                TierOffer.required_mention,
                TierOffer.required_geotag,
                CatalogItem.id.label("catalog_item_id"),
                CatalogItem.name,
                CatalogItem.description,
                CatalogItem.price_cents,
                CatalogItem.duration_minutes,
                CatalogItem.requires_booking,
                CatalogItem.photo_key,
                Tier.platform,
                Tier.content_format,
                Tier.value_ratio_hint,
                Tier.display_order,
            )
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
            .where(
                TierOffer.business_id == business.id,
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                CatalogItem.is_available.is_(True),
                sa.or_(parent.id.is_(None), parent.is_available.is_(True)),
            )
            .order_by(Tier.display_order, CatalogItem.name)
        )
    ).all()

    offres = []
    for ligne in lignes:
        compte = compte_par_palier.get(ligne.tier_id)
        accessible = compte is not None

        # Les créneaux ne se calculent que sur une offre ouverte. Les calculer
        # sur un palier fermé ferait payer le parcours de disponibilité pour
        # une information que le créateur ne peut pas utiliser.
        creneaux: tuple[datetime, ...] = ()
        if accessible and ligne.requires_booking:
            creneaux = tuple(
                c.starts_at
                for c in await availability.creneaux_libres(
                    session,
                    business_id=business.id,
                    catalog_item_id=ligne.catalog_item_id,
                    limite=PROCHAINS_CRENEAUX,
                )
            )

        offres.append(
            OffreDeLaFiche(
                tier_offer_id=ligne.tier_offer_id,
                catalog_item_id=ligne.catalog_item_id,
                tier_id=ligne.tier_id,
                name=ligne.name,
                description=ligne.description,
                price_cents=ligne.price_cents,
                currency=business.currency,
                duration_minutes=ligne.duration_minutes,
                requires_booking=ligne.requires_booking,
                photo_key=ligne.photo_key,
                platform=ligne.platform,
                content_format=ligne.content_format,
                required_mention=ligne.required_mention,
                required_geotag=ligne.required_geotag,
                value_ratio=ratio_de_valeur(ligne.price_cents, ligne.value_ratio_hint),
                accessible=accessible,
                social_account_id=compte,
                obstacles=()
                if accessible
                else eligibility.dedoublonner(obstacles_par_palier.get(ligne.tier_id, ())),
                prochains_creneaux=creneaux,
            )
        )

    return FichePublique(
        business_id=business.id,
        name=business.name,
        category=business.category,
        address=business.address,
        timezone=business.timezone,
        phone=business.phone,
        cover_photo_key=business.cover_photo_key,
        offres=tuple(offres),
    )
