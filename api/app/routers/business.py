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
from app.schemas.activation import EtapeRead, VueDActivationRead
from app.schemas.business import (
    BusinessCreate,
    BusinessRead,
    BusinessUpdate,
    CoordinatesPayload,
    EtatDeLaCompositionRead,
    ReperesDuVoisinageRead,
)
from app.services import business as business_service
from app.services import composition as composition_service
from app.services import neighbourhood as neighbourhood_service
from app.services.audit import Actor

router = APIRouter(prefix="/business", tags=["business"])

#: Sur `/me`, pas sur `/business` : c'est une lecture de l'appelant, pas d'un
#: commerce, et elle ne passe donc pas par le résolveur d'appartenance — elle
#: le rendrait circulaire.
mes_commerces_router = APIRouter(
    tags=["business"], dependencies=[Depends(require_role(UserRole.BUSINESS_MEMBER))]
)

GeocoderDep = Annotated[Geocoder, Depends(get_geocoder)]


async def lire_le_commerce(session: AsyncSession, business: Business) -> BusinessRead:
    coordinates = await business_service.coordinates_of(session, business)
    return BusinessRead(
        id=business.id,
        name=business.name,
        category=business.category,
        address=business.address,
        neighborhood=business.neighborhood,
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
        cover_portrait_key=business.cover_portrait_key,
        menu_url=business.menu_url,
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
    return [await lire_le_commerce(session, commerce) for commerce in commerces]


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
    return await lire_le_commerce(session, business)


@router.get("/{business_id}", response_model=BusinessRead)
async def read(business: CurrentBusiness, session: SessionDep) -> BusinessRead:
    return await lire_le_commerce(session, business)


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
    return await lire_le_commerce(session, business)


@router.get("/{business_id}/activation", response_model=VueDActivationRead)
async def activation_steps(business: CurrentBusiness, session: SessionDep) -> VueDActivationRead:
    """Ce qui reste à faire, ce qui bloque vraiment, et où en est le commerce.

    Le service connaissait déjà ces conditions et ne les exposait pas : le
    commerçant les apprenait en essayant, une à la fois. `activate_business`
    consomme la même liste, ce qui garantit que l'écran et le refus disent la
    même chose.

    Le statut accompagne les étapes parce que les deux répondent à la même
    question. Sans lui, l'écran voyait six étapes faites et proposait d'ouvrir
    un commerce ouvert depuis des semaines.
    """
    etapes = await business_service.etapes_activation(session, business=business)
    return VueDActivationRead(
        status=business.status,
        etapes=[EtapeRead.model_validate(etape) for etape in etapes],
    )


@router.get("/{business_id}/composition", response_model=EtatDeLaCompositionRead)
async def composition_state(
    business: CurrentBusiness, session: SessionDep
) -> EtatDeLaCompositionRead:
    """Où en est la composition : prestations, jours ouverts, mise en ligne.

    Le menu de configuration montrait trois portes sans rien dire de ce qu'il y
    avait derrière. C'est le premier écran qu'ouvre un salon qui vient de
    s'inscrire, et il doit voir où il en est sans entrer dans chacune.

    Une route et non trois : les trois nombres vivent dans trois tables, et
    trois appels feraient se recomposer le menu sous les yeux.
    """
    etat = await composition_service.etat_de_la_composition(session, business.id)
    # `CurrentBusiness` a déjà chargé le commerce : il ne peut pas manquer ici.
    assert etat is not None
    return EtatDeLaCompositionRead.model_validate(etat)


@router.get("/{business_id}/neighbourhood", response_model=ReperesDuVoisinageRead)
async def neighbourhood(business: CurrentBusiness, session: SessionDep) -> ReperesDuVoisinageRead:
    """Trois repères des salons d'à côté, pour l'état vide du commerce.

    L'état vide disait « ajoutez une prestation » et rien de plus. Un salon qui
    vient de s'inscrire ne sait pas combien en publier ni combien de places
    ouvrir : il ouvre au hasard, se trouve invisible dans le fil, et conclut que
    le produit ne marche pas.

    **Le voisinage est un rayon, pas un quartier.** Le modèle n'a pas de
    quartiers et n'en gagne pas ici — c'est déjà pour cette raison que la ville
    d'un créateur est un champ libre (SPEC §5.2). Le rayon est rendu avec les
    chiffres pour que l'écran l'écrive.

    **Des fourchettes, et rien sous un plancher d'effectif.** Un commerce ne doit
    pas pouvoir lire le catalogue d'un concurrent en s'inscrivant à côté de lui.
    """
    reperes = await neighbourhood_service.reperes_du_voisinage(session, business=business)
    return ReperesDuVoisinageRead.model_validate(reperes)


@router.post("/{business_id}/pause", response_model=BusinessRead)
async def pause(business: CurrentBusiness, user: CurrentUser, session: SessionDep) -> BusinessRead:
    """Le commerce se retire du fil, sans rien perdre.

    Réversible par `/activate`, qui repasse par les mêmes conditions : un
    commerce qui a retiré sa dernière offre pendant sa pause ne rouvre pas
    invisible.
    """
    try:
        await business_service.pause_business(
            session, business=business, actor=Actor.from_user(user)
        )
    except business_service.NotActive as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.BUSINESS_NOT_ACTIVE) from error

    await session.commit()
    return await lire_le_commerce(session, business)


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
    except business_service.NotClaimed as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.BUSINESS_NOT_CLAIMED) from error
    except business_service.MissingAddress as error:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.BUSINESS_MISSING_ADDRESS
        ) from error
    except business_service.MissingCoordinates as error:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, ErrorCode.BUSINESS_MISSING_COORDINATES
        ) from error

    await session.commit()
    return await lire_le_commerce(session, business)
