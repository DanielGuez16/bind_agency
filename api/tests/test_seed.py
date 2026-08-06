"""Jeu de données de départ.

La commande est lancée pour de vrai, dans un sous-processus, contre une base
jetable qui n'est pas celle de la suite : elle efface tout avant d'écrire, la
faire tourner sur la base de test emporterait le schéma sous les autres tests.

Ce qu'on vérifie surtout, c'est que le jeu obtenu satisfait les invariants sans
exception ni contournement — c'est leur premier vrai test à l'échelle.
"""

import os
import subprocess
import sys
import uuid

import psycopg
import pytest
import sqlalchemy as sa
from psycopg import sql
from sqlalchemy import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import API_ROOT, get_settings
from app.models import (
    AuditLog,
    Business,
    BusinessMember,
    CapacityException,
    CapacityRule,
    CatalogItem,
    CreatorProfile,
    User,
)
from app.models.enums import BusinessMemberRole, BusinessStatus, UserRole
from app.seed import MOT_DE_PASSE, SeedRefused
from tests.conftest import _maintenance_dsn


@pytest.fixture(scope="module")
def base_jetable(test_database_url: str) -> str:
    """Une base à part, créée et détruite ici. Surtout pas celle de la suite."""
    url = make_url(test_database_url).set(database="bind_seed_probe")
    dsn = _maintenance_dsn(url)
    drop = sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(url.database))

    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute(drop)
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(url.database)))

    yield url.render_as_string(hide_password=False)

    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute(drop)


def _lancer(database_url: str, *, environnement: str = "test") -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "app.seed"],
        cwd=API_ROOT,
        env={
            **os.environ,
            "DATABASE_URL": database_url,
            "ENVIRONMENT": environnement,
            "JWT_SECRET_KEY": get_settings().jwt_secret_key.get_secret_value(),
        },
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.fixture(scope="module")
def jeu_pose(base_jetable: str) -> str:
    """La commande est lancée deux fois : la seconde prouve qu'elle est rejouable."""
    premier = _lancer(base_jetable)
    assert premier.returncode == 0, premier.stderr

    second = _lancer(base_jetable)
    assert second.returncode == 0, second.stderr

    return base_jetable


@pytest.fixture
async def seed_conn(jeu_pose: str) -> AsyncConnection:
    engine = create_async_engine(jeu_pose, poolclass=NullPool)
    async with engine.connect() as connection:
        yield connection
    await engine.dispose()


# --------------------------------------------------------------------------
# la commande
# --------------------------------------------------------------------------


def test_la_commande_refuse_hors_environnement_jetable(base_jetable: str) -> None:
    """Elle efface la base avant d'écrire : ailleurs qu'en local, elle ne tourne pas."""
    resultat = _lancer(base_jetable, environnement="production")

    assert resultat.returncode != 0
    assert "production" in resultat.stderr
    assert SeedRefused.__name__ in resultat.stderr


def test_la_commande_est_rejouable(jeu_pose: str) -> None:
    """Le double passage de la fixture suffit : elle repart d'une base propre."""
    assert jeu_pose


def test_elle_annonce_ce_qu_elle_a_pose(base_jetable: str) -> None:
    resultat = _lancer(base_jetable)

    assert "3 commerces" in resultat.stdout
    assert MOT_DE_PASSE in resultat.stdout


# --------------------------------------------------------------------------
# ce que le jeu contient
# --------------------------------------------------------------------------


async def test_trois_commerces_actifs_et_geolocalises(seed_conn: AsyncConnection) -> None:
    lignes = (
        await seed_conn.execute(
            sa.select(Business.name, Business.status, Business.currency, Business.timezone)
            .where(Business.geo.is_not(None))
            .order_by(Business.name)
        )
    ).all()

    assert len(lignes) == 3
    for ligne in lignes:
        assert ligne.status == BusinessStatus.ACTIVE
        assert ligne.currency == "USD"
        assert ligne.timezone == "America/New_York"


async def test_chaque_commerce_a_son_owner(seed_conn: AsyncConnection) -> None:
    lignes = (
        await seed_conn.execute(sa.select(BusinessMember.business_id, BusinessMember.role))
    ).all()

    assert len(lignes) == 3
    assert {ligne.role for ligne in lignes} == {BusinessMemberRole.OWNER}


async def test_les_trois_commerces_different_sur_ce_qui_compte(
    seed_conn: AsyncConnection,
) -> None:
    """Un jeu uniforme ne révélerait rien en phase 5."""
    avec_variantes = await seed_conn.scalar(
        sa.select(sa.func.count(sa.distinct(CatalogItem.business_id))).where(
            CatalogItem.parent_item_id.is_not(None)
        )
    )
    assert avec_variantes == 1

    sans_reservation = await seed_conn.scalar(
        sa.select(sa.func.count(sa.distinct(CatalogItem.business_id))).where(
            CatalogItem.requires_booking.is_(False), CatalogItem.parent_item_id.is_(None)
        )
    )
    assert sans_reservation >= 1

    postes_max = await seed_conn.scalar(sa.select(sa.func.max(CapacityRule.concurrent_slots)))
    assert postes_max > 1

    avec_exception = await seed_conn.scalar(
        sa.select(sa.func.count(sa.distinct(CapacityException.business_id)))
    )
    assert avec_exception == 1


