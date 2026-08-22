"""Catalogue en saisie manuelle.

Trois règles que la base ne porte pas encore et que ce service est seul à tenir :
un parent n'est jamais réservable, il n'y a pas de variante de variante, et la
durée d'un item déjà réservé ne bouge plus. Elles sont signalées comme telles
dans DECISIONS.md — le service n'est pas le bon endroit pour une invariante,
c'est seulement le seul disponible aujourd'hui.

Là où la base pose un filet — bascule de `requires_booking` et suppression d'un
item réservé — le service vérifie quand même avant d'écrire, et rattrape la
violation si elle survient. Une contrainte brute ne doit jamais atteindre
l'appelant : elle ne lui dit pas quoi faire.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Booking, Business, CatalogItem
from app.schemas.catalog import CatalogItemCreate, CatalogItemUpdate
from app.services import audit
from app.services.audit import AuditedEntity

MAX_DEPTH = 2


class CatalogError(Exception):
    """Base des erreurs de catalogue."""


class ItemNotFound(CatalogError):
    pass


class ParentNotFound(CatalogError):
    pass


class ParentMustNotBeBookable(CatalogError):
    """Un parent regroupe des variantes, c'est la variante qui se réserve."""


class VariantDepthExceeded(CatalogError):
    """Deux niveaux au maximum : pas de variante de variante."""


class ItemLockedByBookings(CatalogError):
    """Nature ou durée figées par des réservations existantes."""


class ItemHasBookings(CatalogError):
    """Un item réservé ne se supprime pas, il s'archive.

    **La donnée décide, pas le geste.** Un catalogue composé le premier jour
    contient des essais : une prestation que personne n'a jamais réservée se
    supprime vraiment, et l'obliger à s'archiver laisserait des brouillons dans
    l'inventaire pour toujours. Une prestation déjà réservée, elle, ne se
    supprime à aucune condition — supprimer effacerait le texte d'un accord
    tenu.
    """


#: Le motif écrit au journal quand une prestation est archivée.
REASON_ARCHIVEE = "catalog_item_archived"


class DurationMismatch(CatalogError):
    """Durée obligatoire si et seulement si l'item est réservable."""


def _ensure_duration_coherence(*, requires_booking: bool, duration_minutes: int | None) -> None:
    """Vérifie l'état résultant, jamais la seule charge utile.

    Un schéma ne peut pas trancher : une mise à jour partielle qui ne change que
    `requires_booking` produit un état incohérent sans qu'aucun champ envoyé ne
    soit invalide. Seul le service connaît l'état après fusion — et le CHECK en
    base, qui ne dit rien d'exploitable à l'appelant.
    """
    if requires_booking != (duration_minutes is not None):
        raise DurationMismatch((requires_booking, duration_minutes))


# --------------------------------------------------------------------------
# lecture
# --------------------------------------------------------------------------


async def list_items(
    session: AsyncSession, business_id: uuid.UUID, *, avec_archives: bool = False
) -> list[CatalogItem]:
    """La liste que le salon travaille. **Sans les archives**, par défaut.

    Une archive n'a plus rien à recevoir : la laisser dans la liste ferait
    grossir un écran de composition avec des prestations qu'on ne compose plus.
    Elle reste atteignable depuis la réservation qui la cite — c'est là qu'elle
    a encore quelque chose à dire.

    `avec_archives` existe pour l'écran qui les montre exprès, et pour lui
    seul. Le défaut est celui du travail, pas celui de l'inventaire.
    """
    statement = (
        sa.select(CatalogItem)
        .where(CatalogItem.business_id == business_id)
        .where(sa.true() if avec_archives else CatalogItem.archived_at.is_(None))
        .order_by(CatalogItem.parent_item_id.nulls_first(), CatalogItem.name)
    )
    return list(await session.scalars(statement))


async def get_item(
    session: AsyncSession, business_id: uuid.UUID, item_id: uuid.UUID
) -> CatalogItem:
    """La requête est bornée au commerce : un item d'ailleurs est simplement absent.

    Répondre 404 ici ne dit rien d'un autre commerce — l'appelant a déjà prouvé
    son appartenance à celui-ci, et la réponse ne parle que de son catalogue.
    """
    item = await session.scalar(
        sa.select(CatalogItem).where(
            CatalogItem.id == item_id, CatalogItem.business_id == business_id
        )
    )
    if item is None:
        raise ItemNotFound(item_id)
    return item


