"""La carte d'un commerce : déposer des pages, les ordonner, les retirer.

**Pourquoi ce n'est pas la galerie.** La galerie montre le lieu : on la fait
défiler, on se fait une idée, on passe. La carte se *consulte* : on l'ouvre pour
y chercher un plat et un prix. Deux gestes différents, deux entrées différentes
sur la fiche — les mêler ferait chercher une entrecôte entre deux photos de
salle.

**Pourquoi le mécanisme est recopié plutôt que partagé.** Il est celui de la
galerie, au détail près : clé de dépôt, position unique différée, retrait qui
referme le trou. Les deux ont le même mécanisme aujourd'hui et pas la même
raison d'être — une abstraction commune ferait qu'un plafond relevé pour une
carte de restaurant relèverait aussi celui d'une galerie de salon, et personne
ne verrait le lien au moment de le changer.

**Ce que ce module décide, et que le reste du produit lit.** `carte_disponible`
est la question qu'on pose avant d'ouvrir une offre à choix : le commerce a-t-il
de quoi laisser lire sa carte. Des pages, un lien, ou les deux. Elle vit ici
plutôt que dans le service des offres, parce que c'est la carte qui sait ce
qu'elle est — et le jour où une troisième forme apparaît, un seul fichier bouge.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, BusinessMenuPage

#: Le préfixe du dépôt objet. Public, comme la galerie : une carte se consulte
#: depuis la fiche publique, avant toute session, et la servir derrière un jeton
#: la rendrait invisible à qui hésite encore à s'inscrire.
PREFIXE = "photos/cartes"

#: Au-delà, ce n'est plus une carte, c'est un livre. Huit pages tiennent un
#: dépliant de restaurant recto-verso, entrées, plats, desserts et boissons.
#: Le plafond est une décision de produit, pas une limite technique.
MAXIMUM_PAR_COMMERCE = 8


class CarteError(Exception):
    """Refus métier. Le routeur le traduit en code d'erreur."""


class CartePleine(CarteError):
    pass


class PageIntrouvable(CarteError):
    pass


async def lister(session: AsyncSession, business_id: uuid.UUID) -> list[BusinessMenuPage]:
    """Les pages, dans l'ordre où la carte se lit.

    Trié sur `(position, id)` et non sur `position` seul : deux positions égales
    ne devraient pas exister, mais un tri instable rendrait leur ordre différent
    d'un appel à l'autre — et une carte dont les pages changent de place entre
    deux ouvertures ne se lit pas.
    """
    return list(
        await session.scalars(
            sa.select(BusinessMenuPage)
            .where(BusinessMenuPage.business_id == business_id)
            .order_by(BusinessMenuPage.position, BusinessMenuPage.id)
        )
    )


async def carte_disponible(session: AsyncSession, business: Business) -> bool:
    """Le commerce a-t-il de quoi faire lire sa carte.

    **Des pages, un lien, ou les deux.** L'un ou l'autre suffit : forcer à
    photographier une carte déjà bien présentée en ligne serait absurde, et
    n'accepter que le lien priverait le salon qui n'a qu'un tableau au mur.

    Un lien vide ou fait d'espaces ne compte pas. C'est le genre de valeur qu'un
    formulaire laisse passer, et elle ouvrirait une offre vers une carte que
    personne ne peut lire — exactement ce que la règle existe pour empêcher.
    """
    if business.menu_url and business.menu_url.strip():
        return True

    combien = await session.scalar(
        sa.select(sa.func.count())
        .select_from(BusinessMenuPage)
        .where(BusinessMenuPage.business_id == business.id)
    )
    return bool(combien)


async def ajouter(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    storage_key: str,
    alt_text: str | None = None,
) -> BusinessMenuPage:
    """Ajoute une page à la fin de la carte.

    À la fin, jamais au début : une carte a un ordre — entrées, plats,
    desserts — et une page neuve n'a aucune raison de passer devant.
    """
    combien = await session.scalar(
        sa.select(sa.func.count())
        .select_from(BusinessMenuPage)
        .where(BusinessMenuPage.business_id == business_id)
    )
    if (combien or 0) >= MAXIMUM_PAR_COMMERCE:
        raise CartePleine

    # Le rang suivant se calcule sur le **maximum**, pas sur le compte : après
    # un retrait mal refermé, les deux divergeraient et l'insertion écraserait
    # une position occupée.
    dernier = await session.scalar(
        sa.select(sa.func.max(BusinessMenuPage.position)).where(
            BusinessMenuPage.business_id == business_id
        )
    )

    page = BusinessMenuPage(
        business_id=business_id,
        storage_key=storage_key,
        position=0 if dernier is None else dernier + 1,
        alt_text=alt_text,
    )
    session.add(page)
    await session.flush()
    return page


async def retirer(session: AsyncSession, *, business_id: uuid.UUID, page_id: uuid.UUID) -> None:
    """Retire une page et referme le trou qu'elle laisse.

    Le fichier n'est **pas** supprimé du dépôt objet, pour la même raison que
    dans la galerie : une image retirée peut avoir été archivée ailleurs, et un
    fichier effacé casserait cette archive sans que personne fasse le lien.

    **Retirer la dernière page ne ferme aucune offre.** La règle se vérifie à
    l'ouverture, pas en continu : refermer des offres derrière le commerce
    pendant qu'il réorganise sa carte lui ferait perdre sa composition sans un
    mot. Il retrouvera le refus la prochaine fois qu'il ouvrira quelque chose,
    au moment où la question se pose.
    """
    page = await session.scalar(
        sa.select(BusinessMenuPage).where(
            BusinessMenuPage.id == page_id, BusinessMenuPage.business_id == business_id
        )
    )
    if page is None:
        raise PageIntrouvable

    await session.delete(page)
    await session.flush()
    await _resserrer(session, business_id)


async def reordonner(
    session: AsyncSession, *, business_id: uuid.UUID, ordre: list[uuid.UUID]
) -> list[BusinessMenuPage]:
    """Impose un ordre complet.

    **L'ordre doit citer toutes les pages, et rien d'autre.** Un ordre partiel
    laisserait les absentes à des positions qui entreraient en collision avec
    les nouvelles ; un ordre citant la page d'un autre commerce serait une fuite
    silencieuse. Les deux se refusent plutôt que se rattrapent.
    """
    actuelles = await lister(session, business_id)
    connues = {page.id for page in actuelles}

    if len(ordre) != len(set(ordre)) or set(ordre) != connues:
        raise PageIntrouvable

    par_id = {page.id: page for page in actuelles}
    for rang, identifiant in enumerate(ordre):
        par_id[identifiant].position = rang

    # L'unicité est différée : la transaction peut porter deux fois la même
    # position le temps de la boucle, et Postgres vérifie à la validation.
    await session.flush()
    return await lister(session, business_id)


async def _resserrer(session: AsyncSession, business_id: uuid.UUID) -> None:
    """Renumérote de zéro, sans trou, dans l'ordre courant."""
    for rang, page in enumerate(await lister(session, business_id)):
        page.position = rang
    await session.flush()
