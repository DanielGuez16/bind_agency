"""Routes d'authentification.

Elles valident, appellent un service, traduisent ses erreurs en codes HTTP.
Aucune requête base, aucune règle d'accès écrite ici.
"""

from fastapi import APIRouter, status

from app.core.dependencies import CurrentUser, SessionDep
from app.core.errors import ErrorCode, api_error
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UpdateMeRequest,
    UserRead,
)
from app.services import account_deletion as deletion_service
from app.services import auth as auth_service
from app.services import email_verification as verification_service
from app.services.audit import Actor

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
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.EMAIL_ALREADY_USED) from error

    # **Le lien part dans la transaction de l'inscription.** Ou les deux
    # existent, ou aucun : un compte créé sans son courriel de confirmation
    # attendrait un message qui ne viendrait jamais, et personne ne le saurait.
    await verification_service.emettre(session, user=user)

    await session.commit()
    return UserRead.model_validate(user)


@router.get("/auth/verify-email", response_model=UserRead)
async def verify_email(token: str, session: SessionDep) -> UserRead:
    """Consomme le lien reçu par courriel.

    **En `GET`, parce qu'un lien de courriel s'ouvre dans un navigateur.**
    Exiger un `POST` obligerait à monter une page qui reposte, c'est-à-dire à
    dépendre de l'application pour valider une adresse dont on a justement
    besoin avant que l'application serve à quoi que ce soit.

    Le jeton est à usage unique : le second passage répond le même refus que
    n'importe quel jeton inconnu, ce qui est exact — il a été consommé.
    """
    try:
        user = await verification_service.confirmer(session, jeton=token)
    except verification_service.JetonInconnu as error:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, ErrorCode.EMAIL_VERIFICATION_INVALID
        ) from error

    await session.commit()
    return UserRead.model_validate(user)


@router.post("/me/verify-email/resend", status_code=status.HTTP_204_NO_CONTENT)
async def resend_verification(user: CurrentUser, session: SessionDep) -> None:
    """Renvoie un lien, et **révoque le précédent**.

    Sur `/me` et non sur `/auth` : il faut être connecté pour en demander un.
    Une route ouverte prendrait une adresse en clair et deviendrait un moyen
    d'envoyer du courrier à n'importe qui depuis notre domaine.
    """
    try:
        await verification_service.emettre(session, user=user)
    except verification_service.DejaVerifiee as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.EMAIL_ALREADY_VERIFIED) from error

    await session.commit()


@router.post("/auth/login", response_model=TokenPair)
async def login(payload: LoginRequest, session: SessionDep) -> TokenPair:
    try:
        user = await auth_service.authenticate(
            session, email=payload.email, password=payload.password
        )
    except auth_service.InvalidCredentials as error:
        raise api_error(status.HTTP_401_UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS) from error
    except auth_service.AccountNotActive as error:
        # 403 et non 401 : les identifiants sont bons, c'est le compte qui est
        # fermé. Réessayer n'y changera rien.
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.ACCOUNT_NOT_ACTIVE) from error

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
        raise api_error(status.HTTP_401_UNAUTHORIZED, ErrorCode.INVALID_REFRESH_TOKEN) from error

    await session.commit()
    return _token_pair(issued)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, session: SessionDep) -> None:
    try:
        await auth_service.revoke(session, payload.refresh_token)
    except auth_service.InvalidRefreshToken as error:
        raise api_error(status.HTTP_401_UNAUTHORIZED, ErrorCode.INVALID_REFRESH_TOKEN) from error

    await session.commit()


@router.get("/me", response_model=UserRead)
async def read_me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)


@router.patch("/me", response_model=UserRead)
async def update_me(payload: UpdateMeRequest, user: CurrentUser, session: SessionDep) -> UserRead:
    """La langue du compte : celle dans laquelle le serveur s'adressera à lui."""
    user.locale = payload.locale
    await session.commit()
    return UserRead.model_validate(user)


@router.post("/me/deletion", response_model=UserRead, status_code=status.HTTP_202_ACCEPTED)
async def request_deletion(user: CurrentUser, session: SessionDep) -> UserRead:
    """Ouvre le délai de trente jours. **202, et non 204.**

    Rien n'est fait au moment où l'on répond : une date est posée, et c'est
    exactement ce que « accepté, pas encore appliqué » veut dire. Un 204
    laisserait croire que le compte est parti.

    Le corps est le compte relu, avec son échéance : l'écran l'affiche sans
    redemander `/me`.
    """
    try:
        await deletion_service.demander(session, user=user, actor=Actor.from_user(user))
    except deletion_service.ContrepartieEnCours as error:
        # Le code seul, sans le nombre. `api_error` ne porte pas de détail, et
        # l'étendre pour un compteur serait payer une fabrique d'erreurs pour
        # une phrase : l'application liste déjà les contreparties du créateur
        # sur son historique, et sait donc les compter sans qu'on le lui dise.
        raise api_error(
            status.HTTP_409_CONFLICT, ErrorCode.DELETION_BLOCKED_BY_COLLABORATION
        ) from error
    except deletion_service.DejaDemandee as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.DELETION_ALREADY_REQUESTED) from error
    except deletion_service.CompteAnonymise as error:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.ACCOUNT_NOT_ACTIVE) from error

    await session.commit()
    return UserRead.model_validate(user)


@router.delete("/me/deletion", response_model=UserRead)
async def cancel_deletion(user: CurrentUser, session: SessionDep) -> UserRead:
    """Le retour, possible pendant le délai et lui seul.

    `DELETE` sur la demande, et non `POST /me/deletion/cancel` : ce qu'on retire
    est la demande, qui est bien la ressource créée juste au-dessus.
    """
    try:
        await deletion_service.annuler(session, user=user, actor=Actor.from_user(user))
    except deletion_service.AucuneDemande as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.DELETION_NOT_REQUESTED) from error
    except deletion_service.CompteAnonymise as error:
        raise api_error(status.HTTP_403_FORBIDDEN, ErrorCode.ACCOUNT_NOT_ACTIVE) from error

    await session.commit()
    return UserRead.model_validate(user)
