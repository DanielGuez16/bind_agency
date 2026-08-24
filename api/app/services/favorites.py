"""Les favoris d'une créatrice : poser, retirer, relire.

**Le favori porte sur `catalog_item`, pas sur `tier_offer`.** Le mur rend une
carte par offre de palier — le même article ouvert à deux paliers fait deux
cartes — mais une offre meurt de deux façons qui ne disent rien de la
prestation : le salon ferme ce palier-là et garde l'autre, ou **la créatrice
perd le palier**. Le second est un changement chez elle ; un favori qui
disparaît parce qu'on a baissé d'un palier pendant un mois est un favori qu'on
n'ose plus poser.

**La liste ne se lit pas dans le fil.** Le fil est borné par une position et un
rayon : c'est son contrat. Un favori posé à Wynwood doit se relire depuis
Kendall, sinon il ne sert qu'à l'endroit où on l'a posé. D'où une route à part,
sans coordonnées.

**Une prestation qui n'est plus réservable reste dans la liste, avec sa
raison.** La retirer sans un mot serait le seul comportement pire que de ne rien
offrir : la créatrice croirait avoir mal appuyé. Les quatre états qu'elle peut
lire sont ceux qui appellent quatre conduites différentes — attendre la
réouverture, monter d'un palier, choisir autre chose, ou réserver.
"""

import uuid
from dataclasses import dataclass
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, CatalogItem, CreatorFavorite, Tier, TierOffer
from app.models.enums import BusinessStatus
from app.services import eligibility, outbox


class FavoriteError(Exception):
    """Base des refus de favori."""


class PrestationIntrouvable(FavoriteError):
    """L'article n'existe pas, ou il est archivé.

    **Les deux ensemble, et c'est délibéré.** Une archive ne se rouvre jamais :
    la mettre en favori serait poser un signet sur une porte murée. Distinguer
    les deux apprendrait par ailleurs quels identifiants existent chez les
    autres salons.
    """


class EtatDuFavori(StrEnum):
    """Ce qu'on peut faire de ce favori aujourd'hui.

    Quatre états parce qu'ils appellent quatre conduites. « Indisponible » les
    aurait tous couverts et n'aurait rien dit : attendre septembre, monter d'un
    palier et choisir autre chose ne sont pas le même geste.
    """

    #: Elle peut la réserver maintenant.
    RESERVABLE = "reservable"
    #: Le salon l'a fermée — une saison, des travaux. Elle peut rouvrir.
    FERMEE = "fermee"
    #: Le salon ne paraît plus : en pause, abonnement terminé, jamais activé.
    SALON_INDISPONIBLE = "salon_indisponible"
    #: L'offre existe, mais à un palier qu'elle n'ouvre pas aujourd'hui.
    HORS_PALIER = "hors_palier"


@dataclass(frozen=True, slots=True)
class FavoriVu:
    """Un favori, avec ce qu'il faut pour le rendre et pour savoir s'il vit."""

    catalog_item_id: uuid.UUID
    business_id: uuid.UUID
    business_name: str
    name: str
    description: str | None
    duration_minutes: int | None
    price_cents: int
    currency: str
    photo_key: str | None
    etat: EtatDuFavori


async def ajouter(
    session: AsyncSession, *, creator_id: uuid.UUID, catalog_item_id: uuid.UUID
) -> CreatorFavorite:
    """Pose le favori. **Le second appui ne fait rien et ne se plaint pas.**

    Le geste est un interrupteur : deux appuis sur un cœur ne posent pas deux
    favoris, et répondre 409 au second obligerait l'écran à traiter comme une
    erreur ce qui est le résultat voulu — la prestation est en favori.
    """
    article = await session.get(CatalogItem, catalog_item_id)
    if article is None or article.archived_at is not None:
        raise PrestationIntrouvable(str(catalog_item_id))

    existant = await session.scalar(
        sa.select(CreatorFavorite).where(
            CreatorFavorite.creator_id == creator_id,
            CreatorFavorite.catalog_item_id == catalog_item_id,
        )
    )
    if existant is not None:
        return existant

    favori = CreatorFavorite(
        creator_id=creator_id,
        catalog_item_id=catalog_item_id,
        # **L'état du jour, posé à la création.** Sans lui, le premier balayage
        # verrait « rien connu → réservable » et enverrait un message pour une
        # prestation qu'elle vient de regarder. Ce qu'on annonce est une
        # ouverture, pas un état.
        dernier_etat=(await etat_courant(session, creator_id=creator_id, article=article)).value,
    )
    session.add(favori)
    try:
        # **Le point de sauvegarde n'est pas décoratif.** Deux appuis
        # simultanés — un doublon d'événement, deux onglets — violent la
        # contrainte d'unicité, et une violation attrapée hors d'un point de
        # sauvegarde laisse la session inutilisable pour tout ce qui suit.
        async with session.begin_nested():
            await session.flush()
    except IntegrityError:
        return await session.scalar(
            sa.select(CreatorFavorite).where(
                CreatorFavorite.creator_id == creator_id,
                CreatorFavorite.catalog_item_id == catalog_item_id,
            )
        )
    return favori


