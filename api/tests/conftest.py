"""Fixtures de test.

La session pytest crée sa propre base, y applique les migrations, et la détruit
à la fin. Elle refuse de démarrer sans `TEST_DATABASE_URL`, et refuse de tourner
sur la base de développement : aucune commande de test ne doit pouvoir effacer
des données de travail.

Le schéma est posé par `alembic upgrade head`, jamais par `create_all` : c'est
la migration réelle qui est testée, pas les modèles.
"""

from collections.abc import AsyncIterator, Iterator

import psycopg
import pytest
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from psycopg import sql
from sqlalchemy import URL, make_url
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from alembic import command
from app.core.config import API_ROOT, get_settings
from app.core.db import get_engine, get_session
from app.main import create_app
from tests.protected_routes import router as probe_router


def _maintenance_dsn(url: URL) -> str:
    """DSN synchrone vers `postgres` : on ne peut pas créer une base depuis elle-même."""
    return url.set(drivername="postgresql", database="postgres").render_as_string(
        hide_password=False
    )


def _alembic_config(database_url: str) -> Config:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    config.attributes["db_url"] = database_url
    return config


@pytest.fixture(scope="session")
def test_database_url() -> str:
    settings = get_settings()

    if settings.test_database_url is None:
        pytest.exit(
            "TEST_DATABASE_URL absente. Refus de lancer les tests sur la base de "
            "développement — voir api/.env.example.",
            returncode=1,
        )

    development = make_url(str(settings.database_url))
    test = make_url(str(settings.test_database_url))
    if (development.host, development.port, development.database) == (
        test.host,
        test.port,
        test.database,
    ):
        pytest.exit("TEST_DATABASE_URL désigne la base de développement.", returncode=1)

    return str(settings.test_database_url)


@pytest.fixture(scope="session", autouse=True)
def _managed_test_database(test_database_url: str) -> Iterator[None]:
    url = make_url(test_database_url)
    dsn = _maintenance_dsn(url)
    name = url.database
    drop = sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))

    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute(drop)
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))

    # Aller-retour complet avant le premier test : si le downgrade est cassé,
    # toute la suite tombe immédiatement plutôt qu'au moment du déploiement.
    config = _alembic_config(test_database_url)
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")

    yield

    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute(drop)


@pytest.fixture
async def engine(test_database_url: str) -> AsyncIterator[AsyncEngine]:
    """NullPool : pas de connexion résiduelle qui empêcherait le DROP DATABASE final."""
    test_engine = create_async_engine(test_database_url, poolclass=NullPool)
    yield test_engine
    await test_engine.dispose()


@pytest.fixture
async def conn(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    """Connexion dans une transaction annulée en fin de test : aucune fuite entre tests."""
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()


@pytest.fixture
async def client(engine: AsyncEngine, conn: AsyncConnection) -> AsyncIterator[AsyncClient]:
    """Client HTTP dont les sessions partagent la transaction du test.

    `join_transaction_mode="create_savepoint"` fait qu'un `commit()` dans une
    route relâche un point de sauvegarde au lieu de valider : les écritures de
    l'API sont visibles du test, et tout disparaît à la fin. Les routes de
    sonde ne sont montées qu'ici, jamais dans l'application réelle.
    """
    session_factory = async_sessionmaker(
        bind=conn,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    application = create_app()
    application.include_router(probe_router, prefix=get_settings().api_v1_prefix)
    application.dependency_overrides[get_engine] = lambda: engine
    application.dependency_overrides[get_session] = override_get_session

    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client
