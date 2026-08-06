"""Non-chevauchement des plages, éprouvé en SQL direct.

Aucun de ces tests ne passe par le service. Le service continue de vérifier et
de renvoyer `capacity_rule_overlap` — la contrainte est le filet, pas le
message. Ce qui est éprouvé ici, c'est ce qui tiendra face au jeu de données de
départ et à l'import de la phase 9, qui écrivent en masse.
"""

import uuid
from datetime import time

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models import CapacityRule
from tests.factories import new_business

MARDI = 1


async def _plage(
    conn: AsyncConnection,
    business_id: uuid.UUID,
    *,
    weekday: int = MARDI,
    debut: str = "09:00",
    fin: str = "12:00",
    postes: int = 3,
) -> uuid.UUID:
    """Insertion en SQL direct, sans le service."""
    result = await conn.execute(
        sa.insert(CapacityRule)
        .values(
            business_id=business_id,
            weekday=weekday,
            start_time=time.fromisoformat(debut),
            end_time=time.fromisoformat(fin),
            concurrent_slots=postes,
        )
        .returning(CapacityRule.id)
    )
    return result.scalar_one()


# --------------------------------------------------------------------------
# ce que la contrainte doit refuser
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("debut", "fin"),
    [
        ("11:00", "15:00"),
        ("08:00", "10:00"),
        ("10:00", "11:00"),
        ("08:00", "13:00"),
        ("09:00", "12:00"),
    ],
    ids=["fin", "debut", "dedans", "englobe", "identique"],
)
async def test_deux_plages_qui_se_recouvrent_sont_refusees(
    conn: AsyncConnection, debut: str, fin: str
) -> None:
    business_id = await new_business(conn)
    await _plage(conn, business_id)

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await _plage(conn, business_id, debut=debut, fin=fin)

    assert excinfo.value.orig.diag.constraint_name == "ex_capacity_rule_no_overlap"


async def test_deplacer_une_plage_sur_une_autre_est_refuse(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    matin = await _plage(conn, business_id)
    await _plage(conn, business_id, debut="14:00", fin="18:00")

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(
                sa.update(CapacityRule)
                .where(CapacityRule.id == matin)
                .values(start_time=time(13, 0), end_time=time(16, 0))
            )

    assert excinfo.value.orig.diag.constraint_name == "ex_capacity_rule_no_overlap"


# --------------------------------------------------------------------------
# ce qu'elle doit laisser passer
# --------------------------------------------------------------------------


async def test_deux_plages_accolees_passent(conn: AsyncConnection) -> None:
    """Un commerce qui ferme et rouvre à midi reste cohérent.

    C'est la propriété la plus facile à casser en écrivant la contrainte : un
    recouvrement non strict aux bornes interdirait la coupure du midi, c'est-à-
    dire le cas d'usage même pour lequel plusieurs plages existent.
    """
    business_id = await new_business(conn)
    await _plage(conn, business_id, debut="09:00", fin="12:00")

    apres_midi = await _plage(conn, business_id, debut="12:00", fin="18:00")

    assert apres_midi is not None


async def test_la_coupure_du_midi_passe(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)

    await _plage(conn, business_id, debut="09:00", fin="12:00")
    await _plage(conn, business_id, debut="14:00", fin="18:00")

    combien = await conn.scalar(
        sa.select(sa.func.count())
        .select_from(CapacityRule)
        .where(CapacityRule.business_id == business_id, CapacityRule.weekday == MARDI)
    )
    assert combien == 2


async def test_la_meme_plage_un_autre_jour_passe(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    await _plage(conn, business_id, weekday=MARDI)

    autre_jour = await _plage(conn, business_id, weekday=MARDI + 1)

    assert autre_jour is not None


async def test_la_meme_plage_chez_un_autre_commerce_passe(conn: AsyncConnection) -> None:
    business_a = await new_business(conn)
    business_b = await new_business(conn, name="Salon B")
    await _plage(conn, business_a)

    chez_b = await _plage(conn, business_b)

    assert chez_b is not None


async def test_modifier_le_nombre_de_postes_ne_declenche_rien(conn: AsyncConnection) -> None:
    """Une plage ne se chevauche pas elle-même."""
    business_id = await new_business(conn)
    plage_id = await _plage(conn, business_id)

    await conn.execute(
        sa.update(CapacityRule).where(CapacityRule.id == plage_id).values(concurrent_slots=7)
    )

    postes = await conn.scalar(
        sa.select(CapacityRule.concurrent_slots).where(CapacityRule.id == plage_id)
    )
    assert postes == 7
