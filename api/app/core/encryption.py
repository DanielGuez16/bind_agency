"""Chiffrement des jetons au repos.

Le chiffrement se fait dans l'application, pas en base : la base ne doit jamais
avoir vu la clé. Un dump, une réplique, une sauvegarde qui fuit ne donnent que
du binaire.

**Chaque valeur chiffrée porte l'identifiant de la clé qui l'a produite.** Sans
lui, changer de clé obligerait à tout redéchiffrer d'un coup, transaction
géante et fenêtre d'indisponibilité. Avec lui, on ajoute une clé, on la rend
active, et les anciennes valeurs restent lisibles jusqu'à ce qu'un travail de
fond les réécrive à son rythme.

Format du binaire stocké :

    [1 octet] longueur de l'identifiant de clé
    [n]       identifiant de clé, en ASCII
    [12]      nonce, tiré au hasard à chaque chiffrement
    [reste]   texte chiffré et authentifié (AES-GCM)

Pas de données associées : au moment du chiffrement d'un `INSERT`, la ligne
n'a pas encore d'identifiant à lier.
"""

import base64
import os
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import ConfigurationError, get_settings

NONCE_LENGTH = 12
KEY_LENGTH = 32


class DecryptionError(RuntimeError):
    """Binaire illisible : clé inconnue, format inattendu, ou altération."""


def _decode_key(material: str, *, origine: str) -> bytes:
    try:
        key = base64.urlsafe_b64decode(material)
    except Exception as error:  # noqa: BLE001 - toute erreur de décodage se vaut
        raise ConfigurationError(f"clé de chiffrement illisible : {origine}") from error

    if len(key) != KEY_LENGTH:
        raise ConfigurationError(
            f"clé de chiffrement de {len(key)} octets pour {origine}, {KEY_LENGTH} attendus"
        )
    return key


@lru_cache
def _keyring() -> dict[str, bytes]:
    """Toutes les clés utilisables en déchiffrement, l'active comprise."""
    settings = get_settings()

    trousseau = {
        settings.token_encryption_key_id: _decode_key(
            settings.token_encryption_key.get_secret_value(),
            origine="TOKEN_ENCRYPTION_KEY",
        )
    }

    for entree in settings.token_encryption_previous_keys:
        identifiant, _, material = entree.partition(":")
        if not identifiant or not material:
            raise ConfigurationError(
                "TOKEN_ENCRYPTION_PREVIOUS_KEYS attend des entrées « identifiant:clé »"
            )
        trousseau[identifiant] = _decode_key(material, origine=f"clé précédente {identifiant}")

    return trousseau


def generate_key() -> str:
    """Clé prête à coller dans un `.env`. Sert aussi aux tests et à la CI."""
    return base64.urlsafe_b64encode(AESGCM.generate_key(bit_length=256)).decode()


def encrypt(clear: str) -> bytes:
    settings = get_settings()
    identifiant = settings.token_encryption_key_id
    key = _keyring()[identifiant]

    nonce = os.urandom(NONCE_LENGTH)
    chiffre = AESGCM(key).encrypt(nonce, clear.encode(), None)

    return bytes([len(identifiant)]) + identifiant.encode() + nonce + chiffre


def decrypt(blob: bytes) -> str:
    if not blob:
        raise DecryptionError("binaire vide")

    longueur = blob[0]
    identifiant = blob[1 : 1 + longueur].decode()
    nonce = blob[1 + longueur : 1 + longueur + NONCE_LENGTH]
    chiffre = blob[1 + longueur + NONCE_LENGTH :]

    key = _keyring().get(identifiant)
    if key is None:
        raise DecryptionError(
            f"aucune clé « {identifiant} » au trousseau — la clé précédente "
            "a-t-elle été retirée trop tôt ?"
        )

    try:
        return AESGCM(key).decrypt(nonce, chiffre, None).decode()
    except InvalidTag as error:
        raise DecryptionError("texte chiffré altéré ou clé incorrecte") from error
