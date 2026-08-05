"""Les contraintes doivent vivre en base, pas seulement dans Pydantic.

Chaque test vérifie que Postgres **refuse** l'écriture invalide, et qu'il la
refuse pour la bonne raison — le nom de la contrainte est comparé, pas
seulement le fait qu'une erreur soit levée.
"""

import uuid
from datetime import UTC, datetime, time, timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError, InternalError
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models import (
    AuditLog,
    CapacityRule,
    CatalogItem,
    CreatorProfile,
    Proof,
    SocialAccount,
    Tier,
    TierOffer,
    User,
)
from app.models.enums import ActorKind, CaptureMethod, ContentFormat, Platform, UserRole
from tests.factories import (
    booking_insert,
    new_booking_graph,
    new_business,
    new_catalog_item,
    new_creator,
    new_social_account,
    new_tier,
    new_tier_offer,
    new_user,
)


async def assert_rejected(
    conn: AsyncConnection,
    statement,
    *,
    constraint: str | None = None,
    column: str | None = None,
) -> None:
    """Le SAVEPOINT permet de continuer à utiliser la transaction après le refus."""
    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(statement)

    diagnostic = excinfo.value.orig.diag
    if constraint is not None:
        assert diagnostic.constraint_name == constraint, (
            f"refusé par {diagnostic.constraint_name}, attendu {constraint}"
        )
    if column is not None:
        assert diagnostic.column_name == column


# --------------------------------------------------------------------------
# catalog_item : durée obligatoire si et seulement si l'item est réservable
# --------------------------------------------------------------------------


async def test_item_reservable_sans_duree_est_refuse(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)

    await assert_rejected(
        conn,
        sa.insert(CatalogItem).values(
            business_id=business_id,
            name="Soin",
            price_cents=8000,
            requires_booking=True,
            duration_minutes=None,
        ),
        constraint="ck_catalog_item_duration_matches_requires_booking",
    )


async def test_item_non_reservable_avec_duree_est_refuse(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)

    await assert_rejected(
        conn,
        sa.insert(CatalogItem).values(
            business_id=business_id,
            name="Entrée musée",
            price_cents=2000,
            requires_booking=False,
            duration_minutes=60,
        ),
        constraint="ck_catalog_item_duration_matches_requires_booking",
    )


async def test_item_non_reservable_sans_duree_est_accepte(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)

    item_id = await new_catalog_item(conn, business_id, requires_booking=False)

    duration = await conn.scalar(
        sa.select(CatalogItem.duration_minutes).where(CatalogItem.id == item_id)
    )
    assert duration is None


async def test_duree_nulle_est_refusee(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)

    await assert_rejected(
        conn,
        sa.insert(CatalogItem).values(
            business_id=business_id,
            name="Soin",
            price_cents=8000,
            requires_booking=True,
            duration_minutes=0,
        ),
        constraint="ck_catalog_item_duration_minutes_positive",
    )


async def test_variante_rattachee_a_un_autre_commerce_est_refusee(conn: AsyncConnection) -> None:
    """Une variante appartient forcément au commerce de son parent."""
    business_a = await new_business(conn)
    business_b = await new_business(conn, name="Autre salon")
    parent_id = await new_catalog_item(conn, business_a)

    await assert_rejected(
        conn,
        sa.insert(CatalogItem).values(
            business_id=business_b,
            parent_item_id=parent_id,
            name="Variante longue",
            price_cents=12000,
            requires_booking=True,
            duration_minutes=90,
        ),
        constraint="fk_catalog_item_parent_business",
    )


# --------------------------------------------------------------------------
# booking : créneau si et seulement si l'item exige une réservation
# --------------------------------------------------------------------------


async def test_reservation_avec_creneau_obligatoire_sans_creneau_est_refusee(
    conn: AsyncConnection,
) -> None:
    graph = await new_booking_graph(conn, requires_booking=True)

    await assert_rejected(
        conn,
        booking_insert(graph, requires_booking=True, starts_at=None, ends_at=None),
        constraint="ck_booking_slot_matches_requires_booking",
    )


async def test_reservation_sans_creneau_avec_creneau_est_refusee(conn: AsyncConnection) -> None:
    graph = await new_booking_graph(conn, requires_booking=False)
    now = datetime.now(UTC)

    await assert_rejected(
        conn,
        booking_insert(
            graph,
            requires_booking=False,
            starts_at=now + timedelta(days=1),
            ends_at=now + timedelta(days=1, hours=1),
        ),
        constraint="ck_booking_slot_matches_requires_booking",
    )


async def test_requires_booking_incoherent_avec_item_est_refuse(conn: AsyncConnection) -> None:
    """La copie dénormalisée ne peut pas mentir sur l'item réservé."""
    graph = await new_booking_graph(conn, requires_booking=True)

    await assert_rejected(
        conn,
        booking_insert(graph, requires_booking=False, starts_at=None, ends_at=None),
        constraint="fk_booking_item_business_requires_booking",
    )


