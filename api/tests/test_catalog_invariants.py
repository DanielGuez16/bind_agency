"""Invariants de forme du catalogue, éprouvés en SQL direct.

Aucun de ces tests ne passe par le service. C'est le point : un trigger vérifié
au travers du code qu'il est censé doubler ne prouve rien. Ce qui est éprouvé
ici, c'est ce qui tiendra face au script d'import en masse de la phase 9.
"""

import uuid

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError, InternalError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models import CatalogItem
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
    """Insertion en SQL direct, sans le service."""
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


# --------------------------------------------------------------------------
# un parent n'est jamais réservable
# --------------------------------------------------------------------------


async def test_une_variante_sous_un_item_reservable_est_refusee(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    reservable = await _item(conn, business_id, nom="Soin", reservable=True)

    with pytest.raises(REFUS) as excinfo:
        async with conn.begin_nested():
            await _item(conn, business_id, nom="Variante", parent_id=reservable)

    assert "ne peut pas etre reservable" in str(excinfo.value)


async def test_rendre_reservable_un_item_qui_a_des_variantes_est_refuse(
    conn: AsyncConnection,
) -> None:
    """Le sens inverse : l'item existe déjà comme parent quand on le bascule."""
    business_id = await new_business(conn)
    parent = await _item(conn, business_id, nom="Coloration", reservable=False)
    await _item(conn, business_id, nom="Longue", parent_id=parent)

    with pytest.raises(REFUS) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(CatalogItem)
                .where(CatalogItem.id == parent)
                .values(requires_booking=True, duration_minutes=60)
            )

    assert "ne peut pas etre reservable" in str(excinfo.value)


async def test_une_variante_sous_un_parent_non_reservable_est_acceptee(
    conn: AsyncConnection,
) -> None:
    """Le cas légitime doit passer : une contrainte qui refuse tout ne prouve rien."""
    business_id = await new_business(conn)
    parent = await _item(conn, business_id, nom="Coloration", reservable=False)

    variante = await _item(conn, business_id, nom="Longue", parent_id=parent)

    stocke = await conn.scalar(
        sa.select(CatalogItem.parent_item_id).where(CatalogItem.id == variante)
    )
    assert stocke == parent


# --------------------------------------------------------------------------
# deux niveaux au maximum
# --------------------------------------------------------------------------


async def test_une_variante_de_variante_est_refusee(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    parent = await _item(conn, business_id, nom="Coloration", reservable=False)
    variante = await _item(conn, business_id, nom="Longue", parent_id=parent)

    with pytest.raises(REFUS) as excinfo:
        async with conn.begin_nested():
            await _item(conn, business_id, nom="Très longue", parent_id=variante)

    assert "ne peut pas avoir de variantes" in str(excinfo.value)


async def test_rattacher_un_item_qui_a_deja_des_enfants_est_refuse(
    conn: AsyncConnection,
) -> None:
    """La même chaîne de trois niveaux, construite par l'autre bout."""
    business_id = await new_business(conn)
    futur_parent = await _item(conn, business_id, nom="Racine", reservable=False)
    intermediaire = await _item(conn, business_id, nom="Coloration", reservable=False)
    await _item(conn, business_id, nom="Longue", parent_id=intermediaire)

    with pytest.raises(REFUS) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(CatalogItem)
                .where(CatalogItem.id == intermediaire)
                .values(parent_item_id=futur_parent)
            )

    assert "ne peut pas avoir de variantes" in str(excinfo.value)


# --------------------------------------------------------------------------
# ce que le trigger ne doit pas casser
# --------------------------------------------------------------------------


async def test_un_item_autonome_reste_reservable(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)

    autonome = await _item(conn, business_id, nom="Soin", reservable=True)

    reservable = await conn.scalar(
        sa.select(CatalogItem.requires_booking).where(CatalogItem.id == autonome)
    )
    assert reservable is True


async def test_un_parent_peut_avoir_plusieurs_variantes(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    parent = await _item(conn, business_id, nom="Coloration", reservable=False)

    await _item(conn, business_id, nom="Courte", parent_id=parent)
    await _item(conn, business_id, nom="Longue", parent_id=parent)

    combien = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(CatalogItem.parent_item_id == parent)
    )
    assert combien == 2


async def test_modifier_le_nom_d_un_parent_ne_declenche_rien(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    parent = await _item(conn, business_id, nom="Coloration", reservable=False)
    await _item(conn, business_id, nom="Longue", parent_id=parent)

    await conn.execute(
        sa.update(CatalogItem).where(CatalogItem.id == parent).values(name="Coloration végétale")
    )

    nom = await conn.scalar(sa.select(CatalogItem.name).where(CatalogItem.id == parent))
    assert nom == "Coloration végétale"
