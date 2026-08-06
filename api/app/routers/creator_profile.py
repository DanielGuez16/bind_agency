"""Profil créateur.

Sous `/me`, sans identifiant dans l'URL : le titulaire vient du jeton. C'est ce
qui fait qu'aucune requête ne peut viser le profil d'un autre — la protection
est dans la forme de l'API, pas dans un contrôle qu'on pourrait oublier
d'écrire.
"""

from fastapi import APIRouter, Depends, status

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models.enums import UserRole
from app.schemas.creator_profile import CreatorProfileRead, CreatorProfileUpdate
from app.services import creator_profile as service

router = APIRouter(
    prefix="/me/profile",
    tags=["creator-profile"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)


@router.get("", response_model=CreatorProfileRead)
async def read_profile(user: CurrentUser, session: SessionDep) -> CreatorProfileRead:
    try:
        profil = await service.get_profile(session, user.id)
    except service.CreatorProfileNotFound as error:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.CREATOR_PROFILE_NOT_FOUND) from error

    return CreatorProfileRead.model_validate(profil)


@router.patch("", response_model=CreatorProfileRead)
async def update_profile(
    payload: CreatorProfileUpdate, user: CurrentUser, session: SessionDep
) -> CreatorProfileRead:
    """`exclude_unset` porte toute la sémantique de la mise à jour partielle :
    un champ absent de la charge utile n'est pas effacé, un champ envoyé à
    `null` l'est."""
    try:
        profil = await service.update_profile(
            session,
            user_id=user.id,
            modifications=payload.model_dump(exclude_unset=True),
        )
    except service.CreatorProfileNotFound as error:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.CREATOR_PROFILE_NOT_FOUND) from error
    except service.ProfileAnonymized as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.CREATOR_PROFILE_ANONYMIZED) from error

    await session.commit()
    return CreatorProfileRead.model_validate(profil)
