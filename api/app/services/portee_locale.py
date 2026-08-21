"""Qui est là, autour du salon.

**La vraie question de qui vient de s'inscrire n'est pas « comment vont mes
rapports », c'est « est-ce qu'il y a quelqu'un ».** L'écran vide des rapports
ne parlait que du salon — zéro réservation, zéro publication, zéro valeur —
et un compteur à zéro qui décrit votre propre inaction ne dit pas si le produit
a une chance de marcher chez vous.

Deux nombres, et le second est le seul qui engage :

— **combien de créatrices sont atteignables** dans le rayon. C'est la taille du
  marché local, indépendante de ce que le salon offre ;
— **combien peuvent déjà réserver** à ses paliers ouverts. C'est la même
  population passée par la règle d'éligibilité, et l'écart entre les deux se
  lit tout seul : beaucoup de monde autour mais personne d'éligible veut dire
  que les paliers sont trop hauts, pas que le quartier est vide.

## Pourquoi la règle n'est pas réécrite ici

`eligibility.evaluer` est pure et reste la seule autorité. Ce module fait les
mêmes lectures qu'`evaluer_createur`, en gros plutôt qu'une par créatrice, puis
lui passe le résultat. Une seconde implémentation du « peut réserver »
divergerait au premier ajustement d'un seuil, et le compteur annoncerait un
marché qui n'existe pas.

## Ce que le compte ne dit pas

Une créatrice sans position n'est pas comptée. Elle existe, elle peut réserver,
et le rayon ne peut rien dire d'elle — l'inclure ferait passer pour « autour de
vous » quelqu'un qui est peut-être ailleurs, ce qui est exactement le mensonge
qu'un chiffre de marché ne doit pas faire.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import (
    Business,
    CatalogItem,
    CreatorProfile,
    SocialAccount,
    Tier,
    TierOffer,
    User,
)
from app.models.enums import ContentFormat, Platform, UserStatus
from app.services import eligibility


@dataclass(frozen=True, slots=True)
class GainDePalier:
    """Un palier fermé, et combien de créatrices son ouverture atteindrait.

    Le format et la plateforme accompagnent l'identifiant : l'écran écrit « le
    palier post » et non un UUID, et il ne doit pas avoir à recharger la grille
    des paliers pour composer une phrase.
    """

    tier_id: uuid.UUID
    platform: Platform
    content_format: ContentFormat
    #: Combien de créatrices du rayon deviendraient joignables **en plus** de
    #: celles qui le sont déjà. Jamais négatif : ouvrir un palier n'en ferme
    #: aucun.
    createurs_en_plus: int


@dataclass(frozen=True, slots=True)
class PorteeLocale:
    """Le marché autour du salon, en deux nombres et un rayon.

    Le rayon est rendu avec eux : « 12 créatrices » ne veut rien dire sans
    « dans 10 km », et l'écran ne doit pas avoir à connaître un réglage qui vit
    en configuration.
    """

    #: Créatrices situées dans le rayon, avec un compte social rattaché.
    #: Un profil sans réseau n'offre rien à un commerce — même règle que
    #: l'annuaire, qui refuse de le lister pour ne pas vendre du vide.
    createurs: int
    #: Combien d'entre elles ouvrent au moins un des paliers du salon.
    #:
    #: **Jamais plus grand que `createurs`** : c'est la même population, filtrée.
    #: Zéro sur un total non nul est une information utile et non une panne —
    #: elle dit que les paliers sont trop hauts pour le quartier.
    peuvent_reserver: int
    rayon_metres: int
    #: Ce que chaque palier **non encore ouvert** ajouterait.
    #:
    #: « Ouvrir le palier post toucherait 62 créatrices de plus » : c'est le
    #: chiffre qui transforme un conseil en argument, et il n'existait pas. Sans
    #: lui, l'écran se rabattait sur l'écart global — « il y a 128 créatrices et
    #: 41 peuvent réserver » — qui dit qu'il manque quelque chose sans dire
    #: quoi faire.
    #:
    #: **Le gain, pas le total.** Un total par palier se lirait comme des
    #: populations à additionner, alors qu'elles se recouvrent largement : une
    #: créatrice qui ouvre le reel ouvre le story. Ce qui décide est ce que
    #: l'ouverture **ajoute**, et lui seul se pose dans une phrase.
    #:
    #: Les paliers déjà ouverts n'y figurent pas : leur gain est nul par
    #: construction, et une ligne à zéro se lirait comme un conseil inutile.
    gains_par_palier: tuple[GainDePalier, ...] = ()


async def autour_du_commerce(
    session: AsyncSession, *, business: Business, maintenant: datetime | None = None
) -> PorteeLocale:
    """Les deux nombres, en quatre requêtes quel que soit le monde autour.

    Une boucle sur `evaluer_createur` en aurait fait trois par créatrice. Sur un
    écran qu'on ouvre pour savoir s'il y a quelqu'un, c'est le nombre de gens
    autour qui déciderait du temps de réponse — soit exactement le mauvais sens.
    """
    settings = get_settings()
    maintenant = maintenant or datetime.now(UTC)
    rayon = settings.feed_radius_metres

    if business.geo is None:
        # Une fiche sans position n'a pas de rayon. Zéro et non une erreur : la
        # fiche est en préparation, et l'écran doit pouvoir s'afficher.
        return PorteeLocale(createurs=0, peuvent_reserver=0, rayon_metres=rayon)

    proches = (
        await session.execute(
            sa.select(
                CreatorProfile.user_id,
                CreatorProfile.reliability_score,
                CreatorProfile.completed_collabs_count,
            )
            .join(User, User.id == CreatorProfile.user_id)
            .where(
                CreatorProfile.geo.is_not(None),
                CreatorProfile.anonymized_at.is_(None),
                User.status == UserStatus.ACTIVE,
                # Les deux colonnes sont déjà des `Geography` : les comparer
                # telles quelles, sans `cast`. Un `cast` explicite perd le SRID
                # en route — `geography(GEOMETRY,-1)` — et Postgres refuse.
                sa.func.ST_DWithin(CreatorProfile.geo, business.geo, rayon),
            )
        )
    ).all()

    if not proches:
        return PorteeLocale(createurs=0, peuvent_reserver=0, rayon_metres=rayon)

    identifiants = [ligne.user_id for ligne in proches]
    releve = eligibility._dernier_releve()
    comptes_par_createur: dict[uuid.UUID, list[eligibility.CompteEvalue]] = {}
    for ligne in (
        await session.execute(
            sa.select(
                SocialAccount.id,
                SocialAccount.creator_id,
                SocialAccount.platform,
                SocialAccount.status,
                SocialAccount.verification_status,
                SocialAccount.connected_at,
                SocialAccount.token_expires_at,
                releve.c.followers_count,
                releve.c.captured_at,
            )
            .outerjoin(releve, releve.c.social_account_id == SocialAccount.id)
            .where(SocialAccount.creator_id.in_(identifiants))
        )
    ).all():
        comptes_par_createur.setdefault(ligne.creator_id, []).append(
            eligibility.CompteEvalue(
                social_account_id=ligne.id,
                platform=ligne.platform,
                status=ligne.status,
                verification_status=ligne.verification_status,
                followers=ligne.followers_count,
                captured_at=ligne.captured_at,
                connected_at=ligne.connected_at,
                token_expires_at=ligne.token_expires_at,
            )
        )

    paliers = await _paliers_ouverts(session, business_id=business.id)

    fermes = await _paliers_fermes(session, ouverts=paliers)
    age_max = timedelta(seconds=settings.metrics_max_age_seconds)

    createurs = 0
    peuvent = 0
    #: Une créatrice par palier fermé qu'elle ouvrirait, et **seulement si elle
    #: ne peut pas déjà réserver** : celle qui passe déjà par le story n'est pas
    #: un gain quand on ouvre le reel, elle est déjà là.
    gains: dict[uuid.UUID, int] = {palier.tier_id: 0 for palier in fermes}

    for ligne in proches:
        comptes = comptes_par_createur.get(ligne.user_id)
        if not comptes:
            continue
        createurs += 1

        createur = eligibility.CreateurEvalue(
            creator_id=ligne.user_id,
            reliability_score=ligne.reliability_score,
            completed_collabs=ligne.completed_collabs_count,
        )

        deja = False
        if paliers:
            verdict = eligibility.evaluer(
                createur, comptes, paliers, maintenant=maintenant, age_max=age_max
            )
            deja = any(acces.accessible for acces in verdict.acces)
            if deja:
                peuvent += 1

        if deja or not fermes:
            continue

        # **Un palier à la fois**, et non tous ensemble : la question posée est
        # « qu'apporterait celui-ci », pas « qu'apporteraient-ils tous ». Les
        # évaluer d'un bloc rendrait une créatrice éligible à trois d'entre eux
        # comptée une fois, sans dire lequel l'a amenée.
        for palier in fermes:
            contre_factuel = eligibility.evaluer(
                createur, comptes, [palier], maintenant=maintenant, age_max=age_max
            )
            if any(acces.accessible for acces in contre_factuel.acces):
                gains[palier.tier_id] += 1

    return PorteeLocale(
        createurs=createurs,
        peuvent_reserver=peuvent,
        rayon_metres=rayon,
        gains_par_palier=tuple(
            GainDePalier(
                tier_id=palier.tier_id,
                platform=palier.platform,
                content_format=palier.content_format,
                createurs_en_plus=gains[palier.tier_id],
            )
            for palier in fermes
        ),
    )


async def _paliers_fermes(
    session: AsyncSession, *, ouverts: list[eligibility.PalierEvalue]
) -> list[eligibility.PalierEvalue]:
    """Les paliers actifs du produit que ce salon n'offre pas encore.

    Ce sont eux, et eux seuls, qui peuvent apporter quelqu'un : le gain d'un
    palier déjà ouvert est nul par construction, et une ligne à zéro se lirait
    comme un conseil inutile.
    """
    deja = {palier.tier_id for palier in ouverts}
    lignes = (
        await session.execute(
            sa.select(
                Tier.id,
                Tier.platform,
                Tier.content_format,
                Tier.min_followers,
                Tier.min_completed_collabs,
                Tier.min_reliability_score,
            )
            .where(Tier.is_active.is_(True))
            .order_by(Tier.display_order)
        )
    ).all()

    return [
        eligibility.PalierEvalue(
            tier_id=ligne.id,
            platform=ligne.platform,
            content_format=ligne.content_format,
            min_followers=ligne.min_followers,
            min_completed_collabs=ligne.min_completed_collabs,
            min_reliability_score=ligne.min_reliability_score,
        )
        for ligne in lignes
        if ligne.id not in deja
    ]


async def _paliers_ouverts(
    session: AsyncSession, *, business_id: uuid.UUID
) -> list[eligibility.PalierEvalue]:
    """Les paliers que le salon offre **réellement**.

    Les quatre conditions de `is_effectively_offered`, et non la seule case de
    l'offre : un palier désactivé, un item retiré du catalogue ou un item parent
    devenu indisponible ferment l'offre aussi sûrement. Compter sur l'offre
    seule annoncerait des créatrices qui « peuvent réserver » un soin que
    personne ne sert plus.
    """
    parent = sa.orm.aliased(CatalogItem)
    lignes = (
        await session.execute(
            sa.select(
                Tier.id,
                Tier.platform,
                Tier.content_format,
                Tier.min_followers,
                Tier.min_completed_collabs,
                Tier.min_reliability_score,
            )
            .distinct()
            .select_from(TierOffer)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
            .where(
                TierOffer.business_id == business_id,
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
                CatalogItem.is_available.is_(True),
                sa.or_(parent.id.is_(None), parent.is_available.is_(True)),
            )
        )
    ).all()

    return [
        eligibility.PalierEvalue(
            tier_id=ligne.id,
            platform=ligne.platform,
            content_format=ligne.content_format,
            min_followers=ligne.min_followers,
            min_completed_collabs=ligne.min_completed_collabs,
            min_reliability_score=ligne.min_reliability_score,
        )
        for ligne in lignes
    ]
