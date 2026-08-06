"""File d'administration du travail planifié.

Ne montre que ce que le système a **renoncé** à faire. Les jobs en attente ne
demandent rien à personne ; les afficher noierait les quelques-uns qui
attendent vraiment une décision.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.core.dependencies import SessionDep, require_role
from app.core.errors import ErrorCode, api_error
from app.models.enums import UserRole
from app.schemas.jobs import JobRead
from app.services import jobs as service

router = APIRouter(
    prefix="/admin/jobs",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.ADMIN))],
)


@router.get("/exhausted", response_model=list[JobRead])
async def list_exhausted(session: SessionDep) -> list[JobRead]:
    jobs = await service.epuises(session)
    return [JobRead.model_validate(job, from_attributes=True) for job in jobs]


@router.post("/{job_id}/retry", response_model=JobRead)
async def retry(job_id: Annotated[uuid.UUID, Path()], session: SessionDep) -> JobRead:
    """Réarme un job épuisé. Le geste que l'épuisement attend.

    Sans lui, s'arrêter reviendrait à abandonner : la file se remplirait de
    travaux définitivement perdus.
    """
    try:
        job = await service.rearmer(session, job_id)
    except service.JobNotFound as error:
        raise api_error(status.HTTP_404_NOT_FOUND, ErrorCode.JOB_NOT_FOUND) from error
    except service.JobNotExhausted as error:
        raise api_error(status.HTTP_409_CONFLICT, ErrorCode.JOB_NOT_EXHAUSTED) from error

    await session.commit()
    return JobRead.model_validate(job, from_attributes=True)