async def retirer(
    session: AsyncSession, *, creator_id: uuid.UUID, catalog_item_id: uuid.UUID
) -> None:
    """Retire le favori. Sans erreur s'il n'y en avait pas.

    « Il n'y avait rien à retirer » est le résultat voulu par quelqu'un qui
    appuie sur un cœur déjà vide.
    """
    await session.execute(
        sa.delete(CreatorFavorite).where(
            CreatorFavorite.creator_id == creator_id,
            CreatorFavorite.catalog_item_id == catalog_item_id,
        )
    )


async def identifiants(session: AsyncSession, *, creator_id: uuid.UUID) -> frozenset[uuid.UUID]:
    """Les prestations en favori, en un seul aller.

    **C'est ce que le fil appelle.** Un fil de vingt salons rend quatre-vingts
    cartes ; demander l'état du cœur carte par carte ferait quatre-vingts
    requêtes pour une information qui tient dans un ensemble.
    """
    return frozenset(
        await session.scalars(
            sa.select(CreatorFavorite.catalog_item_id).where(
                CreatorFavorite.creator_id == creator_id
            )
        )
    )


async def etat_courant(
    session: AsyncSession, *, creator_id: uuid.UUID, article: CatalogItem
) -> EtatDuFavori:
    """L'état d'une seule prestation pour une seule créatrice.

    Écrite pour la pose du favori, qui n'a qu'un article à regarder. `lister`
    ne l'appelle pas : elle en a cinquante et charge tout en trois requêtes —
    l'appeler par article ferait cinquante fois le calcul d'éligibilité, qui
    est le plus cher du produit.
    """
    salon = await session.get(Business, article.business_id)
    paliers = set(
        await session.scalars(
            sa.select(TierOffer.tier_id)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .where(
                TierOffer.catalog_item_id == article.id,
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
            )
        )
    )
    verdict = await eligibility.evaluer_createur(session, creator_id)
    return _etat(
        article=article,
        statut_du_salon=salon.status if salon else BusinessStatus.DRAFT,
        paliers_de_l_article=paliers,
        paliers_ouverts=verdict.paliers_accessibles,
    )


async def lister(session: AsyncSession, *, creator_id: uuid.UUID) -> tuple[FavoriVu, ...]:
    """La liste, la plus récente d'abord, chacune avec son état du jour."""
    lignes = (
        await session.execute(
            sa.select(CatalogItem, Business.id, Business.name, Business.status, Business.currency)
            .join(Business, Business.id == CatalogItem.business_id)
            .join(CreatorFavorite, CreatorFavorite.catalog_item_id == CatalogItem.id)
            .where(CreatorFavorite.creator_id == creator_id)
            .order_by(CreatorFavorite.created_at.desc())
        )
    ).all()
    if not lignes:
        return ()

    verdict = await eligibility.evaluer_createur(session, creator_id)
    ouverts = verdict.paliers_accessibles

    # Les paliers actifs sous lesquels chaque prestation est ouverte
    # aujourd'hui. Une seule requête pour toute la liste : la boucle n'en
    # déclenche aucune.
    offres = (
        await session.execute(
            sa.select(TierOffer.catalog_item_id, TierOffer.tier_id)
            .join(Tier, Tier.id == TierOffer.tier_id)
            .where(
                TierOffer.catalog_item_id.in_([article.id for article, *_ in lignes]),
                TierOffer.is_active.is_(True),
                Tier.is_active.is_(True),
            )
        )
    ).all()
    paliers_par_article: dict[uuid.UUID, set[uuid.UUID]] = {}
    for article_id, tier_id in offres:
        paliers_par_article.setdefault(article_id, set()).add(tier_id)

    return tuple(
        FavoriVu(
            catalog_item_id=article.id,
            business_id=business_id,
            business_name=business_name,
            name=article.name,
            description=article.description,
            duration_minutes=article.duration_minutes,
            price_cents=article.price_cents,
            currency=devise,
            photo_key=article.photo_key,
            etat=_etat(
                article=article,
                statut_du_salon=statut,
                paliers_de_l_article=paliers_par_article.get(article.id, set()),
                paliers_ouverts=ouverts,
            ),
        )
        for article, business_id, business_name, statut, devise in lignes
    )


