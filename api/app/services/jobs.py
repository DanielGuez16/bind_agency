"""File de travail planifié.

Trois opérations, et une seule est délicate.

**Planifier** est idempotent. `INSERT … ON CONFLICT DO NOTHING` sur
`(job_type, target_id)` : relancer la planification dix fois ne crée pas dix
jobs, et surtout ne ressuscite pas un job épuisé. Un balayage qui réactiverait
silencieusement ce qu'un administrateur n'a pas encore regardé annulerait tout
l'intérêt de l'épuisement.

**Réclamer** est le point qui compte. `FOR UPDATE SKIP LOCKED` : deux exécutions
concurrentes ne se voient pas attribuer le même job, parce que la seconde saute
les lignes verrouillées par la première au lieu de les attendre. C'est un
verrou, pas une convention — aucune discipline d'appel n'est requise, et deux
processus lancés par erreur en même temps se répartissent le travail au lieu de
le doubler.

Le verrou tient jusqu'au commit, donc pendant tout le traitement. C'est un choix
assumé : la transaction est longue, mais si le processus meurt, le verrou tombe
avec lui et le job redevient disponible sans qu'on ait rien à nettoyer. Une
colonne « en cours » aurait rendu la transaction courte et laissé des jobs
coincés qu'il aurait fallu ramasser.

**Reporter** applique un délai croissant plafonné. Croissant parce qu'une panne
d'en face dure rarement une seconde ; plafonné parce qu'un délai qui double
indéfiniment finit par ne plus jamais réessayer.
"""

import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.models import Job
from app.models.enums import JobStatus, JobType


class JobError(Exception):
    """Base des refus de la file."""


class JobNotFound(JobError):
    """Job inexistant."""


class JobNotExhausted(JobError):
    """Seul un job épuisé se réarme : réarmer un job en attente ne veut rien dire."""


async def planifier(
    session: AsyncSession,
    *,
    job_type: JobType,
    target_id: uuid.UUID,
    run_after: datetime | None = None,
) -> None:
    """Crée le job s'il n'existe pas. Ne touche jamais un job existant.

    Ni son `run_after` — on ne repousse pas un travail déjà dû — ni son statut :
    un job épuisé reste épuisé jusqu'à ce qu'un administrateur le réarme.
    """
    statement = (
        pg_insert(Job)
        .values(
            job_type=job_type,
            target_id=target_id,
            run_after=run_after or datetime.now(UTC),
        )
        .on_conflict_do_nothing(index_elements=["job_type", "target_id"])
    )
    await session.execute(statement)


async def deplanifier(session: AsyncSession, *, target_id: uuid.UUID) -> int:
    """Retire tous les jobs d'une cible qui n'a plus lieu d'être planifiée.

    Supprimer plutôt que marquer : la planification étant idempotente, la ligne
    reviendra d'elle-même si la cible redevient éligible. Un statut « annulé »
    obligerait à décider quand le lever, et personne ne se souviendrait de la
    règle six mois plus tard.
    """
    resultat = await session.execute(sa.delete(Job).where(Job.target_id == target_id))
    return resultat.rowcount


async def reclamer(session: AsyncSession, *, limite: int = 1) -> list[Job]:
    """Prend des jobs dus, en excluant ceux qu'une autre exécution tient déjà.

    `SKIP LOCKED` et non `NOWAIT` : la seconde exécution continue avec les jobs
    suivants au lieu d'échouer. C'est ce qui fait qu'ajouter un processus ajoute
    du débit, sans coordination.
    """
    statement = (
        sa.select(Job)
        .where(Job.status == JobStatus.PENDING, Job.run_after <= sa.func.clock_timestamp())
        .order_by(Job.run_after)
        .limit(limite)
        .with_for_update(skip_locked=True)
    )
    return list(await session.scalars(statement))


async def reussir(session: AsyncSession, job: Job, *, prochain: timedelta | None) -> None:
    """Le job a fait son travail.

    `prochain` nul le laisse en attente immédiate, ce qui n'a d'usage que pour
    un job ponctuel qu'on déplanifiera juste après. Les jobs récurrents donnent
    leur période : la ligne n'est pas consommée, elle est reprogrammée.
    """
    job.attempts = 0
    job.last_error = None
    job.last_run_at = datetime.now(UTC)
    job.run_after = datetime.now(UTC) + (prochain or timedelta(0))
    await session.flush()


async def echouer(session: AsyncSession, job: Job, *, erreur: str) -> JobStatus:
    """Reporte le job, ou l'épuise si les tentatives sont consommées.

    Rend le statut obtenu : l'appelant a besoin de savoir s'il vient de perdre
    définitivement ce travail.
    """
    settings = get_settings()

    job.attempts += 1
    job.last_error = erreur[: settings.job_error_max_length]
    job.last_run_at = datetime.now(UTC)

    if job.attempts >= settings.job_max_attempts:
        # On s'arrête, et on le dit. Un job qui échoue en silence pour toujours
        # est pire qu'un job qui n'existe pas : personne ne cherche ce dont
        # personne ne sait qu'il manque.
        job.status = JobStatus.EXHAUSTED
    else:
        job.run_after = datetime.now(UTC) + delai_de_report(job.attempts, settings)

    await session.flush()
    return job.status


def delai_de_report(tentatives: int, settings: Settings) -> timedelta:
    """Délai croissant, plafonné.

    Le plafond n'est pas une précaution de forme : sans lui, la dixième
    tentative tomberait dans plusieurs semaines, et un compte se réparerait
    longtemps après que le créateur a cessé d'attendre.
    """
    facteur = settings.job_retry_factor ** max(tentatives - 1, 0)
    secondes = min(settings.job_retry_base_seconds * facteur, settings.job_retry_max_seconds)
    return timedelta(seconds=secondes)


async def epuises(session: AsyncSession) -> list[Job]:
    """La file d'administration : ce que le système a renoncé à faire."""
    statement = (
        sa.select(Job).where(Job.status == JobStatus.EXHAUSTED).order_by(Job.last_run_at.desc())
    )
    return list(await session.scalars(statement))


async def rearmer(session: AsyncSession, job_id: uuid.UUID) -> Job:
    """Remet un job épuisé en attente, compteur remis à zéro.

    Réservé à l'administration. C'est le geste que l'épuisement attend : sans
    lui, s'arrêter reviendrait à abandonner.
    """
    job = await session.get(Job, job_id)
    if job is None:
        raise JobNotFound(str(job_id))
    if job.status is not JobStatus.EXHAUSTED:
        raise JobNotExhausted(str(job_id))

    job.status = JobStatus.PENDING
    job.attempts = 0
    job.run_after = datetime.now(UTC)
    await session.flush()
    return job
