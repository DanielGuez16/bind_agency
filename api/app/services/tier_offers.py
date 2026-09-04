"""Composition des offres par palier.

Le commerce place des items de son catalogue à un palier, et retire. C'est tout :
l'éligibilité et le fil relèvent des phases suivantes.

Un même item peut être placé à plusieurs paliers — l'unicité porte sur le
triplet. Un créateur éligible à plusieurs paliers verra donc le même item
plusieurs fois ; ce n'est pas un doublon à écraser ici, c'est au fil de la
phase 5 de présenter le meilleur palier accessible. Rien ici ne l'empêche.

Deux règles que le service tient seul, la base ne les portant pas encore :
un parent ne se place pas dans une offre, et une offre ne se crée pas sur un
palier inactif. Voir DECISIONS.md.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Booking, Business, CatalogItem, Tier, TierOffer
from app.models.enums import TierOfferState
from app.schemas.tier_offers import TierOfferCreate, TierOfferUpdate
from app.services import business_menu, config_journal
from app.services.audit import Actor, AuditedEntity, record_transition


class TierOfferError(Exception):
    """Base des erreurs de composition."""


class OfferNotFound(TierOfferError):
    pass


class OfferAlreadyExists(TierOfferError):
    """Le triplet commerce, palier, item est unique."""


class ParentNotAllowed(TierOfferError):
    """Un parent regroupe des variantes : c'est la variante qui se propose."""


class TierInactive(TierOfferError):
    """On ne compose pas sur un palier fermé."""


class OfferHasBookings(TierOfferError):
    """Une offre réservée ne se supprime pas, elle se désactive."""


class CarteManquante(TierOfferError):
    """La prestation laisse un choix, et le commerce n'a ni carte ni lien.

    **Un restaurant peut proposer « un menu contre une story ».** Le créateur ne
    sait alors pas ce qu'il va manger — donc il ne vient pas. Une offre à choix
    sans carte lisible est une offre que personne ne prend, et le commerce n'a
    aucun moyen de savoir pourquoi : son offre est en ligne, elle a l'air
    normale, elle ne convertit pas.

    **Vérifiée à l'ouverture, pas à la création de l'item.** Un item se saisit
    au fil de l'eau, souvent avant que la carte soit photographiée ; refuser là
    obligerait à tout faire dans un ordre imposé. C'est le geste de *publier*
    qui engage le commerce vis-à-vis d'un créateur, et c'est celui-là qu'on
    garde — exactement comme les critères d'activation du commerce.
    """


# --------------------------------------------------------------------------
# lecture
# --------------------------------------------------------------------------


async def list_offers(session: AsyncSession, business_id: uuid.UUID) -> list[TierOffer]:
    statement = (
        sa.select(TierOffer)
        .where(TierOffer.business_id == business_id)
        .order_by(TierOffer.created_at)
    )
    return list(await session.scalars(statement))


async def get_offer(
    session: AsyncSession, business_id: uuid.UUID, offer_id: uuid.UUID
) -> TierOffer:
    offer = await session.scalar(
        sa.select(TierOffer).where(TierOffer.id == offer_id, TierOffer.business_id == business_id)
    )
    if offer is None:
        raise OfferNotFound(offer_id)
    return offer


async def describe(session: AsyncSession, offers: list[TierOffer]) -> dict[uuid.UUID, dict]:
    """Palier, item, et disponibilité effective, en une requête pour toute la liste.

    « Effectivement proposée » se calcule à partir de trois interrupteurs — celui
    de l'offre, celui du palier, celui de l'item corrigé par son parent — et
    n'est recopié nulle part. Trois valeurs dupliquées, ce serait trois façons
    de diverger.
    """
    if not offers:
        return {}

    parent = sa.orm.aliased(CatalogItem)
    rows = (
        await session.execute(
            sa.select(
                TierOffer.id,
                Tier.platform,
                Tier.content_format,
                Tier.is_active.label("tier_active"),
                CatalogItem.name.label("item_name"),
                CatalogItem.is_available.label("item_available"),
                parent.is_available.label("parent_available"),
            )
            .join(Tier, Tier.id == TierOffer.tier_id)
            .join(CatalogItem, CatalogItem.id == TierOffer.catalog_item_id)
            .outerjoin(parent, parent.id == CatalogItem.parent_item_id)
            .where(TierOffer.id.in_([offer.id for offer in offers]))
        )
    ).all()

    par_offre = {row.id: row for row in rows}
    return {
        offer.id: {
            "platform": par_offre[offer.id].platform,
            "content_format": par_offre[offer.id].content_format,
            "item_name": par_offre[offer.id].item_name,
            "is_effectively_offered": (
                offer.is_active
                and par_offre[offer.id].tier_active
                and par_offre[offer.id].item_available
                and (par_offre[offer.id].parent_available is not False)
            ),
        }
        for offer in offers
    }


