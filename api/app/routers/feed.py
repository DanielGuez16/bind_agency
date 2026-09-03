"""Fil géolocalisé du créateur."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import CurrentUser, SessionDep, require_role
from app.integrations.geocoding import Coordinates
from app.models.enums import BusinessCategory, UserRole
from app.schemas.feed import FilPopulaireRead, FilRead, SuggestionsRead
from app.services import feed as service
from app.services.feed import FenetreDeDisponibilite

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
    disponible: Annotated[FenetreDeDisponibilite | None, Query()] = None,
    recherche: Annotated[str | None, Query(max_length=120)] = None,
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
        disponible=disponible,
        recherche=recherche,
    )
    return FilRead.model_validate(fil)


@router.get("/populaire", response_model=FilPopulaireRead)
async def read_feed_populaire(session: SessionDep, user: CurrentUser) -> FilPopulaireRead:
    """Le fil quand la position est refusée, indisponible, ou sans réponse.

    **Sans coordonnées, exprès.** `read_feed` les exige parce que trier par
    distance n'a pas de sens sans elles ; ici on trie par popularité, qui n'en
    a pas besoin. Un refus de géolocalisation ne doit pas laisser un écran
    vide — voir `feed.fil_populaire_du_createur`.
    """
    return FilPopulaireRead.model_validate(
        await service.fil_populaire_du_createur(session, creator_id=user.id)
    )


@router.get("/suggestions", response_model=SuggestionsRead)
async def read_suggestions(
    session: SessionDep,
    user: CurrentUser,
    longitude: Annotated[float, Query(ge=-180, le=180)],
    latitude: Annotated[float, Query(ge=-90, le=90)],
    rayon_metres: Annotated[int | None, Query(ge=100, le=100_000)] = None,
) -> SuggestionsRead:
    """Ce qu'on propose avant que la créatrice ait tapé quoi que ce soit.

    **La position est obligatoire ici**, contrairement au fil des paliers : une
    suggestion sans lieu ne suggère rien d'utile, et le quartier — qui décide de
    ce qui est « populaire » — en découle.
    """
    return SuggestionsRead.model_validate(
        await service.suggestions_du_createur(
            session,
            creator_id=user.id,
            autour_de=Coordinates(longitude=longitude, latitude=latitude),
            rayon_metres=rayon_metres,
        )
    )
