"""Fil géolocalisé du créateur."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.integrations.geocoding import Coordinates
from app.models.enums import BusinessCategory, UserRole
from app.schemas.feed import FilRead
from app.services import feed as service

router = APIRouter(
    prefix="/businesses",
    tags=["feed"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)


@router.get("", response_model=FilRead)
async def read_feed(
    session: SessionDep,
    user: CurrentUser,
    longitude: Annotated[float, Query(ge=-180, le=180)],
    latitude: Annotated[float, Query(ge=-90, le=90)],
    rayon_metres: Annotated[int | None, Query(ge=100, le=100_000)] = None,
    categorie: Annotated[BusinessCategory | None, Query()] = None,
) -> FilRead:
    """Les coordonnées viennent de l'appelant, pas du profil.

    Un créateur consulte le fil là où il se trouve, qui n'est pas toujours la
    ville qu'il a déclarée. Prendre `creator_profile.geo` lui montrerait Miami
    depuis un aéroport.
    """
    fil = await service.fil_du_createur(
        session,
        creator_id=user.id,
        autour_de=Coordinates(longitude=longitude, latitude=latitude),
        rayon_metres=rayon_metres,
        categorie=categorie,
    )
    return FilRead.model_validate(fil)
