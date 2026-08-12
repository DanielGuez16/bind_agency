"""La galerie photos d'un commerce : déposer, ordonner, retirer.

`business` ne portait qu'une clé de couverture, et les maquettes de Discovery
v0.5 déroulent plusieurs photos par fiche. La couverture reste ce qu'elle est —
l'image de la carte, choisie pour tenir en petit — et la galerie est ce que la
fiche montre à qui s'arrête.

**L'ordre appartient au commerce.** Il choisit ce qu'on voit en premier, ce qui
est la seule décision de mise en scène que le produit lui laisse. Ordonner par
date de dépôt reviendrait à la lui retirer au profit de l'ordre où il a pensé à
téléverser.

**Le réordonnancement réécrit tout, en une transaction.** La contrainte
d'unicité est `DEFERRABLE INITIALLY DEFERRED` : la transaction a le droit de se
contredire en son milieu — deux photos en position 2 le temps de deux écritures
— et Postgres vérifie à la fin. Sans ce report il faudrait passer par des
positions intermédiaires négatives, une danse que chaque appelant referait à sa
façon.

**Retirer une photo referme le trou.** Des positions 0, 2, 3 fonctionneraient
pour l'affichage, qui trie ; mais la première insertion suivante calculerait son
rang sur un maximum devenu faux, et l'ordre finirait par diverger de ce que le
commerce a choisi.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BusinessPhoto

#: Le préfixe du dépôt objet. Public : une photo de commerce s'affiche dans le
#: fil, avant toute session, et la servir derrière un jeton la rendrait
#: invisible à qui n'a pas encore de compte.
PREFIXE = "photos/commerces"

#: Au-delà, la fiche devient un catalogue et le commerce un photographe. Le
#: plafond est une décision de produit, pas une limite technique — il vit donc
#: ici, nommé, et non dans une validation de schéma.
MAXIMUM_PAR_COMMERCE = 12


class GalerieError(Exception):
    """Refus métier. Le routeur le traduit en code d'erreur."""


class GaleriePleine(GalerieError):
    pass


class PhotoIntrouvable(GalerieError):
    pass


async def lister(session: AsyncSession, business_id: uuid.UUID) -> list[BusinessPhoto]:
    """Les photos, dans l'ordre choisi par le commerce.

    Trié sur `(position, id)` et non sur `position` seul : deux positions
    égales ne devraient pas exister, mais un tri instable rendrait leur ordre
    différent d'un appel à l'autre, et la fiche se réarrangerait sous les yeux.
    """
    return list(
        await session.scalars(
            sa.select(BusinessPhoto)
            .where(BusinessPhoto.business_id == business_id)
            .order_by(BusinessPhoto.position, BusinessPhoto.id)
        )
    )


async def ajouter(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    storage_key: str,
    alt_text: str | None = None,
) -> BusinessPhoto:
    """Ajoute une photo à la fin de la galerie.

    À la fin, jamais au début : le commerce a choisi son ordre, et une nouvelle
    photo n'a aucune raison de passer devant ce qu'il a mis en tête.
    """
    combien = await session.scalar(
        sa.select(sa.func.count())
        .select_from(BusinessPhoto)
        .where(BusinessPhoto.business_id == business_id)
    )
    if (combien or 0) >= MAXIMUM_PAR_COMMERCE:
        raise GaleriePleine

    # Le rang suivant se calcule sur le **maximum**, pas sur le compte : après
    # un retrait mal refermé, les deux divergeraient et l'insertion écraserait
    # une position occupée.
    dernier = await session.scalar(
        sa.select(sa.func.max(BusinessPhoto.position)).where(
            BusinessPhoto.business_id == business_id
        )
    )

    photo = BusinessPhoto(
        business_id=business_id,
        storage_key=storage_key,
        position=0 if dernier is None else dernier + 1,
        alt_text=alt_text,
    )
    session.add(photo)
    await session.flush()
    return photo


async def retirer(session: AsyncSession, *, business_id: uuid.UUID, photo_id: uuid.UUID) -> None:
    """Retire une photo et referme le trou qu'elle laisse.

    Le fichier n'est **pas** supprimé du dépôt objet. Une photo retirée de la
    fiche peut avoir été archivée dans une preuve de publication, et un fichier
    effacé casserait cette preuve sans que personne fasse le lien. Le dépôt se
    nettoie par balayage, avec ses propres règles.
    """
    photo = await session.scalar(
        sa.select(BusinessPhoto).where(
            BusinessPhoto.id == photo_id, BusinessPhoto.business_id == business_id
        )
    )
    if photo is None:
        raise PhotoIntrouvable

    await session.delete(photo)
    await session.flush()
    await _resserrer(session, business_id)


async def reordonner(
    session: AsyncSession, *, business_id: uuid.UUID, ordre: list[uuid.UUID]
) -> list[BusinessPhoto]:
    """Impose un ordre complet.

    **L'ordre doit citer toutes les photos, et rien d'autre.** Un ordre partiel
    laisserait les absentes à des positions qui entreraient en collision avec
    les nouvelles ; un ordre citant une photo d'un autre commerce serait une
    fuite silencieuse. Les deux se refusent plutôt que se rattrapent — deviner
    ce qu'un appelant a voulu dire, c'est inventer un ordre qu'il n'a pas
    demandé.
    """
    actuelles = await lister(session, business_id)
    connues = {photo.id for photo in actuelles}

    if len(ordre) != len(set(ordre)) or set(ordre) != connues:
        raise PhotoIntrouvable

    par_id = {photo.id: photo for photo in actuelles}
    for rang, identifiant in enumerate(ordre):
        par_id[identifiant].position = rang

    # L'unicité est différée : la transaction peut porter deux fois la même
    # position le temps de la boucle, et Postgres vérifie à la validation.
    await session.flush()
    return await lister(session, business_id)


async def _resserrer(session: AsyncSession, business_id: uuid.UUID) -> None:
    """Renumérote de zéro, sans trou, dans l'ordre courant."""
    for rang, photo in enumerate(await lister(session, business_id)):
        photo.position = rang
    await session.flush()
