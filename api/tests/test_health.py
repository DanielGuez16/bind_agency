"""La sonde doit dire la vérité sur ses dépendances, pas répondre 200 par principe."""

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.core.db import get_engine
from app.main import create_app

PREFIX = get_settings().api_v1_prefix


async def test_health_ok_when_database_answers(client: AsyncClient) -> None:
    response = await client.get(f"{PREFIX}/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["dependencies"]["database"] == "ok"
    assert body["failed"] == []


async def test_health_503_and_names_the_failing_dependency() -> None:
    unreachable = create_async_engine(
        "postgresql+psycopg://bind:bind@127.0.0.1:1/bind",
        poolclass=NullPool,
        connect_args={"connect_timeout": 1},
    )
    application = create_app()
    application.dependency_overrides[get_engine] = lambda: unreachable

    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"{PREFIX}/health")
    await unreachable.dispose()

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable"
    assert body["dependencies"]["database"] == "unavailable"
    assert body["failed"] == ["database"]


async def test_database_is_postgres_in_utc(engine: AsyncEngine) -> None:
    """SPEC.md §1 et §7 : jamais SQLite, et tout est stocké en UTC."""
    async with engine.connect() as connection:
        version = (await connection.execute(text("SELECT version()"))).scalar_one()
        timezone = (await connection.execute(text("SHOW timezone"))).scalar_one()

    assert "PostgreSQL" in version
    assert timezone == "UTC"
