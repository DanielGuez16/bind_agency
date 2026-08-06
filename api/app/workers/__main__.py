"""Commande du travail planifié.

    python -m app.workers plan     # aligne la file sur l'état des comptes
    python -m app.workers run      # exécute ce qui est dû

Deux verbes séparés, et c'est délibéré : aligner la file est sûr et se relance
sans conséquence, exécuter parle au réseau. Les fondre en une seule commande
ferait qu'on hésiterait à lancer la première.
"""

import asyncio
import sys

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import ConfigurationError, get_settings
from app.integrations.instagram import InstagramProvider
from app.integrations.social import SocialProvider
from app.models.enums import Platform
from app.workers import runner, scheduler

USAGE = "usage : python -m app.workers [plan|run]"


def _fournisseurs(client: httpx.AsyncClient):
    """Un fournisseur par plateforme, construit à la demande.

    Une plateforme non configurée lève à la construction plutôt que d'échouer
    plus loin, chez elle, avec un message à elle. Le job concerné sera reporté
    comme n'importe quel échec, ce qui est le bon comportement : la
    configuration peut arriver entre deux passages.
    """

    def pour(platform: Platform) -> SocialProvider:
        if platform is Platform.INSTAGRAM:
            return InstagramProvider(client)
        raise ConfigurationError(f"aucun fournisseur pour {platform.value}")

    return pour


async def _plan() -> str:
    engine = create_async_engine(str(get_settings().database_url))
    try:
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as session, session.begin():
            bilan = await scheduler.planifier_le_travail(session)
        return f"{bilan['crees']} job(s) créé(s), {bilan['retires']} retiré(s)."
    finally:
        await engine.dispose()


async def _run() -> str:
    engine = create_async_engine(str(get_settings().database_url))
    try:
        async with httpx.AsyncClient() as client:
            bilan = await runner.executer(
                async_sessionmaker(engine, expire_on_commit=False),
                fournisseur_pour=_fournisseurs(client),
            )
        return (
            f"{bilan.reussis} réussi(s), {bilan.reportes} reporté(s), "
            f"{bilan.epuises} épuisé(s), {bilan.retires} retiré(s)."
        )
    finally:
        await engine.dispose()


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in ("plan", "run"):
        print(USAGE, file=sys.stderr)
        return 2

    print(asyncio.run(_plan() if argv[1] == "plan" else _run()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
