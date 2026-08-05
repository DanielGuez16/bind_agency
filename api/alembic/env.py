import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from app.core.config import get_settings
from app.core.schema import APPLICATION_SCHEMA, make_include_object
from app.models import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# L'URL vient de la configuration applicative, jamais de alembic.ini : une seule
# source de vérité, et aucun identifiant de connexion commité.
# `config.attributes["db_url"]` est le point d'entrée programmatique : la suite
# de tests s'en sert pour viser sa propre base sans toucher à l'environnement.
config.set_main_option(
    "sqlalchemy.url",
    config.attributes.get("db_url") or str(get_settings().database_url),
)

# Tout modèle doit être importé par `app.models` pour être vu à l'autogénération.
target_metadata = Base.metadata

include_object = make_include_object(target_metadata)

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        # Le search_path est posé à l'établissement de la connexion, et surtout
        # pas par un SET après coup : un SET ouvre une transaction implicite,
        # Alembic considère alors qu'il ne gère pas la transaction, ne committe
        # jamais, et la migration est annulée en silence avec un code de sortie
        # nul. Cadrer sur `public` évite aussi de réfléchir les schémas `tiger`
        # et `topology` que l'image postgis ajoute au search_path.
        connect_args={"options": f"-csearch_path={APPLICATION_SCHEMA}"},
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
