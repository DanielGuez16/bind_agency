"""Ce que font les salons d'à côté, en trois repères.

**À quoi ça sert.** L'état vide du commerce — catalogue vide, journée vide —
disait « ajoutez une prestation » et rien de plus. Un salon qui vient de
s'inscrire ne sait pas combien de prestations publier, ni combien de places
ouvrir : il ouvre au hasard, se trouve invisible dans le fil, et conclut que le
produit ne marche pas. Trois chiffres du voisinage remplacent l'encouragement
par un repère.

**« Quartier » n'existe pas dans le modèle, et on ne l'invente pas.** Miami
compte assez de quartiers nommés pour qu'une liste fermée soit fausse dès le
premier jour — c'est déjà la raison pour laquelle la ville d'un créateur est un
champ libre (`SPEC.md` §5.2). Le voisinage est donc un **rayon** autour du point
du commerce, comme partout ailleurs dans le produit : le fil, les compteurs par
rayon et la géolocalisation reposent tous dessus. Rien de neuf en base.

**Des fourchettes, jamais des chiffres exacts.** Un commerce ne doit pas
pouvoir lire le catalogue d'un concurrent en s'inscrivant à côté de lui. On rend
donc un intervalle interquartile — la moitié centrale du voisinage — et non un
minimum et un maximum : les extrêmes d'un petit ensemble désignent des salons
précis et sautent dès qu'un seul ouvre ou ferme.

**Sous un plancher d'effectif, on ne rend rien.** Une fourchette calculée sur
trois salons est à la fois identifiante et fausse. Le compte est rendu quand
même, pour que l'écran puisse dire « pas encore assez de salons autour de vous »
plutôt que d'afficher un vide qu'on prendrait pour une panne.
"""

import uuid
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Business, CapacityRule, CatalogItem, Tier, TierOffer
from app.models.enums import BusinessStatus, ContentFormat, Platform


@dataclass(frozen=True, slots=True)
class Fourchette:
    """La moitié centrale du voisinage. Jamais les extrêmes."""

    bas: int
    haut: int


@dataclass(frozen=True, slots=True)
class ReperesDuVoisinage:
    rayon_metres: int
    #: Combien de salons actifs le calcul a vus. Rendu même sous le plancher :
    #: « quatre salons autour de vous » est une information, un vide n'en est
    #: pas une.
    commerces: int
    #: `None` sous le plancher d'effectif, jamais une fourchette approximative.
    prestations_publiees: Fourchette | None
    places_par_jour: Fourchette | None
    #: Le couple plateforme + format le plus souvent offert autour. `None` quand
    #: personne n'offre rien, ce qui est le cas d'un voisinage tout neuf.
    palier_le_plus_offert: tuple[Platform, ContentFormat] | None


async def reperes_du_voisinage(session: AsyncSession, *, business: Business) -> ReperesDuVoisinage:
    """Les trois repères, autour du point du commerce.

    Le commerce lui-même est exclu : se comparer à soi tire la fourchette vers
    sa propre valeur, et un salon au catalogue vide lirait « 0 à 0 » comme la
    norme du quartier.

    Un commerce sans point — donc jamais activé, la contrainte
    `active_requires_geo` le garantit — n'a pas de voisinage : on rend zéro
    plutôt que de comparer au monde entier.
    """
    reglages = get_settings()
    rayon = reglages.neighbourhood_radius_metres
    plancher = reglages.neighbourhood_minimum_businesses

    if business.geo is None:
        return ReperesDuVoisinage(rayon, 0, None, None, None)

    voisins = (
        sa.select(Business.id)
        .where(
            Business.id != business.id,
            Business.status == BusinessStatus.ACTIVE,
            Business.geo.is_not(None),
            sa.func.ST_DWithin(Business.geo, business.geo, rayon),
        )
        .subquery()
    )

    ids = list((await session.scalars(sa.select(voisins.c.id))).all())
    if len(ids) < plancher:
        return ReperesDuVoisinage(rayon, len(ids), None, None, None)

    prestations = await _par_commerce(
        session,
        sa.select(CatalogItem.business_id, sa.func.count())
        .where(CatalogItem.business_id.in_(ids), CatalogItem.is_available.is_(True))
        .group_by(CatalogItem.business_id),
        ids,
    )

    places = await _places_par_jour(session, ids)

    palier = await session.execute(
        sa.select(Tier.platform, Tier.content_format, sa.func.count().label("n"))
        .join(TierOffer, TierOffer.tier_id == Tier.id)
        .where(TierOffer.business_id.in_(ids), TierOffer.is_active.is_(True))
        .group_by(Tier.platform, Tier.content_format)
        # Le compte d'abord, puis les deux colonnes : sans ce départage, deux
        # paliers à égalité rendraient l'un ou l'autre selon le plan de requête,
        # et l'écran changerait de repère d'un rafraîchissement à l'autre.
        .order_by(sa.desc("n"), Tier.platform, Tier.content_format)
        .limit(1)
    )
    gagnant = palier.first()

    return ReperesDuVoisinage(
        rayon_metres=rayon,
        commerces=len(ids),
        prestations_publiees=_fourchette(prestations),
        places_par_jour=_fourchette(places),
        palier_le_plus_offert=(gagnant[0], gagnant[1]) if gagnant else None,
    )


