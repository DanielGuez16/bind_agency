"""Catalogue des messages émis par le serveur lui-même.

À ne pas confondre avec les codes d'erreur de `app/core/errors.py` : ceux-là
partent vers l'application, qui les traduit. Ce catalogue-ci sert à ce que le
serveur émet directement, sans passer par l'app — aujourd'hui rien en
production, demain les emails transactionnels de la phase 7.

La structure est posée maintenant, avec un seul message de démonstration. La
langue est celle du destinataire, lue sur `app_user.locale`.
"""

import json
from functools import lru_cache
from pathlib import Path

from app.models.enums import Locale
from app.models.identity import User

LOCALES_DIR = Path(__file__).resolve().parent.parent / "locales"
DEFAULT_LOCALE = Locale.EN


@lru_cache
def _catalogues() -> dict[Locale, dict[str, str]]:
    return {
        locale: json.loads((LOCALES_DIR / f"{locale.value}.json").read_text(encoding="utf-8"))
        for locale in Locale
    }


def available_keys() -> set[str]:
    return set(_catalogues()[DEFAULT_LOCALE])


def translate(key: str, locale: Locale = DEFAULT_LOCALE, **params: object) -> str:
    """Rend un message dans la langue demandée, avec repli sur l'anglais.

    Le repli existe pour ne jamais renvoyer une chaîne vide en production, mais
    il ne devrait jamais servir : un test vérifie que les deux catalogues ont
    exactement le même jeu de clés.
    """
    catalogues = _catalogues()
    template = catalogues.get(locale, {}).get(key) or catalogues[DEFAULT_LOCALE].get(key)

    if template is None:
        raise KeyError(f"message inconnu du catalogue : {key}")

    return template.format(**params) if params else template


def translate_for(user: User, key: str, **params: object) -> str:
    """Traduit dans la langue du destinataire, jamais dans celle de l'appelant."""
    return translate(key, locale=user.locale, **params)
