"""Configuration de l'API.

Règle dure (CLAUDE.md) : aucune valeur de repli sur un secret. L'absence d'une
variable d'environnement est une erreur de démarrage, jamais un défaut silencieux.
Aucun seuil de palier, aucun prix, aucun délai métier ne vit ici en dur non plus.
"""

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import BeforeValidator, PostgresDsn
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Ancré sur `api/` et non sur le répertoire courant : le `.env` doit être trouvé
# quel que soit l'endroit d'où l'on lance uvicorn, pytest ou alembic.
API_ROOT = Path(__file__).resolve().parents[2]


def _split_csv(value: object) -> object:
    """Accepte `a,b` dans le `.env` plutôt que d'imposer un tableau JSON."""
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


# `NoDecode` désactive le json.loads que pydantic-settings applique d'office aux
# champs complexes lus depuis un `.env`, sinon il échoue avant tout validateur.
CommaSeparated = Annotated[list[str], NoDecode, BeforeValidator(_split_csv)]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=API_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: str = "local"
    api_v1_prefix: str = "/api/v1"
    cors_origins: CommaSeparated = ["http://localhost:8081", "http://localhost:19006"]

    # Sans valeur par défaut : porte un secret et désigne une base réelle.
    database_url: PostgresDsn

    # Lue uniquement par la session pytest, jamais par l'application.
    # Sa présence est vérifiée dans tests/conftest.py, qui refuse de tourner sans.
    test_database_url: PostgresDsn | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
