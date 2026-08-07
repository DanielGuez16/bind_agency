"""Reporting du commerce."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.core.dependencies import CurrentBusiness, SessionDep
from app.schemas.reporting import ReportingRead
from app.services import reporting as service

router = APIRouter(prefix="/business", tags=["reporting"])


@router.get("/{business_id}/reporting", response_model=ReportingRead)
async def read_reporting(
    business: CurrentBusiness,
    session: SessionDep,
    depuis: Annotated[date | None, Query()] = None,
    jusqu_a: Annotated[date | None, Query()] = None,
) -> ReportingRead:
    """Ce que sa participation a rapporté au commerce.

    L'isolation ne tient pas à un filtre écrit ici : `business` vient du
    résolveur d'appartenance, qui a déjà refusé un membre d'un autre commerce.

    Les bornes sont **inclusives** et découpées dans le fuseau du commerce :
    « du 1er au 31 » contient le 31, et le mois d'un salon de Miami ne commence
    pas à 20 h la veille.
    """
    vue = await service.pour_le_commerce(session, business=business, depuis=depuis, jusqu_a=jusqu_a)
    return ReportingRead.model_validate(vue)
