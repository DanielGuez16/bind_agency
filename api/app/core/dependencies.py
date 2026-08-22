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
from fastapi import Depends, Path, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.errors import ErrorCode, api_error
from app.core.portee import portee_de_la_requete
from app.core.security import InvalidToken, TokenType, decode_token
from app.models import Business, BusinessMember, User
from app.models.enums import BusinessMemberRole, PorteeDeReprise, UserRole, UserStatus

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
    request: Request,
    business_id: Annotated[uuid.UUID, Path()],
    user: CurrentUser,
    session: SessionDep,
) -> BusinessMember:
    """Exige l'appartenance au commerce désigné par le chemin.

    Le bon rôle ne suffit pas : sans ce second contrôle, un membre du commerce A
    lit les ressources du commerce B. C'est la fuite classique entre locataires.

    **Aucune dérogation implicite pour les administrateurs.** Une route
    d'administration déclare `require_role(UserRole.ADMIN)`, elle ne se déguise
    pas en route commerce. La seule façon pour un administrateur d'agir au nom
    d'un salon est d'ouvrir une **reprise** : un geste explicite, motivé, borné
    dans le temps, écrit au journal et **dont le salon est prévenu**. Hors
    reprise, il reçoit exactement le même refus que n'importe qui — c'est ce
    que le premier test de `test_support_access.py` vérifie.
    """
    if user.role is UserRole.ADMIN:
        return await _reprise_ou_refus(
            session, user=user, business_id=business_id, portee=portee_de_la_requete(request)
        )
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


async def _reprise_ou_refus(
    session: AsyncSession,
    *,
    user: User,
    business_id: uuid.UUID,
    portee: PorteeDeReprise | None,
) -> BusinessMember:
    """L'appartenance qu'une reprise ouverte confère à un administrateur.

    **L'objet rendu n'est pas écrit en base.** Il n'existe que le temps de la
    requête, pour que les routes lisent `membership.role` sans savoir d'où il
    vient. Poser une vraie ligne `business_member` reviendrait à créer un
    accès qui survivrait à la reprise — exactement ce qu'on refuse.

    **Le rôle est `owner`**, parce qu'une intervention qui ne peut pas toucher
    à la configuration ne débloque rien, et qu'un demi-accès obligerait à
    rouvrir une reprise plus large trois minutes plus tard.
    """
    from app.services import support as support_service

    acces = await support_service.en_cours(session, business_id=business_id, admin_user_id=user.id)
    if acces is None:
        # Le même refus qu'un membre du commerce d'à côté. Un code distinct
        # apprendrait à qui tâtonne quels commerces existent.
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_A_MEMBER)

    # **La portée borne, et c'est ici qu'elle borne.** Déclarée à l'ouverture,
    # vérifiée à chaque requête : sans ce contrôle, elle ne serait qu'une
    # phrase affichée au salon, c'est-à-dire une promesse que rien ne tient.
    #
    # Un code distinct, et non le refus ordinaire : celui qui le reçoit a déjà
    # prouvé son accès, il n'apprend donc rien qu'il ne sache — et sans ce code
    # il chercherait une panne là où il n'a qu'à déclarer la bonne portée.
    if not support_service.couvre(acces, portee):
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.SUPPORT_ACCESS_OUT_OF_SCOPE)

    return BusinessMember(business_id=business_id, user_id=user.id, role=BusinessMemberRole.OWNER)


BusinessMembership = Annotated[BusinessMember, Depends(require_business_member)]


async def current_business(membership: BusinessMembership, session: SessionDep) -> Business:
    """Le commerce désigné par le chemin, une fois l'appartenance établie.

    La clé étrangère de `business_member` garantit qu'il existe. On ne s'appuie
    pas sur un `assert` pour autant : il disparaîtrait sous `python -O` et
    transformerait l'impossible en 500.
    """
    business = await session.get(Business, membership.business_id)
    if business is None:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_A_MEMBER)
    return business


CurrentBusiness = Annotated[Business, Depends(current_business)]
