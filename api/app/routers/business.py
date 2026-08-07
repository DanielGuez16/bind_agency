"""Espace commerce.

`/business/...` est l'espace du commerçant. `/businesses/...` reste libre pour
la découverte côté créateur, en phase 5 : les deux n'auront pas les mêmes règles
d'accès et n'ont rien à faire sur le même chemin.
"""

from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import (
    CurrentBusiness,
    CurrentUser,
    SessionDep,
    require_role,
)
from app.core.errors import ErrorCode, api_error
from app.integrations.geocoding import Geocoder, get_geocoder
from app.models import Business, BusinessMember
from app.models.enums import UserRole
from app.schemas.activation import EtapeRead
from app.schemas.business import (
    BusinessCreate,
    BusinessRead,
    BusinessUpdate,
    CoordinatesPayload,
)
from app.services import business as business_service
from app.services.audit import Actor

router = APIRouter(prefix="/business", tags=["business"])

#: Sur `/me`, pas sur `/business` : c'est une lecture de l'appelant, pas d'un
#: commerce, et elle ne passe donc pas par le résolveur d'appartenance — elle
#: le rendrait circulaire.
mes_commerces_router = APIRouter(
    tags=["business"], dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))]
)

GeocoderDep = Annotated[Geocoder, Depends(get_geocoder)]


async def _to_read(session: AsyncSession, business: Business) -> BusinessRead:
    coordinates = await business_service.coordinates_of(session, business)
    return BusinessRead(
        id=business.id,
        name=business.name,
        category=business.category,
        address=business.address,
        coordinates=(
            CoordinatesPayload(longitude=coordinates.longitude, latitude=coordinates.latitude)
            if coordinates
            else None
        ),
        timezone=business.timezone,
        default_locale=business.default_locale,
        phone=business.phone,
        currency=business.currency,
        cover_photo_key=business.cover_photo_key,
        status=business.status,
        created_at=business.created_at,
    )


@mes_commerces_router.get("/me/businesses", response_model=list[BusinessRead])
async def list_my_businesses(user: CurrentUser, session: SessionDep) -> list[BusinessRead]:
    """Les commerces dont l'appelant est membre.

    Sans elle, une application commerce ne peut rien afficher : tous les écrans
    prennent un `business_id`, et le résolveur d'appartenance ne sert qu'à
    vérifier celui qu'on lui donne — il ne dit pas lequel demander.

    Rend une liste et non un objet : rien n'interdit d'appartenir à deux
    commerces, et rendre le premier obligerait à réécrire la route le jour où
    quelqu'un en a deux. Une liste vide est une réponse valide — un membre sans
    rattachement existe le temps de son inscription.

    Aucune autre lecture n'est ouverte ici : c'est `/business/{id}` qui rend le
    détail, derrière le résolveur.
    """
    commerces = await session.scalars(
        sa.select(Business)
        .join(BusinessMember, BusinessMember.business_id == Business.id)
        .where(BusinessMember.user_id == user.id)
        .order_by(Business.name)
    )
    return [await _to_read(session, commerce) for commerce in commerces]


@router.post(
    "",
    response_model=BusinessRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))],
)
async def create(
    payload: BusinessCreate,
    user: CurrentUser,
    session: SessionDep,
    geocoder: GeocoderDep,
) -> BusinessRead:
    business = await business_service.create_business(
        session, payload=payload, creator=user, geocoder=geocoder
    )
    await session.commit()
    return await _to_read(session, business)


@router.get("/{business_id}", response_model=BusinessRead)
async def read(business: CurrentBusiness, session: SessionDep) -> BusinessRead:
    return await _to_read(session, business)


@router.patch("/{business_id}", response_model=BusinessRead)
async def update(
    payload: BusinessUpdate,
    business: CurrentBusiness,
    session: SessionDep,
    geocoder: GeocoderDep,
) -> BusinessRead:
    await business_service.update_business(
        session, business=business, payload=payload, geocoder=geocoder
    )
    await session.commit()
    return await _to_read(session, business)


@router.get("/{business_id}/activation", response_model=list[EtapeRead])
async def activation_steps(business: CurrentBusiness, session: SessionDep) -> list[EtapeRead]:
    """Ce qui reste à faire, et ce qui bloque vraiment.

    Le service connaissait déjà ces conditions et ne les exposait pas : le
    commerçant les apprenait en essayant, une à la fois. `activate_business`
    consomme la même liste, ce qui garantit que l'écran et le refus disent la
    même chose.
    """
    etapes = await business_service.etapes_activation(session, business=business)
    return [EtapeRead.model_validate(etape) for etape in etapes]


@router.post("/{business_id}/activate", response_model=BusinessRead)
async def activate(
    business: CurrentBusiness, user: CurrentUser, session: SessionDep
) -> BusinessRead:
    """Transition explicite. Le refus nomme la condition qui manque."""
    try:
        await business_service.activate_business(
            session, business=business, actor=Actor.from_user(user)
        )
    except business_service.AlreadyActive as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.BUSINESS_ALREADY_ACTIVE) from error
    except business_service.MissingAddress as error:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.BUSINESS_MISSING_ADDRESS
        ) from error
    except business_service.MissingCoordinates as error:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.BUSINESS_MISSING_COORDINATES
        ) from error

    await session.commit()
    return await _to_read(session, business)
