"""Ce qui doit être planifié, et ce qui ne doit plus l'être.

Le balayage est idempotent dans les deux sens : il crée ce qui manque, retire ce
qui n'a plus lieu d'être, et ne touche à rien d'autre. On peut le relancer autant
qu'on veut.

**Un compte `expired` ou `revoked` n'est plus planifié.** Ni renouvellement, ni
relevé : le jeton ne vaut plus rien, et marteler une porte fermée ne fait
qu'accumuler des échecs qui finiront par épuiser des jobs et remplir la file
d'administration de bruit. C'est le créateur qui rouvre la porte, en
reconnectant son compte — et le balayage suivant replanifie tout seul, parce que
la planification ne demande à personne de se souvenir de la faire.
"""

import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, SocialAccount
from app.models.enums import JobType, SocialAccountStatus
from app.services import jobs as job_service

#: Les traitements dont tout compte social actif relève.
TRAVAUX_PAR_COMPTE = (JobType.TOKEN_REFRESH, JobType.METRICS_REFRESH)


#: Cible fixe des balayages globaux. Une valeur constante et non aléatoire :
#: c'est elle qui rend la planification idempotente pour ces jobs-là.
SENTINELLE = uuid.UUID("00000000-0000-0000-0000-000000000001")

#: Balayages qui existent une fois pour toute la plateforme.
BALAYAGES = (
    JobType.BOOKING_HOLD_SWEEP,
    JobType.COLLABORATION_DEADLINE_SWEEP,
    JobType.COLLABORATION_REMINDER_SWEEP,
)


async def planifier_le_travail(session: AsyncSession) -> dict[str, int]:
    """Aligne la file sur l'état des comptes. Rend ce qui a bougé."""
    actifs = set(
        await session.scalars(
            sa.select(SocialAccount.id).where(SocialAccount.status == SocialAccountStatus.ACTIVE)
        )
    )

    crees = 0
    for balayage in BALAYAGES:
        crees += await _creer_si_absent(session, job_type=balayage, target_id=SENTINELLE)

    for compte_id in actifs:
        for travail in TRAVAUX_PAR_COMPTE:
            crees += await _creer_si_absent(session, job_type=travail, target_id=compte_id)

    # Tout job dont la cible n'est plus un compte actif : le compte a expiré,
    # a été révoqué, ou a disparu avec son créateur.
    orphelins = (
        set(
            await session.scalars(
                sa.select(Job.target_id).where(Job.job_type.in_(TRAVAUX_PAR_COMPTE)).distinct()
            )
        )
        - actifs
    )

    retires = 0
    for compte_id in orphelins:
        # `deplanifier` retire tous les jobs d'une cible : la sentinelle n'en
        # fait jamais partie, elle n'est pas un compte social.
        retires += await job_service.deplanifier(session, target_id=compte_id)

    await session.flush()
    return {"crees": crees, "retires": retires}


async def _creer_si_absent(session: AsyncSession, *, job_type: JobType, target_id) -> int:
    """Rend 1 si le job a été créé, 0 s'il existait déjà.

    Le compte se lit avant et après plutôt qu'au `rowcount` de l'insertion :
    `ON CONFLICT DO NOTHING` rapporte zéro ligne affectée, ce qui est
    indistinguable d'un échec silencieux.
    """
    avant = await session.scalar(
        sa.select(sa.func.count())
        .select_from(Job)
        .where(Job.job_type == job_type, Job.target_id == target_id)
    )
    if avant:
        return 0

    await job_service.planifier(session, job_type=job_type, target_id=target_id)
    return 1
