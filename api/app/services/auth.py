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
from app.models import CreatorProfile, RefreshToken, User
from app.models.enums import Locale, RefreshTokenState, UserRole, UserStatus
from app.services.audit import Actor, AuditedEntity, record_transition

# Motifs de transition, en dur ici et nulle part ailleurs : ils apparaissent
# tels quels dans le journal et doivent rester stables pour être cherchables.
REASON_ROTATION = "refresh_token_rotated"
REASON_LOGOUT = "user_logout"
REASON_REUSE_DETECTED = "refresh_token_reuse_detected"


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

    if role is UserRole.CREATOR:
        # Le profil créateur n'est pas une étape ultérieure : `social_account`
        # et `booking` référencent `creator_profile.user_id`, pas `app_user.id`.
        # Sans cette ligne, un créateur inscrit ne peut rattacher aucun compte
        # social et reste inéligible à tout, sans que rien ne le signale.
        session.add(CreatorProfile(user_id=user.id))
        await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.APP_USER,
        entity_id=user.id,
        from_status=None,
        to_status=user.status.value,
        actor=Actor.from_user(user),
    )

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

    await record_transition(
        session,
        entity=AuditedEntity.REFRESH_TOKEN,
        entity_id=refresh_row.id,
        from_status=None,
        to_status=RefreshTokenState.ISSUED.value,
        actor=Actor.from_user(user),
    )

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
        await revoke_all_for_user(
            session, row.user_id, actor=Actor.system(), reason=REASON_REUSE_DETECTED
        )
        raise InvalidRefreshToken("jeton révoqué")

    if row.expires_at <= datetime.now(UTC):
        raise InvalidRefreshToken("jeton expiré")

    return row


async def rotate(session: AsyncSession, raw_token: str) -> IssuedTokens:
    row = await _load_active_refresh_row(session, raw_token)

    user = await session.get(User, row.user_id)
    if user is None or user.status is not UserStatus.ACTIVE:
        raise InvalidRefreshToken("compte inactif")

    await _mark_revoked(session, row, actor=Actor.from_user(user), reason=REASON_ROTATION)

    return await issue_tokens(session, user)


async def revoke(session: AsyncSession, raw_token: str) -> None:
    row = await _load_active_refresh_row(session, raw_token)

    user = await session.get(User, row.user_id)
    actor = Actor.from_user(user) if user is not None else Actor.system()
    reason = REASON_LOGOUT if user is not None else "orphaned_refresh_token"

    await _mark_revoked(session, row, actor=actor, reason=reason)


async def revoke_all_for_user(
    session: AsyncSession, user_id: uuid.UUID, *, actor: Actor, reason: str
) -> None:
    """Révocation en masse de toutes les sessions d'un compte.

    L'acteur est passé par l'appelant : une détection de rejeu est une décision
    du système, une anonymisation est un droit exercé par quelqu'un.

    Le `RETURNING` sert le journal : une ligne par jeton coupé, plutôt qu'une
    seule ligne disant « des jetons ont été révoqués ».
    """
    revoked_ids = (
        await session.scalars(
            sa.update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
            .returning(RefreshToken.id)
            .execution_options(synchronize_session=False)
        )
    ).all()

    for token_id in revoked_ids:
        await record_transition(
            session,
            entity=AuditedEntity.REFRESH_TOKEN,
            entity_id=token_id,
            from_status=RefreshTokenState.ISSUED.value,
            to_status=RefreshTokenState.REVOKED.value,
            actor=actor,
            reason=reason,
        )

    await session.flush()


async def _mark_revoked(
    session: AsyncSession, row: RefreshToken, *, actor: Actor, reason: str
) -> None:
    row.revoked_at = datetime.now(UTC)
    await session.flush()

    await record_transition(
        session,
        entity=AuditedEntity.REFRESH_TOKEN,
        entity_id=row.id,
        from_status=RefreshTokenState.ISSUED.value,
        to_status=RefreshTokenState.REVOKED.value,
        actor=actor,
        reason=reason,
    )