def _etat(
    *,
    article: CatalogItem,
    statut_du_salon: BusinessStatus,
    paliers_de_l_article: set[uuid.UUID],
    paliers_ouverts: frozenset[uuid.UUID],
) -> EtatDuFavori:
    """L'ordre des questions est l'ordre de ce qu'on peut y faire.

    Le salon d'abord : un salon en pause rend toutes les autres questions sans
    objet, et dire « hors palier » d'une prestation que personne ne peut
    réserver enverrait monter un palier pour rien. Puis la fermeture, qui est du
    salon. Le palier en dernier, parce que c'est le seul état sur lequel la
    créatrice peut agir.
    """
    if statut_du_salon is not BusinessStatus.ACTIVE:
        return EtatDuFavori.SALON_INDISPONIBLE
    if not article.is_available or not paliers_de_l_article:
        return EtatDuFavori.FERMEE
    if not (paliers_de_l_article & paliers_ouverts):
        return EtatDuFavori.HORS_PALIER
    return EtatDuFavori.RESERVABLE


async def prevenir_les_ouvertures(session: AsyncSession, *, limite: int = 2000) -> int:
    """Prévient chaque créatrice dont un favori vient de s'ouvrir. Rend le compte.

    **Un balayage, et non un crochet à l'écriture.** Une prestation en favori
    s'ouvre pour deux raisons : le salon la rouvre — ou rouvre l'offre à un
    palier — et la créatrice atteint le palier. La seconde n'a aucun point
    d'écriture qu'on puisse accrocher : elle arrive par un relevé de métriques,
    qui n'a aucune raison de savoir qui a mis quoi en favori. Comparer l'état à
    celui d'avant attrape les deux causes avec un seul mécanisme, et n'en
    oubliera pas une troisième.

    **On annonce une transition, jamais un état.** Prévenir « c'est réservable »
    à chaque passage enverrait le même message toutes les heures. Ce qu'on veut
    dire est « ça vient de s'ouvrir », et cela ne se lit que par comparaison
    avec la fois d'avant — d'où `dernier_etat`, écrit à chaque passage même
    quand il n'y a rien à annoncer.

    **L'état est réécrit dans tous les cas, y compris à la fermeture.** Sans
    cela, une prestation qui s'ouvre, se ferme et se rouvre ne serait annoncée
    qu'une fois : le second retour trouverait `reservable` en mémoire et se
    tairait, alors que c'est bien une réouverture.

    Le refus de la créatrice n'est **pas lu ici** : il l'est au moment de
    sortir, comme le statut du compte. Le déposer puis l'écarter coûte une
    ligne de boîte d'envoi et garde la trace de ce qu'on aurait dit — et surtout
    quelqu'un qui coupe l'avis entre le dépôt et l'envoi est entendu.
    """
    par_createur: dict[uuid.UUID, list[CreatorFavorite]] = {}
    favoris = await session.scalars(
        sa.select(CreatorFavorite).order_by(CreatorFavorite.created_at).limit(limite)
    )
    for favori in favoris:
        par_createur.setdefault(favori.creator_id, []).append(favori)

    annonces = 0
    for creator_id, lignes in par_createur.items():
        etats = {vu.catalog_item_id: vu for vu in await lister(session, creator_id=creator_id)}
        for favori in lignes:
            vu = etats.get(favori.catalog_item_id)
            if vu is None:
                continue
            devenu = vu.etat.value
            if devenu == favori.dernier_etat:
                continue
            if vu.etat is EtatDuFavori.RESERVABLE:
                await outbox.deposer(
                    session,
                    user_id=creator_id,
                    cle="favorite.available",
                    prestation=vu.name,
                    business=vu.business_name,
                )
                annonces += 1
            favori.dernier_etat = devenu

    await session.flush()
    return annonces