# --------------------------------------------------------------------------
# écriture
# --------------------------------------------------------------------------


async def _has_variants(session: AsyncSession, item_id: uuid.UUID) -> bool:
    return bool(
        await session.scalar(sa.select(sa.exists().where(CatalogItem.parent_item_id == item_id)))
    )


async def create_offer(
    session: AsyncSession, *, business_id: uuid.UUID, payload: TierOfferCreate
) -> TierOffer:
    """Compose une offre. `requires_booking` ne conditionne rien ici.

    Un item sans réservation se propose comme un autre : le créateur obtient un
    droit valable sur une fenêtre au lieu d'un créneau, et ça ne regarde pas la
    composition.
    """
    tier = await session.get(Tier, payload.tier_id)
    if tier is None:
        raise OfferNotFound(payload.tier_id)

    # Refusé à la création seulement. Désactiver un palier ensuite laisse les
    # offres en place — ce sont deux règles différentes, elles ne se
    # contredisent pas.
    if not tier.is_active:
        raise TierInactive(tier.id)

    item = await session.scalar(
        sa.select(CatalogItem).where(
            CatalogItem.id == payload.catalog_item_id,
            CatalogItem.business_id == business_id,
        )
    )
    if item is None:
        raise OfferNotFound(payload.catalog_item_id)

    if await _has_variants(session, item.id):
        raise ParentNotAllowed(item.id)

    # **La création est une ouverture.** `is_active` vaut vrai par défaut :
    # composer une offre la met en ligne dans le même geste. Ne garder que la
    # route d'activation laisserait donc passer le chemin le plus court — celui
    # que tout le monde emprunte — et la règle ne se déclencherait jamais.
    await _exiger_une_carte(session, business_id=business_id, item=item)

    offer = TierOffer(
        business_id=business_id,
        tier_id=tier.id,
        catalog_item_id=item.id,
        required_mention=_mention_propre(payload.required_mention),
        required_geotag=payload.required_geotag,
    )

    try:
        # `add` est à l'intérieur du bloc : `begin_nested` vide les objets en
        # attente AVANT d'ouvrir le point de sauvegarde, un `add` placé au-dessus
        # échapperait donc à sa protection et laisserait la session inutilisable.
        async with session.begin_nested():
            session.add(offer)
            await session.flush()
    except IntegrityError as error:
        raise OfferAlreadyExists((business_id, tier.id, item.id)) from error

    return offer


async def _exiger_une_carte(
    session: AsyncSession, *, business_id: uuid.UUID, item: CatalogItem
) -> None:
    """Refuse d'ouvrir une offre à choix quand la carte n'est nulle part.

    Seulement pour les items qui laissent un choix : c'est le commerce qui pose
    ce drapeau, et une prestation qui se désigne elle-même n'a besoin d'aucune
    carte.
    """
    if not item.leaves_choice:
        return

    business = await session.get(Business, business_id)
    # Le commerce existe forcément ici — l'appelant l'a résolu pour arriver
    # jusqu'à cette route — mais le lire rend l'intention explicite plutôt que
    # de faire confiance à un `None` impossible.
    if business is None or not await business_menu.carte_disponible(session, business):
        raise CarteManquante(item.id)


