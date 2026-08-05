"""Invariants de schéma.

Ces tests ne portent pas sur une ligne de données mais sur la forme du schéma
lui-même. Ils empêchent une régression silencieuse : une contrainte anonyme, un
identifiant tronqué, un montant en flottant, une date sans fuseau, ou un écart
entre les modèles et la migration.
"""

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.schema import make_include_object
from app.models import Base
from app.models.base import POSTGRES_IDENTIFIER_MAX_LENGTH

CONVENTION_PREFIXES = ("pk_", "uq_", "ck_", "fk_", "ix_")

# Seules tables autorisées à porter une devise : le commerce, et le plan
# d'abonnement qui est au niveau plateforme. Un montant ailleurs est libellé
# dans la devise de son commerce.
TABLES_WITH_CURRENCY = {"business", "subscription_plan"}


async def test_toutes_les_contraintes_suivent_la_convention(conn: AsyncConnection) -> None:
    rows = (
        await conn.execute(
            sa.text("""
                SELECT t.relname AS table_name, c.conname AS name
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = 'public'
                  AND t.relname NOT IN ('spatial_ref_sys', 'alembic_version')
            """)
        )
    ).all()

    assert rows, "aucune contrainte trouvée, le schéma n'est pas migré"
    hors_convention = [
        f"{r.table_name}.{r.name}" for r in rows if not r.name.startswith(CONVENTION_PREFIXES)
    ]
    assert hors_convention == []


async def test_aucun_identifiant_ne_depasse_la_limite_postgres(conn: AsyncConnection) -> None:
    """Postgres tronque à 63 caractères, en silence. Un nom tronqué n'est plus pilotable."""
    rows = (
        await conn.execute(
            sa.text("""
                SELECT conname AS name FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = 'public' AND t.relname <> 'spatial_ref_sys'
                UNION ALL
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'
            """)
        )
    ).all()

    trop_longs = [r.name for r in rows if len(r.name) >= POSTGRES_IDENTIFIER_MAX_LENGTH]
    assert trop_longs == []


async def test_la_migration_correspond_aux_modeles(conn: AsyncConnection) -> None:
    """Aucune dérive : le schéma migré est exactement celui décrit par les modèles."""

    def _diff(sync_connection):
        context = MigrationContext.configure(
            sync_connection,
            opts={"compare_type": True, "include_object": make_include_object(Base.metadata)},
        )
        return compare_metadata(context, Base.metadata)

    differences = await conn.run_sync(_diff)

    assert differences == [], f"écart entre modèles et base : {differences}"


def test_toutes_les_dates_portent_un_fuseau() -> None:
    """SPEC.md §7 : tout est stocké en UTC. Un timestamp nu ment sur son fuseau."""
    sans_fuseau = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, sa.DateTime) and not column.type.timezone
    ]
    assert sans_fuseau == []


def test_les_montants_sont_des_entiers_64_bits() -> None:
    """Montants en centimes, jamais de flottant ni de Numeric."""
    mauvais_type = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if column.name.endswith("_cents") and not isinstance(column.type, sa.BigInteger)
    ]
    assert mauvais_type == []

    flottants = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, sa.Float)
    ]
    assert flottants == []


def test_la_devise_n_est_portee_qu_aux_deux_endroits_prevus() -> None:
    """Une devise par table de montant ouvrirait la porte aux incohérences."""
    porteurs = {
        table.name
        for table in Base.metadata.tables.values()
        for column in table.columns
        if column.name == "currency"
    }
    assert porteurs == TABLES_WITH_CURRENCY


def test_aucun_type_enum_natif_postgres() -> None:
    """Altérer un enum natif en migration est un piège dont on se passe."""
    natifs = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, sa.Enum) and column.type.native_enum
    ]
    assert natifs == []


def test_aucun_solde_en_devise_appartenant_a_un_createur() -> None:
    """Contrainte structurante de SPEC.md §1, vérifiée sur la forme du schéma."""
    interdits = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if table.name in {"creator_profile", "app_user"} and column.name.endswith("_cents")
    ]
    assert interdits == []
