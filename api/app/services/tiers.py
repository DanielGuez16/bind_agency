"""Paliers.

Configuration globale de la plateforme. Un palier n'appartient à aucun
commerce : il est géré par un administrateur, et par personne d'autre.

Un seuil ne s'applique qu'à l'entrée, au moment où une réservation est prise.
Rien en aval ne le relit : la contrepartie fige ses propres critères, la
réservation fige sa valeur. Le modifier n'a donc aucun effet rétroactif, et ce
n'est pas une précaution du service — c'est la forme des tables.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Collaboration, Tier, TierOffer, User
from app.models.enums import TierState
from app.schemas.tiers import TierCreate, TierUpdate
from app.services.audit import Actor, AuditedEntity, record_transition


class TierError(Exception):
    """Base des erreurs de palier."""


class TierNotFound(TierError):
    pass


class TierAlreadyExists(TierError):
    """Un palier existe déjà pour ce couple plateforme et format."""


class TierInUse(TierError):
    """Référencé par une offre ou une contrepartie : il se désactive, il ne se supprime pas."""


async def list_tiers(session: AsyncSession) -> list[Tier]:
    statement = sa.select(Tier).order_by(Tier.platform, Tier.display_order)
    return list(await session.scalars(statement))


async def get_tier(session: AsyncSession, tier_id: uuid.UUID) -> Tier:
    tier = await session.get(Tier, tier_id)
    if tier is None:
        raise TierNotFound(tier_id)
    return tier


async def create_tier(session: AsyncSession, *, payload: TierCreate) -> Tier:
    tier = Tier(
        platform=payload.platform,
        content_format=payload.content_format,
        min_followers=payload.min_followers,
        min_completed_collabs=payload.min_completed_collabs,
        min_reliability_score=payload.min_reliability_score,
        value_ratio_hint=payload.value_ratio_hint,
        display_order=payload.display_order,
        is_active=payload.is_active,
    )
    try:
        # `add` à l'intérieur du bloc : voir la note dans `tier_offers`.
        async with session.begin_nested():
            session.add(tier)
            await session.flush()
    except IntegrityError as error:
        # L'unicité est vérifiée par la base, pas par un SELECT préalable : deux
        # créations simultanées passeraient à travers une pré-vérification.
        raise TierAlreadyExists((payload.platform, payload.content_format)) from error

    return tier


async def update_tier(
    session: AsyncSession, *, tier: Tier, payload: TierUpdate, actor: Actor
) -> Tier:
    """Met à jour un palier. Seule la bascule d'activité laisse une trace.

    Un changement de seuil n'est pas une transition d'état — le journal, dont la
    forme est `from_status` vers `to_status`, ne sait pas le décrire. Voir
    DECISIONS.md : c'est un manque assumé, pas un oubli.
    """
    fields = payload.model_dump(exclude_unset=True)
    bascule = "is_active" in fields and fields["is_active"] != tier.is_active
    precedent = tier.is_active

    for name in (
        "min_followers",
        "min_completed_collabs",
        "min_reliability_score",
        "value_ratio_hint",
        "display_order",
        "is_active",
    ):
        if name in fields:
            setattr(tier, name, fields[name])

    await session.flush()

    if bascule:
        await record_transition(
            session,
            entity=AuditedEntity.TIER,
            entity_id=tier.id,
            from_status=(TierState.ACTIVE if precedent else TierState.INACTIVE).value,
            to_status=(TierState.ACTIVE if tier.is_active else TierState.INACTIVE).value,
            actor=actor,
        )

    return tier


async def is_referenced(session: AsyncSession, tier_id: uuid.UUID) -> bool:
    """Une offre composée ou une contrepartie en cours suffisent à le retenir."""
    par_une_offre = sa.select(sa.exists().where(TierOffer.tier_id == tier_id))
    par_une_contrepartie = sa.select(sa.exists().where(Collaboration.tier_id == tier_id))

    return bool(await session.scalar(par_une_offre)) or bool(
        await session.scalar(par_une_contrepartie)
    )


async def delete_tier(session: AsyncSession, *, tier: Tier) -> None:
    """Un palier référencé ne se supprime pas. Il se désactive.

    Désactiver ne casse rien : les offres qui le référencent restent en base,
    elles cessent simplement d'être proposées. Rien n'est supprimé en cascade.
    """
    if await is_referenced(session, tier.id):
        raise TierInUse(tier.id)

    try:
        async with session.begin_nested():
            await session.delete(tier)
            await session.flush()
    except IntegrityError as error:
        # Filet des RESTRICT posés par `tier_offer` et `collaboration`.
        raise TierInUse(tier.id) from error


def actor_for(admin: User) -> Actor:
    return Actor.from_user(admin)