async def set_active(
    session: AsyncSession, *, offer: TierOffer, is_active: bool, actor: Actor
) -> bool:
    """Retrait sans suppression. Renvoie faux si rien n'a changé.

    **Rouvrir est une ouverture aussi.** Une offre à choix retirée pendant que
    la carte était en place, puis rouverte après que le commerce a effacé son
    lien, repartirait en ligne sans carte. Fermer, en revanche, ne demande
    rien : on ne bloque pas quelqu'un qui range.
    """
    if offer.is_active == is_active:
        return False

    if is_active:
        item = await session.get(CatalogItem, offer.catalog_item_id)
        if item is not None:
            await _exiger_une_carte(session, business_id=offer.business_id, item=item)

    precedent = TierOfferState.ACTIVE if offer.is_active else TierOfferState.INACTIVE
    courant = TierOfferState.ACTIVE if is_active else TierOfferState.INACTIVE

    offer.is_active = is_active
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.TIER_OFFER,
        entity_id=offer.id,
        from_status=precedent.value,
        to_status=courant.value,
        actor=actor,
    )
    return True


def _mention_propre(valeur: str | None) -> str | None:
    """Une mention vide est une absence de mention, pas une chaîne vide.

    L'écran envoie ce que la personne a tapé, et effacer un champ y laisse `""`.
    Sans cette normalisation, la contrepartie recopierait une chaîne vide, et
    l'affichage — gardé par `required_mention ? … : null` — la traiterait comme
    présente : une ligne « citez : » suivie de rien. Le même geste est fait sur
    les liens publics du salon, côté écran ; ici il est au service, parce que
    c'est le service qui écrit.
    """
    if valeur is None:
        return None
    nettoye = valeur.strip()
    return nettoye or None


async def update_offer(
    session: AsyncSession, *, offer: TierOffer, payload: TierOfferUpdate, actor: Actor
) -> TierOffer:
    """Corrige les critères de publication d'une offre. **Sans rétroactivité.**

    Les contreparties déjà nées gardent les critères recopiés à leur création —
    `SPEC.md` §2.5 : « recopiés sur la contrepartie à sa création et figés là ».
    Une créatrice qui a consommé hier a lu une consigne ; la changer sous elle
    ferait tomber sa publication pour un motif qui n'existait pas au moment où
    elle a publié.

    **Le journal est celui de la configuration, pas celui de l'audit.** Une
    mention est une valeur qui change, et ce qu'on voudra relire est « qui a
    écrit quoi à la place de quoi » — ce que `record_transition` ne sait pas
    dire. L'audit garde les bascules de l'offre, qui sont un autre sujet.
    """
    champs = payload.model_dump(exclude_unset=True)
    if "required_mention" in champs:
        champs["required_mention"] = _mention_propre(champs["required_mention"])

    # L'ancienne valeur se lit **avant** l'écriture, sinon le journal enregistre
    # deux fois la nouvelle et ne dit plus rien de ce qui a changé.
    modifies: dict[str, tuple[object, object]] = {}

    # `required_mention` accepte `None` : c'est ainsi qu'on retire une mention.
    if "required_mention" in champs:
        modifies["required_mention"] = (offer.required_mention, champs["required_mention"])
        offer.required_mention = champs["required_mention"]

    # `required_geotag` ne l'accepte pas — la colonne est non nullable, et
    # « pas de lieu » s'écrit `false`. Un `null` explicite est donc ignoré
    # plutôt que d'aller heurter la base avec une erreur qui ne dirait rien.
    if champs.get("required_geotag") is not None:
        modifies["required_geotag"] = (offer.required_geotag, champs["required_geotag"])
        offer.required_geotag = champs["required_geotag"]

    await session.flush()

    if modifies:
        await config_journal.enregistrer(
            session,
            entity_type=config_journal.TIER_OFFER,
            entity_id=offer.id,
            champs=modifies,
            actor=actor,
        )

    return offer


async def delete_offer(session: AsyncSession, *, offer: TierOffer) -> None:
    """Une offre réservée ne se supprime pas : elle se désactive."""
    reservee = bool(
        await session.scalar(sa.select(sa.exists().where(Booking.tier_offer_id == offer.id)))
    )
    if reservee:
        raise OfferHasBookings(offer.id)

    try:
        async with session.begin_nested():
            await session.delete(offer)
            await session.flush()
    except IntegrityError as error:
        # Filet du RESTRICT posé par `booking`.
        raise OfferHasBookings(offer.id) from error
