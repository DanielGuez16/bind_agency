"""Profil commerce.

Le service ne connaît que l'interface `Geocoder`, jamais un fournisseur.
Comme partout, il n'ouvre ni ne committe de transaction.
"""

import uuid
from dataclasses import dataclass
from enum import StrEnum

import sqlalchemy as sa
from geoalchemy2 import Geometry, WKTElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.geocoding import Coordinates, Geocoder
from app.models import (
    Business,
    BusinessMember,
    CapacityRule,
    CatalogItem,
    Tier,
    TierOffer,
    User,
)
from app.models.enums import BusinessMemberRole, BusinessStatus, SuspensionReason
from app.schemas.business import BusinessCreate, BusinessUpdate, CoordinatesPayload
from app.services import email_verification, grace
from app.services.audit import Actor, AuditedEntity, record_transition

REASON_ACTIVATION = "business_activated"
REASON_PAUSE = "business_paused"

SRID = 4326


class BusinessError(Exception):
    """Base des erreurs du profil commerce."""


class NotActive(BusinessError):
    """Mettre en pause ce qui n'est pas ouvert n'a pas de sens."""


class EmailNotVerified(BusinessError):
    """L'adresse de celui qui active n'est pas confirmée."""


class AlreadyActive(BusinessError):
    pass


class NotClaimed(BusinessError):
    """Une fiche préparée sur le terrain que personne n'a encore assumée."""


class MissingAddress(BusinessError):
    pass


class MissingCoordinates(BusinessError):
    pass


def point(coordinates: Coordinates) -> WKTElement:
    return WKTElement(coordinates.as_wkt(), srid=SRID)


async def resoudre_la_position(
    geocoder: Geocoder, *, address: str | None, declared: CoordinatesPayload | None
) -> Coordinates | None:
    """L'adresse et les coordonnées déclarées, ramenées à un point.

    Partagée avec la préparation d'une fiche sur le terrain : deux façons de
    créer un commerce, une seule règle de résolution. Écrite deux fois, elle
    aurait fini par diverger — et un commerce préparé au comptoir se serait
    placé ailleurs que le même commerce inscrit depuis son bureau.
    """
    coordonnees = (
        Coordinates(declared.longitude, declared.latitude) if declared is not None else None
    )
    return await geocoder.locate(address, declared=coordonnees)


async def coordinates_of(session: AsyncSession, business: Business) -> Coordinates | None:
    """Relit les coordonnées en base : `geo` est un binaire opaque côté Python."""
    if business.geo is None:
        return None

    point = sa.cast(Business.geo, Geometry)
    row = (
        await session.execute(
            sa.select(sa.func.ST_X(point), sa.func.ST_Y(point)).where(Business.id == business.id)
        )
    ).one()

    return Coordinates(longitude=row[0], latitude=row[1])


async def create_business(
    session: AsyncSession,
    *,
    payload: BusinessCreate,
    creator: User,
    geocoder: Geocoder,
) -> Business:
    """Crée le commerce et rattache son créateur comme `owner`, d'un seul tenant.

    Un commerce sans membre est un commerce auquel personne ne peut accéder :
    les deux écritures appartiennent à la même transaction, pas à deux étapes
    dont la seconde pourrait manquer.
    """
    resolved = await resoudre_la_position(
        geocoder, address=payload.address, declared=payload.coordinates
    )

    business = Business(
        name=payload.name,
        category=payload.category,
        address=payload.address,
        neighborhood=payload.neighborhood,
        geo=point(resolved) if resolved else None,
        timezone=payload.timezone,
        default_locale=payload.default_locale,
        phone=payload.phone,
        currency=payload.currency,
        cover_photo_key=payload.cover_photo_key,
        menu_url=payload.menu_url,
        status=BusinessStatus.ONBOARDING,
    )
    session.add(business)
    await session.flush()

    session.add(
        BusinessMember(
            business_id=business.id,
            user_id=creator.id,
            role=BusinessMemberRole.OWNER,
        )
    )
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=None,
        to_status=BusinessStatus.ONBOARDING.value,
        actor=Actor.from_user(creator),
    )

    return business


