"""Les deux listes de réservations : l'historique du créateur, la journée du commerce.

Un seul fichier parce que c'est une seule décision de contrat — ce que rend une
liste de réservations — mais deux routeurs, parce que les gardes ne sont pas les
mêmes : rôle créateur d'un côté, appartenance au commerce de l'autre.
"""

from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import CurrentBusiness, CurrentUser, SessionDep, require_role
from app.models.enums import BookingStatus, UserRole
from app.schemas.booking_history import (
    BandeDeDecisionsRead,
    HistoriqueDuCreateurRead,
    JourneeDuCommerceRead,
)
from app.services import booking_history as service

creator_router = APIRouter(
    prefix="/me",
    tags=["bookings"],
    dependencies=[Depends(require_role(UserRole.CREATOR))],
)

business_router = APIRouter(prefix="/business", tags=["bookings"])


@creator_router.get("/bookings", response_model=HistoriqueDuCreateurRead)
async def read_history(
    user: CurrentUser,
    session: SessionDep,
    status: Annotated[list[BookingStatus] | None, Query()] = None,
    onglet: Annotated[service.OngletDuCreateur | None, Query()] = None,
    avant: Annotated[datetime | None, Query()] = None,
    limite: Annotated[int, Query(ge=1, le=service.PAGE_MAXIMUM)] = service.PAGE_PAR_DEFAUT,
) -> HistoriqueDuCreateurRead:
    """L'historique, du plus récent au plus ancien.

    `status` accepte plusieurs valeurs : un onglet « à venir » couvre `held` et
    `confirmed`, et faire deux appels pour un onglet obligerait l'app à
    fusionner deux pages triées séparément.

    `avant` pagine sur `created_at`, la colonne du tri. Un décalage numérique
    sauterait des lignes dès qu'une réservation est prise pendant la lecture.
    """
    historique = await service.historique_du_createur(
        session,
        creator_id=user.id,
        statuts=frozenset(status) if status else None,
        onglet=onglet,
        avant=avant,
        limite=limite,
    )
    return HistoriqueDuCreateurRead.model_validate(historique)


@business_router.get("/{business_id}/bookings", response_model=JourneeDuCommerceRead)
async def read_day(
    business: CurrentBusiness,
    session: SessionDep,
    jour: Annotated[date | None, Query()] = None,
) -> JourneeDuCommerceRead:
    """La journée du comptoir, découpée dans le fuseau du commerce.

    Sans `jour`, c'est aujourd'hui — chez le commerce, pas chez le serveur.
    """
    journee = await service.journee_du_commerce(
        session,
        business=business,
        jour=jour or service.aujourd_hui(business),
    )
    return JourneeDuCommerceRead.model_validate(journee)


@business_router.get("/{business_id}/bookings/par-jour", response_model=BandeDeDecisionsRead)
async def read_decisions_par_jour(
    business: CurrentBusiness,
    session: SessionDep,
    depuis: Annotated[date | None, Query()] = None,
    jours: Annotated[int, Query(ge=1, le=31)] = 7,
) -> BandeDeDecisionsRead:
    """La bande de jours : combien de décisions tombent chaque jour.

    **En un appel.** L'écran dessine la semaine avant qu'on ouvre un jour ; sept
    appels à la journée entière rapporteraient sept fois les réservations pour
    n'en garder que le compte.

    Sans `depuis`, la bande commence aujourd'hui — chez le commerce, pas chez le
    serveur.
    """
    bande = await service.decisions_par_jour(
        session,
        business=business,
        depuis=depuis or service.aujourd_hui(business),
        jours=jours,
    )
    return BandeDeDecisionsRead.model_validate(bande)
