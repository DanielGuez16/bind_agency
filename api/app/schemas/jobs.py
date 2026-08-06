"""Schémas de la file de travail planifié."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import JobStatus, JobType


class JobRead(BaseModel):
    """Un job tel que l'administration le voit.

    `last_error` en fait partie : une file qui dirait « ce job a échoué » sans
    dire pourquoi obligerait à aller lire les journaux du serveur, ce que
    personne ne fait à trois heures du matin.
    """

    id: uuid.UUID
    job_type: JobType
    target_id: uuid.UUID
    status: JobStatus
    attempts: int
    run_after: datetime
    last_error: str | None
    last_run_at: datetime | None
    created_at: datetime