async def get_business(session: AsyncSession, business_id: uuid.UUID) -> Business | None:
    return await session.get(Business, business_id)


async def update_business(
    session: AsyncSession,
    *,
    business: Business,
    payload: BusinessUpdate,
    geocoder: Geocoder,
) -> Business:
    """Met à jour les champs fournis. La devise n'en fait pas partie, par construction."""
    fields = payload.model_dump(exclude_unset=True)

    if "coordinates" in fields or "address" in fields:
        address = fields.get("address", business.address)
        resolved = await resoudre_la_position(
            geocoder, address=address, declared=payload.coordinates
        )
        business.geo = point(resolved) if resolved else None

    for name in (
        "name",
        "category",
        "address",
        # **Dans la liste, sinon accepté et ignoré.** Un champ que le schéma
        # laisse passer et que le service oublie rend un 200 à quelqu'un qui
        # croit avoir enregistré — c'est le défaut nommé dans CLAUDE.md, et
        # cette liste blanche est précisément l'endroit où on l'introduit.
        "neighborhood",
        "timezone",
        "default_locale",
        "phone",
        "cover_photo_key",
        "menu_url",
    ):
        if name in fields:
            setattr(business, name, fields[name])

    await session.flush()
    return business


async def activate_business(session: AsyncSession, *, business: Business, actor: Actor) -> Business:
    """Transition explicite, jamais un effet de bord d'une mise à jour.

    Le refus nomme la condition qui manque : « ça n'a pas marché » n'aide
    personne à compléter son inscription.
    """
    if business.status is BusinessStatus.ACTIVE:
        raise AlreadyActive(business.id)
    # **Une fiche préparée ne s'ouvre pas.** Elle n'appartient à personne tant
    # que personne ne l'a prise en main ; l'activer publierait un salon que
    # nul n'assume, à une adresse que nul n'a confirmée. Le chemin passe par la
    # prise en main, qui la fait sortir de `draft`.
    if business.status is BusinessStatus.DRAFT:
        raise NotClaimed(business.id)

    # **L'adresse de qui active, confirmée.** Mettre un salon en ligne l'expose
    # à des créatrices qui vont s'y déplacer : le minimum est de pouvoir joindre
    # celui qui l'assume. La même frontière que la réservation — ce qui engage
    # quelqu'un d'autre demande une adresse qui existe.
    if actor.user_id is None or not await email_verification.a_verifie(session, actor.user_id):
        raise EmailNotVerified(business.id)

    # La même liste que celle rendue par `etapes_activation`. Réécrire les
    # conditions ici en ferait deux, et l'écran finirait par annoncer « prêt »
    # sur une activation que le service refuse.
    for etape in await etapes_activation(session, business=business):
        if etape.blocking and not etape.done:
            raise _REFUS_PAR_ETAPE[etape.cle](business.id)

    previous = business.status
    business.status = BusinessStatus.ACTIVE
    # **La raison du retrait ne survit pas au retour.** Un salon revenu en
    # ligne dont la raison traîne encore ferait croire à un retrait qui
    # n'existe plus — et la base l'interdit, ce qui est la bonne façon de ne
    # pas l'oublier ici.
    business.suspended_reason = None
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=previous.value,
        to_status=BusinessStatus.ACTIVE.value,
        actor=actor,
        reason=REASON_ACTIVATION,
    )

    # **Aucune carte bancaire n'est demandée ici.** Le salon ouvre, et
    # l'échéance lui est posée tout de suite plutôt qu'au prochain balayage :
    # il doit pouvoir lire sa date le jour où il ouvre, pas le lendemain.
    await grace.ouvrir(session, business=business)

    return business


