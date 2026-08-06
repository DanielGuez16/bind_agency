"""Types de colonnes maison."""

from typing import Any

import sqlalchemy as sa
from sqlalchemy.types import TypeDecorator

from app.core.encryption import decrypt, encrypt


class EncryptedText(TypeDecorator):
    """Texte chiffré au repos, de façon invisible pour l'appelant.

    Le chiffrement est porté par le **type de la colonne**, pas par un appel que
    le service devrait penser à faire. C'est la différence entre « on chiffre les
    jetons » et « on ne peut pas écrire un jeton en clair » : le second se tient
    sans discipline, et un nouveau chemin d'écriture en hérite gratuitement.

    Côté Python la valeur est une chaîne, côté base un `bytea`. Aucun code
    métier ne voit passer un binaire ni ne connaît la clé.
    """

    impl = sa.LargeBinary
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Any) -> bytes | None:
        return None if value is None else encrypt(value)

    def process_result_value(self, value: bytes | None, dialect: Any) -> str | None:
        return None if value is None else decrypt(bytes(value))
