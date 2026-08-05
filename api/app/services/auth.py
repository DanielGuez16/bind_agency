"""Logique d'authentification.

Les routes ne font que valider une entrée, appeler ce module et traduire ses
erreurs en codes HTTP. Aucune règle d'accès n'est écrite ailleurs.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import (
    InvalidToken,
    TokenType,
    create_token,
    decode_token,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.models import RefreshToken, User
from app.models.enums import Locale, UserRole, UserStatus


class AuthError(Exception):
    """Base des erreurs d'authentification."""


class EmailAlreadyUsed(AuthError):
    pass


class InvalidCredentials(AuthError):
    pass


class AccountNotActive(AuthError):
    pass


class InvalidRefreshToken(AuthError):
    pass


@dataclass(frozen=True, slots=True)
class IssuedTokens:
    access_token: str
    refresh_token: str
    expires_in: int


def normalize_email(email: str) -> str:
    """L'unicité en base est posée sur `lower(email)` : on stocke ce qu'on compare."""
    return email.strip().lower()


async def register(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    role: UserRole,
    locale: Locale = Locale.EN,
) -> User:
    user = User(
        email=normalize_email(email),
        password_hash=hash_password(password),
        role=role,
        locale=locale,
        status=UserStatus.ACTIVE,
    )
    session.add(user)

    try:
        await session.flush()
    except IntegrityError as error:
        await session.rollback()
        # L'unicité est vérifiée par la base, pas par un SELECT préalable :
        # deux inscriptions simultanées passeraient à travers une pré-vérification.
        raise EmailAlreadyUsed(email) from error

    return user


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    statement = sa.select(User).where(sa.func.lower(User.email) == normalize_email(email))
    return await session.scalar(statement)


async def authenticate(session: AsyncSession, *, email: str, password: str) -> User:
    user = await get_user_by_email(session, email)

    # Le hachage est effectué même sans compte correspondant : sinon le temps de
    # réponse dit si l'adresse existe. Le résultat est calculé avant le test,
    # pour que les deux branches coûtent la même chose.
    password_matches = verify_password(password, user.password_hash if user else None)

    # Test explicite sur `user`, et non un `assert` s'appuyant sur le fait que
    # `verify_password` renvoie faux quand l'empreinte est absente : un `assert`
    # disparaît sous `python -O`, et transformerait un refus d'authentification
    # en erreur 500 le jour où cette fonction changerait.
    if user is None or not password_matches:
        raise InvalidCredentials(email)

    if user.status is not UserStatus.ACTIVE:
        raise AccountNotActive(user.status)

    if needs_rehash(user.password_hash or ""):
        user.password_hash = hash_password(password)

    user.last_login_at = datetime.now(UTC)
    return user


async def issue_tokens(session: AsyncSession, user: User) -> IssuedTokens:
    settings = get_settings()
    now = datetime.now(UTC)
    refresh_lifetime = timedelta(seconds=settings.refresh_token_ttl_seconds)
    access_lifetime = timedelta(seconds=settings.access_token_ttl_seconds)

    # La ligne est créée d'abord : son identifiant sert de `jti` au jeton signé.
    refresh_row = RefreshToken(user_id=user.id, expires_at=now + refresh_lifetime)
    session.add(refresh_row)
    await session.flush()

    return IssuedTokens(
        access_token=create_token(
            subject=user.id,
            token_type=TokenType.ACCESS,
            token_id=uuid.uuid4(),
            lifetime=access_lifetime,
            issued_at=now,
        ),
        refresh_token=create_token(
            subject=user.id,
            token_type=TokenType.REFRESH,
            token_id=refresh_row.id,
            lifetime=refresh_lifetime,
            issued_at=now,
        ),
        expires_in=settings.access_token_ttl_seconds,
    )


async def _load_active_refresh_row(session: AsyncSession, raw_token: str) -> RefreshToken:
    try:
        claims = decode_token(raw_token, expected_type=TokenType.REFRESH)
    except InvalidToken as error:
        raise InvalidRefreshToken(str(error)) from error

    row = await session.get(RefreshToken, claims.token_id)

    # Liste d'autorisation : l'absence de ligne vaut refus. Une signature valide
    # ne suffit pas, c'est tout l'intérêt d'un jeton révocable.
    if row is None or row.user_id != claims.subject:
        raise InvalidRefreshToken("jeton inconnu")

    if row.revoked_at is not None:
        # Rejeu d'un jeton déjà consommé ou révoqué : la session entière est
        # suspecte, on coupe toutes celles du compte.
        await revoke_all_for_user(session, row.user_id)
        raise InvalidRefreshToken("jeton révoqué")

    if row.expires_at <= datetime.now(UTC):
        raise InvalidRefreshToken("jeton expiré")

    return row


async def rotate(session: AsyncSession, raw_token: str) -> IssuedTokens:
    row = await _load_active_refresh_row(session, raw_token)

    user = await session.get(User, row.user_id)
    if user is None or user.status is not UserStatus.ACTIVE:
        raise InvalidRefreshToken("compte inactif")

    row.revoked_at = datetime.now(UTC)
    await session.flush()

    return await issue_tokens(session, user)


async def revoke(session: AsyncSession, raw_token: str) -> None:
    row = await _load_active_refresh_row(session, raw_token)
    row.revoked_at = datetime.now(UTC)
    await session.flush()


async def revoke_all_for_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        sa.update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await session.flush()