async def pause_business(session: AsyncSession, *, business: Business, actor: Actor) -> Business:
    """Le commerce se retire du fil, sans rien perdre.

    **Pas un effacement.** Le catalogue, les horaires et l'historique restent ;
    seule la visibilité s'arrête. C'est ce qu'un salon veut pendant des congés
    ou des travaux, et c'est réversible d'un geste.

    Les réservations déjà prises ne sont pas touchées : elles ont été promises,
    et les annuler en masse par un changement de visibilité ferait porter au
    commerce une décision qu'il n'a pas prise ligne à ligne.
    """
    if business.status is not BusinessStatus.ACTIVE:
        raise NotActive(business.id)

    previous = business.status
    business.status = BusinessStatus.SUSPENDED
    # Qui s'est retiré, et pourquoi. Sans cette raison, souscrire ramènerait en
    # ligne un salon parti en travaux — un paiement ne décide pas à sa place.
    business.suspended_reason = SuspensionReason.PAUSED_BY_BUSINESS
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.BUSINESS,
        entity_id=business.id,
        from_status=previous.value,
        to_status=BusinessStatus.SUSPENDED.value,
        actor=actor,
        reason=REASON_PAUSE,
    )
    return business


# ---------------------------------------------------------------------------
# Étapes d'activation
#
# Le service connaissait déjà ces conditions, il ne les exposait pas : le
# commerçant apprenait ce qui lui manquait en essayant, une condition à la
# fois, sans jamais voir la liste. Elles sont maintenant lisibles avant
# l'essai, et `activate_business` les consomme — c'est ce qui garantit que
# l'écran et le refus disent la même chose.
# ---------------------------------------------------------------------------


class EtapeActivation(StrEnum):
    ADRESSE = "address"
    COORDONNEES = "coordinates"
    PHOTO_DE_COUVERTURE = "cover_photo"
    CATALOGUE = "catalog_item"
    OFFRE_DE_PALIER = "tier_offer"
    HORAIRES = "capacity_rule"


@dataclass(frozen=True, slots=True)
class Etape:
    cle: EtapeActivation
    done: bool
    #: Bloquante : l'activation est refusée tant qu'elle n'est pas faite.
    #: Non bloquante : l'activation passe, mais le commerce reste invisible ou
    #: incomplet. La distinction est rendue plutôt que devinée — une étape
    #: présentée comme obligatoire alors qu'elle ne l'est pas fait renoncer des
    #: commerces qui pouvaient déjà ouvrir.
    blocking: bool


#: Une étape bloquante non faite lève l'erreur que le routeur sait traduire.
#: La table est ici et non dans le routeur : c'est la même décision que la
#: liste, elle ne se sépare pas d'elle.
_REFUS_PAR_ETAPE = {
    EtapeActivation.ADRESSE: MissingAddress,
    EtapeActivation.COORDONNEES: MissingCoordinates,
}


async def etapes_activation(session: AsyncSession, *, business: Business) -> tuple[Etape, ...]:
    """Ce qui reste à faire, dans l'ordre où on le fait.

    Les trois dernières ne bloquent pas l'activation mais décident de la
    visibilité : un commerce actif sans offre de palier, sans item disponible
    ou sans règle de capacité n'apparaît dans aucun fil. Le taire produirait
    un commerce « activé » que personne ne voit et dont personne ne comprend
    pourquoi.
    """
    a_un_item = await session.scalar(
        sa.select(sa.literal(True))
        .where(CatalogItem.business_id == business.id, CatalogItem.is_available.is_(True))
        .limit(1)
    )
    a_une_offre = await session.scalar(
        sa.select(sa.literal(True))
        .select_from(TierOffer)
        .join(Tier, Tier.id == TierOffer.tier_id)
        .where(
            TierOffer.business_id == business.id,
            TierOffer.is_active.is_(True),
            Tier.is_active.is_(True),
        )
        .limit(1)
    )
    a_des_horaires = await session.scalar(
        sa.select(sa.literal(True)).where(CapacityRule.business_id == business.id).limit(1)
    )

    return (
        Etape(EtapeActivation.ADRESSE, business.address is not None, blocking=True),
        Etape(EtapeActivation.COORDONNEES, business.geo is not None, blocking=True),
        Etape(
            EtapeActivation.PHOTO_DE_COUVERTURE,
            business.cover_photo_key is not None,
            blocking=False,
        ),
        Etape(EtapeActivation.CATALOGUE, bool(a_un_item), blocking=False),
        Etape(EtapeActivation.OFFRE_DE_PALIER, bool(a_une_offre), blocking=False),
        Etape(EtapeActivation.HORAIRES, bool(a_des_horaires), blocking=False),
    )
