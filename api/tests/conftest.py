"""Fixtures de test.

La session pytest crée sa propre base et la détruit à la fin. Elle refuse de
démarrer sans `TEST_DATABASE_URL`, et refuse de tourner sur la base de
développement : aucune commande de test ne doit pouvoir effacer des données de
travail.
"""

from collections.abc import AsyncIterator, Iterator

import psycopg
import pytest
from httpx import ASGITransport, AsyncClient
from psycopg import sql
from sqlalchemy import URL, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.core.db import get_engine
from app.main import create_app


def _maintenance_dsn(url: URL) -> str:
    """DSN synchrone vers `postgres` : on ne peut pas créer une base depuis elle-même."""
    return url.set(drivername="postgresql", database="postgres").render_as_string(
        hide_password=False
    )


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
async def client(engine: AsyncEngine) -> AsyncIterator[AsyncClient]:
    application = create_app()
    application.dependency_overrides[get_engine] = lambda: engine
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client
