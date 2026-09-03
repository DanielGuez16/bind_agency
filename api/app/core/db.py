"""Moteur et session SQLAlchemy asynchrones.

`get_engine` et `get_session` sont exposés comme dépendances FastAPI : c'est ce
qui permet de les surcharger en test sans toucher aux variables d'environnement.
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


#: Connexions maintenues ouvertes, prêtes sans les rouvrir.
#:
#: **Explicite plutôt que la valeur par défaut de SQLAlchemy (5).** Un lecteur
#: qui veut savoir la vraie limite ne devait, jusqu'ici, la trouver que dans le
#: code source de SQLAlchemy — rien ici ne la nommait. Dix suffit largement au
#: seul consommateur de ce moteur : le déploiement tourne un unique processus
#: `uvicorn` (`Dockerfile`, sans `--workers`), donc ce pool n'est jamais
#: partagé entre plusieurs travailleurs qui se le disputeraient.
POOL_SIZE = 10

#: Connexions supplémentaires, ouvertes puis refermées au-delà du pool.
#:
#: **Dix de plus, pas vingt.** Mesuré : cinquante requêtes simultanées sur les
#: trois routes les plus fréquentées passent sans attente sous les valeurs par
#: défaut (5 + 10 = 15) ; vingt au total donne une marge confortable pour une
#: démonstration sans viser large au hasard. La production passe par le
#: *session pooler* de Supabase (voir `DEMO.md`), pas une connexion directe —
#: rester modeste de ce côté évite d'aller cogner sur une limite qu'on ne
#: contrôle pas et dont l'échec est plus opaque qu'un dépassement de pool.
MAX_OVERFLOW = 10


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            str(get_settings().database_url),
            pool_pre_ping=True,
            pool_size=POOL_SIZE,
            max_overflow=MAX_OVERFLOW,
        )
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
