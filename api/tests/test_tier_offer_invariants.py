"""Un parent ne se place pas dans une offre, éprouvé en SQL direct.

Aucun de ces tests ne passe par le service. La règle a deux sens et ils sont
testés séparément : sans le second, elle se contourne en changeant l'ordre des
opérations — offrir l'item d'abord, lui donner une variante ensuite.
"""

import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError, InternalError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models import CatalogItem, Tier, TierOffer
from app.models.enums import ContentFormat, Platform
from tests.factories import new_business

REFUS = (IntegrityError, InternalError)


async def _item(
    conn: AsyncConnection,
    business_id: uuid.UUID,
    *,
    nom: str,
    reservable: bool = True,
    parent_id: uuid.UUID | None = None,
) -> uuid.UUID:
    result = await conn.execute(
        sa.insert(CatalogItem)
        .values(
            business_id=business_id,
            parent_item_id=parent_id,
            name=nom,
            price_cents=8000,
            requires_booking=reservable,
            duration_minutes=60 if reservable else None,
        )
        .returning(CatalogItem.id)
    )
    return result.scalar_one()


async def _offre(conn: AsyncConnection, business_id: uuid.UUID, item_id: uuid.UUID) -> uuid.UUID:
    tier_id = await conn.scalar(
        sa.select(Tier.id).where(
            Tier.platform == Platform.INSTAGRAM, Tier.content_format == ContentFormat.STORY
        )
    )
    result = await conn.execute(
        sa.insert(TierOffer)
        .values(business_id=business_id, tier_id=tier_id, catalog_item_id=item_id)
        .returning(TierOffer.id)
    )
    return result.scalar_one()


# --------------------------------------------------------------------------
# sens 1 : offrir un item qui a déjà des variantes
# --------------------------------------------------------------------------


async def test_offrir_un_parent_est_refuse(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    parent = await _item(conn, business_id, nom="Coloration", reservable=False)
    await _item(conn, business_id, nom="Longue", parent_id=parent)

    with pytest.raises(REFUS) as excinfo:
        async with conn.begin_nested():
            await _offre(conn, business_id, parent)

    assert "ne se place pas dans une offre" in str(excinfo.value)

    # La session doit rester utilisable après le refus : c'est la moitié du
    # test, un refus qui casse la connexion n'est pas un refus propre.
    variante = await conn.scalar(
        sa.select(CatalogItem.id).where(CatalogItem.parent_item_id == parent)
    )
    assert await _offre(conn, business_id, variante) is not None


# --------------------------------------------------------------------------
# sens 2 : donner une variante à un item déjà offert
# --------------------------------------------------------------------------


async def test_donner_une_variante_a_un_item_offert_est_refuse(
    conn: AsyncConnection,
) -> None:
    """Sans ce sens, la règle se contourne en inversant l'ordre des opérations."""
    business_id = await new_business(conn)
    autonome = await _item(conn, business_id, nom="Soin", reservable=False)
    await _offre(conn, business_id, autonome)

    with pytest.raises(REFUS) as excinfo:
        async with conn.begin_nested():
            await _item(conn, business_id, nom="Variante", parent_id=autonome)

    assert "deja place dans une offre" in str(excinfo.value)

    reste = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(TierOffer)
        .where(TierOffer.business_id == business_id)
    )
    assert reste == 1


async def test_rattacher_un_item_existant_sous_un_item_offert_est_refuse(
    conn: AsyncConnection,
) -> None:
    business_id = await new_business(conn)
    offert = await _item(conn, business_id, nom="Soin", reservable=False)
    await _offre(conn, business_id, offert)
    orphelin = await _item(conn, business_id, nom="Autre soin")

    with pytest.raises(REFUS) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(CatalogItem)
                .where(CatalogItem.id == orphelin)
                .values(parent_item_id=offert)
            )

    assert "deja place dans une offre" in str(excinfo.value)


# --------------------------------------------------------------------------
# ce que le trigger ne doit pas casser
# --------------------------------------------------------------------------


async def test_offrir_une_variante_passe(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    parent = await _item(conn, business_id, nom="Coloration", reservable=False)
    variante = await _item(conn, business_id, nom="Longue", parent_id=parent)

    assert await _offre(conn, business_id, variante) is not None


async def test_offrir_un_item_autonome_passe(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    autonome = await _item(conn, business_id, nom="Brushing")

    assert await _offre(conn, business_id, autonome) is not None


async def test_donner_une_variante_a_un_item_non_offert_passe(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    futur_parent = await _item(conn, business_id, nom="Coloration", reservable=False)

    variante = await _item(conn, business_id, nom="Longue", parent_id=futur_parent)

    assert variante is not None


async def test_retirer_l_offre_libere_l_item(conn: AsyncConnection) -> None:
    """La règle porte sur l'état, pas sur l'histoire : sans offre, l'item redevient libre."""
    business_id = await new_business(conn)
    autonome = await _item(conn, business_id, nom="Soin", reservable=False)
    offre_id = await _offre(conn, business_id, autonome)

    await conn.execute(sa.delete(TierOffer).where(TierOffer.id == offre_id))

    assert await _item(conn, business_id, nom="Variante", parent_id=autonome) is not None
