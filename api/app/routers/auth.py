"""Routes d'authentification.

Elles valident, appellent un service, traduisent ses erreurs en codes HTTP.
Aucune requête base, aucune règle d'accès écrite ici.
"""

from fastapi import APIRouter, HTTPException, status

from app.core.dependencies import CurrentUser, SessionDep
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserRead,
)
from app.services import auth as auth_service

router = APIRouter(tags=["auth"])


def _token_pair(issued: auth_service.IssuedTokens) -> TokenPair:
    return TokenPair(
        access_token=issued.access_token,
        refresh_token=issued.refresh_token,
        expires_in=issued.expires_in,
    )


@router.post("/auth/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, session: SessionDep) -> UserRead:
    try:
        user = await auth_service.register(
            session,
            email=payload.email,
            password=payload.password,
            role=payload.role,
            locale=payload.locale,
        )
    except auth_service.EmailAlreadyUsed as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email_already_used"
        ) from error

    await session.commit()
    return UserRead.model_validate(user)


@router.post("/auth/login", response_model=TokenPair)
async def login(payload: LoginRequest, session: SessionDep) -> TokenPair:
    try:
        user = await auth_service.authenticate(
            session, email=payload.email, password=payload.password
        )
    except auth_service.InvalidCredentials as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials"
        ) from error
    except auth_service.AccountNotActive as error:
        # 403 et non 401 : les identifiants sont bons, c'est le compte qui est
        # fermé. Réessayer n'y changera rien.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="account_not_active"
        ) from error

    issued = await auth_service.issue_tokens(session, user)
    await session.commit()
    return _token_pair(issued)


@router.post("/auth/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: SessionDep) -> TokenPair:
    try:
        issued = await auth_service.rotate(session, payload.refresh_token)
    except auth_service.InvalidRefreshToken as error:
        # Le commit est nécessaire : un rejeu détecté révoque toutes les
        # sessions du compte, et cette révocation doit survivre au refus.
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token"
        ) from error

    await session.commit()
    return _token_pair(issued)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, session: SessionDep) -> None:
    try:
        await auth_service.revoke(session, payload.refresh_token)
    except auth_service.InvalidRefreshToken as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token"
        ) from error

    await session.commit()


@router.get("/me", response_model=UserRead)
async def read_me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)