async def test_bascule_de_requires_booking_sur_item_deja_reserve_est_refusee(
    conn: AsyncConnection,
) -> None:
    """Conséquence assumée : on ne réécrit pas la nature d'une réservation passée."""
    graph = await new_booking_graph(conn, requires_booking=True)
    await conn.execute(booking_insert(graph))

    await assert_rejected(
        conn,
        sa.update(CatalogItem)
        .where(CatalogItem.id == graph["catalog_item_id"])
        .values(requires_booking=False, duration_minutes=None),
        constraint="fk_booking_item_business_requires_booking",
    )


async def test_offre_d_un_autre_commerce_est_refusee(conn: AsyncConnection) -> None:
    graph = await new_booking_graph(conn)
    autre_business = await new_business(conn, name="Salon voisin")
    autre_item = await new_catalog_item(conn, autre_business)
    autre_offre = await new_tier_offer(conn, autre_business, graph["tier_id"], autre_item)

    await assert_rejected(
        conn,
        booking_insert(graph, tier_offer_id=autre_offre),
        constraint="fk_booking_offer_business",
    )


async def test_valid_until_est_obligatoire(conn: AsyncConnection) -> None:
    graph = await new_booking_graph(conn)

    await assert_rejected(
        conn,
        booking_insert(graph, valid_until=None),
        column="valid_until",
    )


async def test_reservation_en_garde_sans_echeance_de_garde_est_refusee(
    conn: AsyncConnection,
) -> None:
    graph = await new_booking_graph(conn)

    await assert_rejected(
        conn,
        booking_insert(graph, status="held", hold_expires_at=None),
        constraint="ck_booking_held_has_hold_expiry",
    )


async def test_fin_avant_debut_est_refusee(conn: AsyncConnection) -> None:
    graph = await new_booking_graph(conn)
    now = datetime.now(UTC)

    await assert_rejected(
        conn,
        booking_insert(
            graph,
            starts_at=now + timedelta(days=1, hours=2),
            ends_at=now + timedelta(days=1),
        ),
        constraint="ck_booking_ends_after_starts",
    )


# --------------------------------------------------------------------------
# unicités
# --------------------------------------------------------------------------


async def test_meme_item_deux_fois_au_meme_palier_est_refuse(conn: AsyncConnection) -> None:
    business_id = await new_business(conn)
    item_id = await new_catalog_item(conn, business_id)
    tier_id = await new_tier(conn)
    await new_tier_offer(conn, business_id, tier_id, item_id)

    await assert_rejected(
        conn,
        sa.insert(TierOffer).values(
            business_id=business_id, tier_id=tier_id, catalog_item_id=item_id
        ),
        constraint="uq_tier_offer_business_id_tier_id_catalog_item_id",
    )


async def test_offre_sur_item_d_un_autre_commerce_est_refusee(conn: AsyncConnection) -> None:
    business_a = await new_business(conn)
    business_b = await new_business(conn, name="Autre salon")
    item_a = await new_catalog_item(conn, business_a)
    tier_id = await new_tier(conn)

    await assert_rejected(
        conn,
        sa.insert(TierOffer).values(
            business_id=business_b, tier_id=tier_id, catalog_item_id=item_a
        ),
        constraint="fk_tier_offer_item_business",
    )


async def test_meme_compte_social_connecte_deux_fois_est_refuse(conn: AsyncConnection) -> None:
    creator_a = await new_creator(conn)
    creator_b = await new_creator(conn)
    external_id = "17841400000000000"
    await new_social_account(conn, creator_a, external_id=external_id)

    await assert_rejected(
        conn,
        sa.insert(SocialAccount).values(
            creator_id=creator_b,
            platform=Platform.INSTAGRAM,
            external_id=external_id,
            handle="doublon",
        ),
        constraint="uq_social_account_platform_external_id",
    )


async def test_deux_paliers_sur_le_meme_couple_plateforme_format_est_refuse(
    conn: AsyncConnection,
) -> None:
    await new_tier(conn, platform=Platform.INSTAGRAM, content_format=ContentFormat.STORY)

    await assert_rejected(
        conn,
        sa.insert(Tier).values(
            platform=Platform.INSTAGRAM,
            content_format=ContentFormat.STORY,
            min_followers=50000,
            display_order=2,
        ),
        constraint="uq_tier_platform_content_format",
    )


async def test_email_differant_par_la_casse_est_refuse(conn: AsyncConnection) -> None:
    await new_user(conn, email="Rebecca@Example.com")

    await assert_rejected(
        conn,
        sa.insert(User).values(role=UserRole.ADMIN, email="rebecca@example.com"),
        constraint="uq_app_user_email_lower",
    )


# --------------------------------------------------------------------------
# capacity_rule
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"weekday": 7}, "ck_capacity_rule_weekday_range"),
        ({"weekday": -1}, "ck_capacity_rule_weekday_range"),
        (
            {"start_time": time(18, 0), "end_time": time(9, 0)},
            "ck_capacity_rule_start_before_end",
        ),
        ({"concurrent_slots": 0}, "ck_capacity_rule_concurrent_slots_positive"),
    ],
)
async def test_regles_de_capacite_invalides(
    conn: AsyncConnection, overrides: dict, constraint: str
) -> None:
    business_id = await new_business(conn)
    values = {
        "business_id": business_id,
        "weekday": 2,
        "start_time": time(9, 0),
        "end_time": time(18, 0),
        "concurrent_slots": 3,
    } | overrides

    await assert_rejected(conn, sa.insert(CapacityRule).values(**values), constraint=constraint)