async def effective_availability(
    session: AsyncSession, items: list[CatalogItem]
) -> dict[uuid.UUID, bool]:
    """Disponibilité réelle, calculée et jamais recopiée sur les enfants.

    Une valeur dupliquée est une valeur qui divergera : il suffit d'un chemin
    d'écriture qui oublie de la propager.
    """
    parent_ids = {item.parent_item_id for item in items if item.parent_item_id is not None}

    parents: dict[uuid.UUID, bool] = {}
    if parent_ids:
        rows = await session.execute(
            sa.select(CatalogItem.id, CatalogItem.is_available).where(
                CatalogItem.id.in_(parent_ids)
            )
        )
        parents = dict(rows.all())

    return {item.id: item.is_available and parents.get(item.parent_item_id, True) for item in items}


# --------------------------------------------------------------------------
# état des réservations
# --------------------------------------------------------------------------


async def _has_bookings(session: AsyncSession, item_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(sa.select(sa.exists().where(Booking.catalog_item_id == item_id)))
    )


async def reservations_par_item(
    session: AsyncSession, item_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Combien de réservations citent chaque prestation, en une requête.

    **Le bouton doit nommer sa conséquence** : « archiver, douze réservations
    citent cette prestation » se décide, « archiver » ne se décide pas. C'est la
    même règle que partout ailleurs ici — un geste dit ce qu'il déplace.

    Zéro n'y figure pas : l'appelant met zéro pour ce qui manque. Une requête
    qui rendrait une ligne par item sans réservation coûterait autant et ne
    dirait rien de plus.
    """
    if not item_ids:
        return {}
    return {
        item_id: nombre
        for item_id, nombre in await session.execute(
            sa.select(Booking.catalog_item_id, sa.func.count())
            .where(Booking.catalog_item_id.in_(set(item_ids)))
            .group_by(Booking.catalog_item_id)
        )
    }


async def _has_bookings_including_variants(session: AsyncSession, item_id: uuid.UUID) -> bool:
    """La suppression d'un parent emporte ses variantes : leurs réservations comptent."""
    concerned = sa.select(CatalogItem.id).where(
        sa.or_(CatalogItem.id == item_id, CatalogItem.parent_item_id == item_id)
    )
    return bool(
        await session.scalar(sa.select(sa.exists().where(Booking.catalog_item_id.in_(concerned))))
    )


async def _has_variants(session: AsyncSession, item_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(sa.select(sa.exists().where(CatalogItem.parent_item_id == item_id)))
    )


# --------------------------------------------------------------------------
# écriture
# --------------------------------------------------------------------------


async def create_item(
    session: AsyncSession, *, business: Business, payload: CatalogItemCreate
) -> CatalogItem:
    if payload.parent_item_id is not None:
        parent = await session.scalar(
            sa.select(CatalogItem).where(
                CatalogItem.id == payload.parent_item_id,
                CatalogItem.business_id == business.id,
            )
        )
        if parent is None:
            raise ParentNotFound(payload.parent_item_id)
        if parent.parent_item_id is not None:
            raise VariantDepthExceeded(payload.parent_item_id)
        if parent.requires_booking:
            raise ParentMustNotBeBookable(parent.id)

    _ensure_duration_coherence(
        requires_booking=payload.requires_booking, duration_minutes=payload.duration_minutes
    )

    item = CatalogItem(
        business_id=business.id,
        parent_item_id=payload.parent_item_id,
        name=payload.name,
        description=payload.description,
        price_cents=payload.price_cents,
        duration_minutes=payload.duration_minutes,
        requires_booking=payload.requires_booking,
        photo_key=payload.photo_key,
        leaves_choice=payload.leaves_choice,
        is_available=payload.is_available,
    )
    session.add(item)
    await session.flush()
    return item


async def update_item(
    session: AsyncSession, *, item: CatalogItem, payload: CatalogItemUpdate
) -> CatalogItem:
    fields = payload.model_dump(exclude_unset=True)

    nature_change = (
        "requires_booking" in fields and fields["requires_booking"] != item.requires_booking
    )
    duration_change = (
        "duration_minutes" in fields and fields["duration_minutes"] != item.duration_minutes
    )

    # La durée n'a aucun filet en base : une réservation à venir garde son
    # créneau figé dans starts_at et ends_at, mais la capacité serait recalculée
    # sur une durée que personne n'a décidé de changer.
    if (nature_change or duration_change) and await _has_bookings(session, item.id):
        raise ItemLockedByBookings(item.id)

    if nature_change and fields["requires_booking"] and await _has_variants(session, item.id):
        raise ParentMustNotBeBookable(item.id)

    _ensure_duration_coherence(
        requires_booking=fields.get("requires_booking", item.requires_booking),
        duration_minutes=fields.get("duration_minutes", item.duration_minutes),
    )

    # Le prix ne demande aucune vérification : `value_cents_snapshot` fige la
    # valeur au moment de la réservation, c'est exactement à ça qu'il sert.
    for name in (
        "name",
        "description",
        "price_cents",
        "duration_minutes",
        "requires_booking",
        "photo_key",
        "leaves_choice",
    ):
        if name in fields:
            setattr(item, name, fields[name])

    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as error:
        # Filet de la clé étrangère composite. Il ne devrait jamais servir : la
        # vérification ci-dessus l'a déjà couvert. S'il sert, l'appelant reçoit
        # quand même un message qui lui dit quoi faire.
        raise ItemLockedByBookings(item.id) from error

    # `updated_at` a un `onupdate` côté serveur : l'attribut est expiré après
    # l'UPDATE, et le relire déclencherait une IO implicite, interdite en async.
    await session.refresh(item)
    return item


class ItemDejaArchive(CatalogError):
    """Une archive ne se rouvre pas, et ne s'archive pas deux fois."""


async def archiver(session: AsyncSession, *, item: CatalogItem, actor: audit.Actor) -> CatalogItem:
    """Retire la prestation du catalogue **pour de bon**.

    **Archiver n'est pas fermer.** `is_available` dit « pas en ce moment » — la
    prestation saisonnière que le gérant rouvrira en septembre. Archiver dit
    « plus jamais », et l'écran a besoin des deux : sans la distinction, il
    sortait de la liste de travail ce qu'on comptait rouvrir, ou y laissait des
    archives pour toujours.

    Une archive quitte la liste de travail et tous les fils. Elle reste
    atteignable depuis la réservation qui la cite : c'est là qu'elle a encore
    quelque chose à dire, et c'est la raison pour laquelle on ne la supprime
    pas.

    **Elle ne se rouvre pas.** Le salon qui veut la refaire en crée une neuve —
    et si c'est la même chose sous un autre accord, `remplacer` fait les deux
    gestes d'un coup. Rouvrir ferait d'une trace un objet vivant, et les
    réservations qui la citent parleraient soudain d'autre chose.
    """
    if item.archived_at is not None:
        raise ItemDejaArchive(item.id)

    item.archived_at = sa.func.clock_timestamp()
    # Une archive ne s'offre plus : la laisser disponible la ferait remonter
    # dans un fil qui filtre sur `is_available` et pas encore sur l'archive.
    item.is_available = False
    await session.flush()
    # **Rafraîchissement complet, pas seulement la date qu'on vient de poser.**
    # `updated_at` a un `onupdate` côté serveur : l'attribut est expiré par
    # l'UPDATE, et le lire ensuite déclencherait une IO implicite — interdite
    # en async, et le refus arrive sous la forme d'un 500 qui ne dit rien.
    await session.refresh(item)

    await audit.record_transition(
        session,
        entity=AuditedEntity.CATALOG_ITEM,
        entity_id=item.id,
        to_status="archived",
        actor=actor,
        reason=REASON_ARCHIVEE,
    )
    return item


async def remplacer(
    session: AsyncSession,
    *,
    business: Business,
    item: CatalogItem,
    payload: CatalogItemCreate,
    actor: audit.Actor,
) -> CatalogItem:
    """Crée la prestation qui succède, et archive celle qu'elle remplace.

    **Les deux gestes dans une transaction, et c'est tout l'intérêt.** Changer
    la durée, le palier ou la contrepartie d'une prestation déjà réservée
    réécrirait l'histoire d'un accord tenu : douze réservations citent une
    prestation de quarante-cinq minutes, et la passer à soixante-quinze leur
    ferait dire ce qui n'a pas eu lieu.

    L'ancienne garde ses mots et ses réservations ; la nouvelle porte le nouvel
    accord. Séparer les deux appels laisserait un salon avec deux prestations
    vivantes s'il ferme l'écran entre les deux, ou avec aucune s'il ferme dans
    l'autre ordre.

    **Les offres de palier ne suivent pas.** Le palier fait partie de l'accord :
    les recopier ferait de la nouvelle prestation la même chose sous un autre
    nom, ce qui est exactement ce qu'on refuse. Le salon compose ses offres sur
    la neuve, et ce geste-là est le sien.
    """
    # Le commerce est passé par l'appelant : `CatalogItem` ne porte pas de
    # relation vers lui, et en charger une ici serait une IO implicite — que
    # l'asynchrone refuse, sous la forme d'un 500 qui ne dit rien.
    nouvelle = await create_item(session, business=business, payload=payload)
    await archiver(session, item=item, actor=actor)
    return nouvelle


async def delete_item(session: AsyncSession, *, item: CatalogItem) -> None:
    """Un item réservé ne se supprime pas. Il se désactive."""
    if await _has_bookings_including_variants(session, item.id):
        raise ItemHasBookings(item.id)

    try:
        async with session.begin_nested():
            await session.delete(item)
            await session.flush()
    except IntegrityError as error:
        # Filet du RESTRICT posé par `booking`.
        raise ItemHasBookings(item.id) from error