async def _places_par_jour(session: AsyncSession, ids: list[uuid.UUID]) -> list[int]:
    """Les postes ouverts un jour ouvré ordinaire, un nombre par commerce.

    **La journée médiane, pas la semaine.** « Places par jour » se lit comme ce
    qu'on ouvre un jour donné ; sommer les sept rendrait un nombre que personne
    ne sait interpréter, et prendre le maximum ferait du samedi la norme.

    Les jours fermés ne comptent pas : un salon ouvert quatre jours ouvre bien ce
    qu'il ouvre ces jours-là, et compter trois zéros le ferait passer pour deux
    fois moins ouvert qu'il n'est. Un salon sans aucune règle rend zéro, ce qui
    est vrai — il n'ouvre rien.
    """
    lignes = (
        await session.execute(
            sa.select(
                CapacityRule.business_id,
                CapacityRule.weekday,
                sa.func.sum(CapacityRule.concurrent_slots),
            )
            .where(CapacityRule.business_id.in_(ids))
            .group_by(CapacityRule.business_id, CapacityRule.weekday)
        )
    ).all()

    par_commerce: dict[uuid.UUID, list[int]] = {}
    for business_id, _weekday, postes in lignes:
        par_commerce.setdefault(business_id, []).append(int(postes))

    return [_mediane(par_commerce.get(identifiant, [])) for identifiant in ids]


def _mediane(valeurs: list[int]) -> int:
    if not valeurs:
        return 0
    tries = sorted(valeurs)
    return tries[len(tries) // 2]


async def _par_commerce(session: AsyncSession, requete, ids: list[uuid.UUID]) -> list[int]:
    """Une valeur par commerce du voisinage, **zéro compris**.

    Les `GROUP BY` ne rendent que les commerces qui ont au moins une ligne. Sans
    ce remplissage, un voisinage où la moitié des salons n'a rien publié rendrait
    la fourchette des seuls salons actifs — c'est-à-dire exactement l'inverse du
    repère cherché, et un salon neuf lirait qu'il est très en retard alors qu'il
    est dans la moyenne.
    """
    lues = {ligne[0]: int(ligne[1]) for ligne in (await session.execute(requete)).all()}
    return [lues.get(identifiant, 0) for identifiant in ids]


def _fourchette(valeurs: list[int]) -> Fourchette | None:
    """L'intervalle interquartile, arrondi à l'entier.

    Calculé ici et non en base : les deux requêtes rendent des listes courtes —
    quelques dizaines de salons — et un `percentile_cont` par agrégat obligerait
    à écrire deux fois la même chose en SQL pour deux formes de requête
    différentes.

    Les extrêmes sont volontairement écartés : ils désignent un salon précis, et
    ils sautent dès qu'un seul ouvre ou ferme.
    """
    if not valeurs:
        return None

    tries = sorted(valeurs)
    bas = tries[len(tries) // 4]
    haut = tries[min(len(tries) - 1, (3 * len(tries)) // 4)]
    return Fourchette(bas=bas, haut=haut)