# --------------------------------------------------------------------------
# reliability_score : NULL veut dire neutre et doit le rester
# --------------------------------------------------------------------------


async def test_score_nul_est_accepte_et_leve_le_badge_nouveau_createur(
    conn: AsyncConnection,
) -> None:
    creator_id = await new_creator(conn)

    row = (
        await conn.execute(
            sa.select(CreatorProfile.reliability_score, CreatorProfile.is_new_creator).where(
                CreatorProfile.user_id == creator_id
            )
        )
    ).one()

    assert row.reliability_score is None
    assert row.is_new_creator is True


async def test_le_badge_tombe_des_qu_un_score_existe(conn: AsyncConnection) -> None:
    """Colonne générée : elle ne peut pas diverger de sa source."""
    creator_id = await new_creator(conn)

    await conn.execute(
        sa.update(CreatorProfile)
        .where(CreatorProfile.user_id == creator_id)
        .values(reliability_score=0)
    )

    is_new = await conn.scalar(
        sa.select(CreatorProfile.is_new_creator).where(CreatorProfile.user_id == creator_id)
    )
    assert is_new is False


async def test_is_new_creator_ne_peut_pas_etre_ecrit_a_la_main(conn: AsyncConnection) -> None:
    creator_id = await new_creator(conn)

    with pytest.raises((IntegrityError, InternalError, sa.exc.ProgrammingError)):
        async with conn.begin_nested():
            await conn.execute(
                sa.update(CreatorProfile)
                .where(CreatorProfile.user_id == creator_id)
                .values(is_new_creator=False)
            )


# --------------------------------------------------------------------------
# proof
# --------------------------------------------------------------------------


async def test_preuve_sans_fichier_archive_est_refusee(conn: AsyncConnection) -> None:
    """On ne conserve jamais un simple lien : sans fichier, ce n'est pas une preuve."""
    await assert_rejected(
        conn,
        sa.insert(Proof).values(
            collaboration_id=uuid.uuid4(),
            capture_method=CaptureMethod.URL_FETCH,
            content_hash="sha256:vide",
            media_key=None,
            screenshot_key=None,
        ),
        constraint="ck_proof_has_archived_file",
    )


# --------------------------------------------------------------------------
# audit_log : immuable au sens fort
# --------------------------------------------------------------------------


def _audit_row() -> dict:
    return {
        "entity_type": "booking",
        "entity_id": uuid.uuid4(),
        "from_status": "held",
        "to_status": "confirmed",
        "actor_kind": ActorKind.SYSTEM,
    }


@pytest.mark.parametrize("operation", ["update", "delete", "truncate"])
async def test_le_journal_d_audit_refuse_toute_mutation(
    conn: AsyncConnection, operation: str
) -> None:
    await conn.execute(sa.insert(AuditLog).values(**_audit_row()))

    statements = {
        "update": sa.update(AuditLog).values(to_status="consumed"),
        "delete": sa.delete(AuditLog),
        "truncate": sa.text("TRUNCATE TABLE audit_log"),
    }

    with pytest.raises(IntegrityError) as excinfo:
        async with conn.begin_nested():
            await conn.execute(statements[operation])

    assert "audit_log est immuable" in str(excinfo.value)


async def test_le_journal_d_audit_accepte_les_insertions(conn: AsyncConnection) -> None:
    await conn.execute(sa.insert(AuditLog).values(**_audit_row()))

    count = await conn.scalar(sa.select(sa.func.count()).select_from(AuditLog))
    assert count == 1


async def test_supprimer_un_acteur_du_journal_est_refuse(conn: AsyncConnection) -> None:
    """Le journal ne peut pas être vidé de biais, par une suppression ailleurs.

    `SET NULL` était impossible : ce serait un UPDATE sur une table immuable.
    """
    user_id = await new_user(conn, role=UserRole.ADMIN)
    await conn.execute(sa.insert(AuditLog).values(**_audit_row(), actor_user_id=user_id))

    await assert_rejected(
        conn,
        sa.delete(User).where(User.id == user_id),
        constraint="fk_audit_log_actor_user_id_app_user",
    )


# --------------------------------------------------------------------------
# politique de suppression
# --------------------------------------------------------------------------


async def test_un_createur_avec_reservation_ne_peut_pas_etre_supprime(
    conn: AsyncConnection,
) -> None:
    """La suppression de compte est une anonymisation, pas un DELETE."""
    graph = await new_booking_graph(conn)
    await conn.execute(booking_insert(graph))

    await assert_rejected(
        conn,
        sa.delete(User).where(User.id == graph["creator_id"]),
        constraint="fk_booking_creator_id_creator_profile",
    )
