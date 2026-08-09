"""Primitives de sécurité : empreintes de mots de passe et jetons signés.

Aucune règle métier ici. Ce module ne connaît ni la base, ni les rôles : il
signe, il vérifie, il hache.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

# argon2id avec les paramètres par défaut de la bibliothèque, qui suivent les
# recommandations courantes. Ce sont des paramètres de sécurité, pas de la
# configuration métier : ils n'ont rien à faire dans un fichier .env.
_hasher = PasswordHasher()


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"
    #: État d'un parcours OAuth. Court, signé, et lié à celui qui l'a démarré.
    OAUTH_STATE = "oauth_state"
    #: Droit de lire **une** preuve, pour quelques minutes.
    #:
    #: Une preuve n'est jamais publique : elle ne se sert ni par un lien direct
    #: vers le stockage, ni par une adresse devinable. Ce jeton porte l'identité
    #: de la preuve dans son `jti` et celle du demandeur dans son `sub`, il
    #: expire vite, et il ne donne accès qu'à cet objet-là.
    PROOF_READ = "proof_read"


class InvalidToken(Exception):
    """Signature invalide, jeton expiré, ou charge utile inexploitable."""


@dataclass(frozen=True, slots=True)
class TokenClaims:
    subject: uuid.UUID
    token_type: TokenType
    token_id: uuid.UUID
    expires_at: datetime


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """Renvoie faux plutôt que de lever : l'appelant ne doit pas distinguer les cas.

    Un mot de passe est tout de même haché quand l'empreinte est absente, pour
    que le temps de réponse ne révèle pas l'existence du compte.
    """
    if password_hash is None:
        _hasher.hash(password)
        return False

    try:
        _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def needs_rehash(password_hash: str) -> bool:
    """Vrai quand les paramètres argon2 ont durci depuis la création de l'empreinte."""
    return _hasher.check_needs_rehash(password_hash)


def create_token(
    *,
    subject: uuid.UUID,
    token_type: TokenType,
    token_id: uuid.UUID,
    lifetime: timedelta,
    issued_at: datetime | None = None,
) -> str:
    settings = get_settings()
    issued = issued_at or datetime.now(UTC)
    payload = {
        "sub": str(subject),
        "typ": token_type.value,
        "jti": str(token_id),
        "iat": int(issued.timestamp()),
        "exp": int((issued + lifetime).timestamp()),
    }
    return jwt.encode(
        payload, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm
    )


def decode_token(token: str, *, expected_type: TokenType) -> TokenClaims:
    settings = get_settings()

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "exp", "jti", "typ"]},
        )
    except jwt.PyJWTError as error:
        raise InvalidToken(str(error)) from error

    # Sans ce contrôle, un jeton de rafraîchissement serait accepté comme jeton
    # d'accès : durée longue sur une route protégée.
    if payload.get("typ") != expected_type.value:
        raise InvalidToken("type de jeton inattendu")

    try:
        subject = uuid.UUID(payload["sub"])
        token_id = uuid.UUID(payload["jti"])
    except (ValueError, TypeError) as error:
        raise InvalidToken("identifiants de jeton illisibles") from error

    return TokenClaims(
        subject=subject,
        token_type=expected_type,
        token_id=token_id,
        expires_at=datetime.fromtimestamp(payload["exp"], tz=UTC),
    )
