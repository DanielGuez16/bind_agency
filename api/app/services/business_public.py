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
from app.services import availability, business_menu, business_photos, eligibility
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
    #: La prestation laisse-t-elle un choix. Vrai : le créateur choisira sur
    #: place, et la carte est ce qui lui dit quoi. C'est ce drapeau qui rend
    #: l'accès à la carte utile plutôt que décoratif — sans lui, l'écran ne
    #: saurait pas quelles offres appellent une lecture avant de réserver.
    leaves_choice: bool
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
    #: La galerie, dans l'ordre choisi par le commerce. Distincte de la
    #: couverture : celle-ci est l'image de la carte du fil, calibrée pour
    #: tenir en petit ; la galerie est ce que la fiche déroule.
    photos: tuple[str, ...]
    #: Les pages de la carte, dans l'ordre où elle se lit. **Distinctes de la
    #: galerie** : la galerie montre le lieu, la carte se consulte. L'écran leur
    #: donne deux accès différents.
    menu_pages: tuple[str, ...]
    #: L'adresse de la carte en ligne, quand le commerce en a une.
    #:
    #: **L'écran doit dire qu'on sortira de l'application** quand c'est la seule
    #: forme disponible — `menu_pages` vide et celle-ci renseignée. Un lien qui
    #: s'ouvre sans prévenir, au milieu d'un parcours de réservation, fait
    #: perdre le fil à qui revient.
    menu_url: str | None
    offres: tuple[OffreDeLaFiche, ...]


def _obstacles_de(
    par_palier: dict[uuid.UUID, list[eligibility.Obstacle]], tier_id: uuid.UUID
) -> tuple[eligibility.Obstacle, ...]:
    """Ce qui ferme un palier — et jamais rien du tout.

    **Un palier fermé sans obstacle est le pire des états.** L'offre s'affiche
    « pas encore ouverte à toi », et rien ne dit ce qui manque : le créateur
    n'a aucun geste à faire, et conclut que le produit ne veut pas de lui.

    Le moteur n'évalue que les couples (compte, palier) **de même plateforme**.
    Un palier TikTok chez quelqu'un qui n'a connecté qu'Instagram n'a donc
    aucun couple, donc aucun obstacle à reprocher — ce n'est pas un accès sans
    reproche, c'est un accès jamais examiné. Le cas est plus fréquent que
    l'absence totale de compte : il suffit d'un salon qui compose un palier sur
    un réseau qu'on n'a pas.

    `no_social_account` est la bonne raison des deux côtés, et l'app la rend
    avec la plateforme du palier : « connecte un compte TikTok », jamais un
    « connecte un compte » qui laisserait chercher lequel.

    C'est le piège de l'ensemble vide, déjà nommé dans `creator_tiers` et dans
    le fil. Il valait aussi ici, sur l'écran où l'on vient pour réserver.
    """
    obstacles = eligibility.dedoublonner(par_palier.get(tier_id, ()))
    if obstacles:
        return obstacles
    return (eligibility.Obstacle(raison=eligibility.RaisonRefus.NO_SOCIAL_ACCOUNT),)


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
                CatalogItem.leaves_choice,
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
                leaves_choice=ligne.leaves_choice,
                platform=ligne.platform,
                content_format=ligne.content_format,
                required_mention=ligne.required_mention,
                required_geotag=ligne.required_geotag,
                value_ratio=ratio_de_valeur(ligne.price_cents, ligne.value_ratio_hint),
                accessible=accessible,
                social_account_id=compte,
                obstacles=() if accessible else _obstacles_de(obstacles_par_palier, ligne.tier_id),
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
        photos=tuple(
            photo.storage_key for photo in await business_photos.lister(session, business.id)
        ),
        menu_pages=tuple(
            page.storage_key for page in await business_menu.lister(session, business.id)
        ),
        menu_url=business.menu_url,
        offres=tuple(offres),
    )
