"""Dépendances d'accès.

Aucune vérification de droits ne doit être écrite en ligne dans un routeur :
tout passe par une de ces trois dépendances.

`current_user` répond 401 — l'appelant n'est pas identifié. `require_role` et
`require_business_member` répondent 403 — il est identifié, mais n'a pas le
droit. Un 404 masquerait un défaut d'autorisation en ressource absente.
"""

import uuid
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import sqlalchemy as sa
from fastapi import Depends, Path, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.errors import ErrorCode, api_error
from app.core.security import InvalidToken, TokenType, decode_token
from app.models import BusinessMember, User
from app.models.enums import UserRole, UserStatus

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# auto_error=False : c'est nous qui formulons le 401, avec l'en-tête WWW-Authenticate.
_bearer_scheme = HTTPBearer(auto_error=False)
CredentialsDep = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)]

_UNAUTHENTICATED = api_error(
    status.HTTP_401_UNAUTHORIZED,
    ErrorCode.AUTHENTICATION_REQUIRED,
    headers={"WWW-Authenticate": "Bearer"},
)


async def current_user(credentials: CredentialsDep, session: SessionDep) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHENTICATED

    try:
        claims = decode_token(credentials.credentials, expected_type=TokenType.ACCESS)
    except InvalidToken as error:
        raise _UNAUTHENTICATED from error

    user = await session.get(User, claims.subject)

    # Le statut est relu à chaque requête : un jeton émis avant une suspension
    # ne doit pas continuer à ouvrir des portes jusqu'à son expiration.
    if user is None or user.status is not UserStatus.ACTIVE:
        raise _UNAUTHENTICATED

    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_role(*roles: UserRole) -> Callable[..., Coroutine[Any, Any, User]]:
    """Exige l'un des rôles portés par `app_user`."""
    allowed = frozenset(roles)

    async def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE)
        return user

    return dependency


async def require_business_member(
    business_id: Annotated[uuid.UUID, Path()],
    user: CurrentUser,
    session: SessionDep,
) -> BusinessMember:
    """Exige l'appartenance au commerce désigné par le chemin.

    Le bon rôle ne suffit pas : sans ce second contrôle, un membre du commerce A
    lit les ressources du commerce B. C'est la fuite classique entre locataires.

    Aucune dérogation pour les administrateurs : une route d'administration
    déclare `require_role(UserRole.ADMIN)`, elle ne se déguise pas en route
    commerce.
    """
    if user.role is not UserRole.BUSINESS_MEMBER:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.INSUFFICIENT_ROLE)

    membership = await session.scalar(
        sa.select(BusinessMember).where(
            BusinessMember.business_id == business_id,
            BusinessMember.user_id == user.id,
        )
    )

    # Commerce inexistant ou non rattaché : même réponse. Distinguer les deux
    # cas dirait à un membre du commerce A quels identifiants existent ailleurs.
    if membership is None:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_A_MEMBER)

    return membership


BusinessMembership = Annotated[BusinessMember, Depends(require_business_member)]
