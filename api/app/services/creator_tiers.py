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
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, CatalogItem, CreatorProfile, Tier, TierOffer
from app.models.enums import BusinessStatus, ContentFormat, Platform
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


@dataclass(frozen=True, slots=True)
class VueDesPaliers:
    creator_id: uuid.UUID
    #: Le badge : aucun historique de fiabilité, donc jugé sur son volume seul.
    #: Calculé par la base, pas ici — il ne peut pas diverger de sa source.
    is_new_creator: bool
    paliers: tuple[PalierVu, ...]


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


async def vue_des_paliers(session: AsyncSession, creator_id: uuid.UUID) -> VueDesPaliers:
    verdict = await eligibility.evaluer_createur(session, creator_id)

    is_new = await session.scalar(
        sa.select(CreatorProfile.is_new_creator).where(CreatorProfile.user_id == creator_id)
    )

    paliers = (
        await session.execute(
            sa.select(Tier)
            .where(Tier.is_active.is_(True))
            .order_by(Tier.platform, Tier.display_order)
        )
    ).scalars()

    offres = await _offres_par_palier(session)

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

    return VueDesPaliers(creator_id=creator_id, is_new_creator=bool(is_new), paliers=tuple(vus))
