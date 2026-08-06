"""Travail planifié — la table de jobs annoncée par `SPEC.md` §1.

Pas de Celery, pas de courtier de messages : Postgres tient déjà les deux
choses qu'un ordonnanceur demande, une transaction et un verrou de ligne.
Ajouter un système distinct ajouterait surtout un second endroit où l'état peut
diverger du nôtre.

**Une ligne par travail, pour toujours.** `UNIQUE (job_type, target_id)` : il
n'existe jamais deux relevés quotidiens du même compte. Un job récurrent n'est
pas consommé quand il réussit, il est reprogrammé — la ligne est le travail, pas
son occurrence.

**Pas d'état « en cours ».** Un job réclamé l'est par un verrou de ligne tenu
jusqu'au commit, jamais par une colonne. Une colonne `running` survivrait à la
mort du processus et il faudrait un ramasse-miettes pour distinguer un job
vraiment en cours d'un job orphelin ; le verrou, lui, disparaît tout seul et le
job redevient disponible. Un état qui peut rester coincé est pire que pas
d'état.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, enum_column
from app.models.enums import JobStatus, JobType


class Job(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "job"

    job_type: Mapped[JobType] = mapped_column(enum_column(JobType, "job_type"), nullable=False)

    #: La cible, sans clé étrangère : les jobs des phases 6 et 7 viseront des
    #: réservations et des collaborations, pas des comptes sociaux. Une colonne
    #: par type de cible serait un formulaire à rallonge, et une clé étrangère
    #: polymorphe n'existe pas. C'est le type du job qui dit quoi lire.
    target_id: Mapped[uuid.UUID] = mapped_column(sa.Uuid, nullable=False)

    status: Mapped[JobStatus] = mapped_column(
        enum_column(JobStatus, "job_status"),
        nullable=False,
        server_default=JobStatus.PENDING.value,
    )

    #: Remis à zéro à chaque succès : le compteur mesure la série d'échecs en
    #: cours, pas l'usage du job depuis sa création.
    attempts: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))

    #: Rien ne s'exécute avant cette date. C'est à la fois la périodicité d'un
    #: job récurrent et le report d'un job en échec — un seul mécanisme.
    run_after: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("clock_timestamp()")
    )

    last_error: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        sa.UniqueConstraint("job_type", "target_id"),
        sa.CheckConstraint("attempts >= 0", name="attempts_positive"),
        # Un job épuisé a forcément essayé ; un job en attente peut n'avoir
        # jamais tourné. La contrainte interdit le seul état incohérent.
        sa.CheckConstraint(
            "status <> 'exhausted' OR attempts > 0", name="exhausted_implies_attempts"
        ),
        # L'index de réclamation. `status` d'abord parce qu'il est très
        # sélectif, `run_after` ensuite parce que c'est lui qu'on ordonne.
        sa.Index("ix_job_status_run_after", "status", "run_after"),
    )