async def test_une_journee_est_coupee_a_midi(seed_conn: AsyncConnection) -> None:
    par_jour = (
        await seed_conn.execute(
            sa.select(CapacityRule.business_id, CapacityRule.weekday, sa.func.count())
            .group_by(CapacityRule.business_id, CapacityRule.weekday)
            .having(sa.func.count() > 1)
        )
    ).all()

    assert par_jour, "aucun commerce n'a de journée en deux plages"


async def test_une_fermeture_et_une_journee_amenagee(seed_conn: AsyncConnection) -> None:
    exceptions = (
        await seed_conn.execute(
            sa.select(
                CapacityException.is_closed,
                CapacityException.start_time,
                CapacityException.concurrent_slots,
            ).order_by(CapacityException.date)
        )
    ).all()

    assert len(exceptions) == 2
    amenagee, fermeture = exceptions
    assert fermeture.is_closed is True
    assert (fermeture.start_time, fermeture.concurrent_slots) == (None, None)
    assert amenagee.is_closed is False
    assert amenagee.start_time is not None
    assert amenagee.concurrent_slots is not None


async def test_un_createur_sans_historique_pour_le_cold_start(
    seed_conn: AsyncConnection,
) -> None:
    """`reliability_score` nul veut dire neutre, pas zéro."""
    sans_historique = (
        await seed_conn.execute(
            sa.select(CreatorProfile.completed_collabs_count, CreatorProfile.is_new_creator).where(
                CreatorProfile.reliability_score.is_(None)
            )
        )
    ).all()

    assert len(sans_historique) == 1
    assert sans_historique[0].completed_collabs_count == 0
    assert sans_historique[0].is_new_creator is True

    avec_historique = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(CreatorProfile)
        .where(CreatorProfile.reliability_score.is_not(None))
    )
    assert avec_historique >= 1


async def test_un_compte_administrateur_existe(seed_conn: AsyncConnection) -> None:
    combien = await seed_conn.scalar(
        sa.select(sa.func.count()).select_from(User).where(User.role == UserRole.ADMIN)
    )
    assert combien == 1


async def test_les_transitions_sont_journalisees(seed_conn: AsyncConnection) -> None:
    """Le jeu passe par les services : il produit les mêmes traces que l'API."""
    par_entite = dict(
        (
            await seed_conn.execute(
                sa.select(AuditLog.entity_type, sa.func.count()).group_by(AuditLog.entity_type)
            )
        ).all()
    )

    # Trois créations plus trois activations.
    assert par_entite["business"] == 6
    # Un administrateur, trois propriétaires, trois créateurs.
    assert par_entite["app_user"] == 7


# --------------------------------------------------------------------------
# les invariants tiennent sur le jeu obtenu
# --------------------------------------------------------------------------


async def test_aucun_parent_n_est_reservable(seed_conn: AsyncConnection) -> None:
    reservables = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(
            CatalogItem.requires_booking.is_(True),
            CatalogItem.id.in_(
                sa.select(CatalogItem.parent_item_id).where(CatalogItem.parent_item_id.is_not(None))
            ),
        )
    )
    assert reservables == 0


async def test_aucune_variante_de_variante(seed_conn: AsyncConnection) -> None:
    petits_enfants = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(
            CatalogItem.parent_item_id.in_(
                sa.select(CatalogItem.id).where(CatalogItem.parent_item_id.is_not(None))
            )
        )
    )
    assert petits_enfants == 0


async def test_aucune_plage_ne_se_chevauche(seed_conn: AsyncConnection) -> None:
    """La contrainte d'exclusion l'aurait refusé, ce test le dit à l'endroit du jeu."""
    gauche = sa.orm.aliased(CapacityRule)
    droite = sa.orm.aliased(CapacityRule)

    chevauchements = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(gauche)
        .join(
            droite,
            sa.and_(
                gauche.business_id == droite.business_id,
                gauche.weekday == droite.weekday,
                gauche.id != droite.id,
                gauche.start_time < droite.end_time,
                gauche.end_time > droite.start_time,
            ),
        )
    )
    assert chevauchements == 0


async def test_toute_duree_suit_la_reservabilite(seed_conn: AsyncConnection) -> None:
    incoherents = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(CatalogItem)
        .where(CatalogItem.requires_booking != CatalogItem.duration_minutes.is_not(None))
    )
    assert incoherents == 0


async def test_tous_les_comptes_peuvent_se_connecter(seed_conn: AsyncConnection) -> None:
    sans_empreinte = await seed_conn.scalar(
        sa.select(sa.func.count())
        .select_from(User)
        .where(User.password_hash.is_(None), User.email.is_not(None))
    )
    assert sans_empreinte == 0


async def test_aucun_identifiant_n_est_devinable(seed_conn: AsyncConnection) -> None:
    """Rien de séquentiel : les identifiants circulent dans des URL."""
    identifiants = list(await seed_conn.scalars(sa.select(Business.id)))

    assert len(identifiants) == 3
    for identifiant in identifiants:
        assert isinstance(identifiant, uuid.UUID)
        assert identifiant.version == 4
