"""Écran des paliers accessibles."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.integrations.geocoding import Coordinates
from app.models.enums import UserRole
from app.schemas.creator_tiers import OffreDuPalierRead, VueDesPaliersRead
from app.services import creator_tiers as service

router = APIRouter(
    prefix="/me/tiers",
    tags=["creator-tiers"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)


@router.get("", response_model=VueDesPaliersRead)
async def read_tiers(
    user: CurrentUser,
    session: SessionDep,
    longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
    latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
    rayon_metres: Annotated[int | None, Query(ge=100, le=100_000)] = None,
) -> VueDesPaliersRead:
    """Le résultat n'est pas mis en cache : il dépend de l'âge des relevés,
    donc du moment. Le cacher ressusciterait les chiffres périmés que la
    condition de fraîcheur cherche à écarter.

    **La position est facultative, et la route n'en dépend jamais.** Sans elle,
    la réponse est celle d'avant au champ près. Avec, chaque palier porte en
    plus combien de commerces le proposent à portée — « douze au total, dont
    neuf à moins de quinze kilomètres ».

    **Les deux coordonnées vont ensemble.** Une seule des deux est une erreur
    de l'appelant, pas une demande à moitié : l'accepter en silence ferait
    répondre « aucun commerce autour » à quelqu'un dont la longitude s'est
    perdue en route.
    """
    if (longitude is None) != (latitude is None):
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED)

    autour_de = (
        None
        if longitude is None or latitude is None
        else Coordinates(longitude=longitude, latitude=latitude)
    )
    return VueDesPaliersRead.model_validate(
        await service.vue_des_paliers(
            session, user.id, autour_de=autour_de, rayon_metres=rayon_metres
        )
    )


@router.get("/{tier_id}/offres", response_model=list[OffreDuPalierRead])
async def read_offres_du_palier(
    tier_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
    longitude: Annotated[float | None, Query(ge=-180, le=180)] = None,
    latitude: Annotated[float | None, Query(ge=-90, le=90)] = None,
) -> list[OffreDuPalierRead]:
    """Toutes les prestations d'un palier, **sans borne de distance**.

    Ce que le fil ne peut pas rendre : il est borné par un rayon par
    construction, et le déborner n'y suffirait pas — il exige une position et
    trie par distance, ce qui n'a pas de sens pour « tout BIND ».

    **Trié par quartier, puis par nom de prestation.** C'est le seul axe que le
    produit connaît déjà et qui ne classe personne : trier par palier
    hiérarchiserait des prestations que la créatrice peut toutes réserver, et
    trier par salon supposerait un ordre entre eux.

    La position reste facultative et ne borne rien : elle ne fait qu'ajouter la
    distance à chaque ligne, pour que l'écran puisse dire lesquelles sont près.
    """
    if (longitude is None) != (latitude is None):
        raise api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.VALIDATION_FAILED)

    autour_de = (
        None
        if longitude is None or latitude is None
        else Coordinates(longitude=longitude, latitude=latitude)
    )
    return [
        OffreDuPalierRead.model_validate(offre)
        for offre in await service.offres_du_palier(session, tier_id=tier_id, autour_de=autour_de)
    ]
