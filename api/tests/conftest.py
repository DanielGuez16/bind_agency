"""Fixtures de test.

La session pytest crée sa propre base, y applique les migrations, et la détruit
à la fin. Elle refuse de démarrer sans `TEST_DATABASE_URL`, et refuse de tourner
sur la base de développement : aucune commande de test ne doit pouvoir effacer
des données de travail.

Le schéma est posé par `alembic upgrade head`, jamais par `create_all` : c'est
la migration réelle qui est testée, pas les modèles.
"""

from collections.abc import AsyncIterator, Iterator

import httpx
import psycopg
import pytest
import sqlalchemy as sa
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


#: Tables qu'aucune migration ne peuple : à la fin d'un test, elles doivent être
#: vides. `tier`, `subscription_plan` et consorts en sont exclues, leurs lignes
#: de référence étant posées par les migrations et donc légitimement présentes.
#:
#: Le journal d'audit y figure : c'est souvent lui qui reste seul debout quand
#: une écriture a fui, parce qu'aucun test ne pense à le regarder.
TABLES_QUI_DOIVENT_RESTER_VIDES = (
    "app_user",
    "business",
    "catalog_item",
    "booking",
    "collaboration",
    "audit_log",
    "platform_asset",
)


def _compter_les_lignes(test_database_url: str) -> dict[str, int]:
    """Le nombre de lignes de chaque table surveillée, **hors** transaction de test.

    Synchrone, sur une connexion à elle : passer par un moteur de la suite la
    ferait participer à la transaction qu'on veut justement observer du dehors,
    et elle ne verrait jamais que ce que le test croit avoir écrit.
    """
    dsn = make_url(test_database_url).set(drivername="postgresql")
    requete = sa.union_all(
        *(
            sa.select(sa.literal(nom).label("table"), sa.func.count().label("lignes")).select_from(
                sa.table(nom)
            )
            for nom in TABLES_QUI_DOIVENT_RESTER_VIDES
        )
    )

    sql_texte = str(requete.compile(compile_kwargs={"literal_binds": True}))
    with psycopg.connect(dsn.render_as_string(hide_password=False), autocommit=True) as connexion:
        return dict(connexion.execute(sql_texte).fetchall())


@pytest.fixture(autouse=True)
def _aucune_ecriture_ne_survit(test_database_url: str, request: pytest.FixtureRequest) -> Iterator:
    """Aucun test ne laisse de ligne derrière lui. Vérifié après **chaque** test.

    La transaction du test est annulée par la fixture `conn`, et c'est ce qui
    isole les tests les uns des autres. Un `commit()` mal placé la valide
    pourtant pour de bon : les écritures survivent, les tests suivants en
    héritent, et la suite devient non déterministe — un passage donne douze
    échecs, le suivant quarante, et chaque fichier passe seul. On cherche alors
    quatorze défauts là où il n'y en a qu'un, et on les cherche partout sauf là
    où ils sont.

    D'où cette garde. Elle ne corrige rien : elle **nomme** le test fautif, à
    l'instant où il fuit, au lieu de laisser le symptôme apparaître ailleurs.

    **Elle compare un avant et un après, jamais un absolu.** Un résidu laissé
    par un test antérieur ferait échouer tous les suivants, et le premier nom
    affiché serait le seul innocent du lot. La différence, elle, ne désigne que
    celui qui a écrit.

    Un test qui doit écrire pour de bon — il en existe un, celui du verrou
    consultatif, qui a besoin de deux transactions réellement concurrentes — le
    déclare avec `@pytest.mark.ecrit_pour_de_bon("raison")`. La dérogation est
    alors visible à la relecture, ce qu'un contournement silencieux ne serait
    pas.
    """
    derogation = request.node.get_closest_marker("ecrit_pour_de_bon")
    if derogation is not None:
        yield
        return

    avant = _compter_les_lignes(test_database_url)
    yield
    apres = _compter_les_lignes(test_database_url)

    fuites = {nom: apres[nom] - avant[nom] for nom in apres if apres[nom] > avant[nom]}

    assert not fuites, (
        f"des écritures ont survécu à la transaction du test : {fuites}. "
        "Un commit() dans un test valide la transaction que la fixture `conn` "
        "devait annuler ; utiliser flush() pour rendre une écriture visible "
        "sans la valider. Si l'écriture doit vraiment survivre, la déclarer "
        'avec @pytest.mark.ecrit_pour_de_bon("raison").'
    )


@pytest.fixture
async def engine(test_database_url: str) -> AsyncIterator[AsyncEngine]:
    """NullPool : pas de connexion résiduelle qui empêcherait le DROP DATABASE final."""
    test_engine = create_async_engine(test_database_url, poolclass=NullPool)
    yield test_engine
    await test_engine.dispose()


@pytest.fixture
async def conn(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    """Connexion dans une transaction annulée en fin de test : aucune fuite entre tests.

    En sortie, la connexion doit encore répondre. C'est le garde-fou universel
    contre la classe de défaut où un refus rend le code d'erreur attendu tout en
    laissant la transaction avortée : la requête fautive passe le test, et c'est
    la suivante qui tombe, ailleurs, sous une erreur qui ne dit rien.

    Il ne remplace pas la vérification explicite dans les tests de refus — il la
    rend seulement impossible à oublier.
    """
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
            await connection.execute(sa.text("SELECT 1"))
        finally:
            await transaction.rollback()


@pytest.fixture
async def session(conn: AsyncConnection) -> AsyncIterator[AsyncSession]:
    """Session ORM greffée sur la transaction du test.

    Permet d'appeler un service directement, et de vérifier ce qu'un `rollback`
    laisse — ou ne laisse pas — derrière lui.
    """
    factory = async_sessionmaker(
        bind=conn,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    async with factory() as orm_session:
        yield orm_session


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


@pytest.fixture
def instagram_configure(monkeypatch: pytest.MonkeyPatch):
    """Le fournisseur réel a besoin d'une application Meta déclarée."""
    from app.core import config as module_config
    from app.core import encryption
    from app.integrations import instagram as module_instagram

    reglages = module_config.build_settings(
        _env_file=None,
        database_url=str(get_settings().database_url),
        jwt_secret_key="peu-importe-ici-mais-assez-longue-pour-hmac",
        token_encryption_key=encryption.generate_key(),
        instagram_app_id="1234567890",
        instagram_app_secret="un-secret-meta",
        instagram_redirect_uri="https://api.bind.test/api/v1/social-accounts/instagram/callback",
    )
    monkeypatch.setattr(module_instagram, "get_settings", lambda: reglages)
    return reglages


@pytest.fixture
def transport_meta():
    """Fabrique de transports simulés, indexés par fragment d'URL.

    Les appels sont conservés : plusieurs tests portent sur ce qui a été
    *demandé* à Meta — les champs, le suffixe du code — autant que sur ce qui en
    revient.
    """

    def fabriquer(reponses: dict[str, httpx.Response]) -> httpx.MockTransport:
        appels: list[httpx.Request] = []

        def repondre(request: httpx.Request) -> httpx.Response:
            appels.append(request)
            for fragment, reponse in reponses.items():
                if fragment in str(request.url):
                    return reponse
            return httpx.Response(404, json={"error": "url inattendue"})

        transport = httpx.MockTransport(repondre)
        transport.appels = appels  # type: ignore[attr-defined]
        return transport

    return fabriquer
