"""Travail planifié : file, report, épuisement, concurrence.

Le test qui compte est le dernier : deux exécutions concurrentes ne traitent
jamais le même job. Il ne se joue pas sur la transaction partagée des autres
tests — il lui faut deux vraies connexions, sans quoi `FOR UPDATE SKIP LOCKED`
n'aurait rien à sauter et le test passerait sans rien prouver.

Les autres portent sur ce qui reste écrit quand un traitement échoue, et sur la
distinction entre « la plateforme est en panne » et « ce compte n'a plus rien à
faire ici ».
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import ConfigurationError, get_settings
from app.integrations.social import (
    JetonEchange,
    SocialAuthError,
    SocialProvider,
    SocialProviderError,
)
from app.models import Job, SocialAccount
from app.models.enums import (
    JobStatus,
    JobType,
    Platform,
    SocialAccountStatus,
    UserRole,
    VerificationStatus,
)
from app.services import auth as auth_service
from app.services import jobs as service
from app.workers import handlers, runner, scheduler
from tests.factories import new_creator, new_social_account
from tests.test_social_metrics import FauxFournisseur, metriques

PREFIX = get_settings().api_v1_prefix


# --------------------------------------------------------------------------
# harnais
# --------------------------------------------------------------------------


class FauxRenouvellement:
    """Fournisseur programmable pour le renouvellement de jeton."""

    platform = Platform.INSTAGRAM

    def __init__(self, *, rend: JetonEchange | None = None, leve: Exception | None = None):
        self.rend = rend
        self.leve = leve
        self.appels = 0

    async def refresh_token(self, *, access_token: str, refresh_token: str | None = None):
        self.appels += 1
        if self.leve is not None:
            raise self.leve
        return self.rend or JetonEchange(
            access_token="jeton-renouvele", expires_at=datetime.now(UTC) + timedelta(days=60)
        )


def toujours(provider) -> runner.FournisseurPour:
    """Le même fournisseur quelle que soit la plateforme."""
    return lambda platform: provider


async def creer_compte(session: AsyncSession, **overrides) -> SocialAccount:
    user = await auth_service.register(
        session,
        email=f"{uuid.uuid4()}@example.com",
        password="un-mot-de-passe-solide-42",
        role=UserRole.CREATOR,
    )
    valeurs = {
        "creator_id": user.id,
        "platform": Platform.INSTAGRAM,
        "external_id": f"1784140{uuid.uuid4().int % 10**10}",
        "handle": "compte.dessai",
        "access_token_encrypted": "IGQVJXY-jeton",
        "status": SocialAccountStatus.ACTIVE,
        "verification_status": VerificationStatus.VERIFIED,
        # Échéance dans deux jours : sous la marge de sept jours, donc le
        # renouvellement a quelque chose à faire.
        "token_expires_at": datetime.now(UTC) + timedelta(days=2),
    }
    compte = SocialAccount(**(valeurs | overrides))
    session.add(compte)
    await session.flush()
    return compte


async def job_de(session: AsyncSession, compte: SocialAccount, job_type: JobType) -> Job:
    await service.planifier(session, job_type=job_type, target_id=compte.id)
    await session.flush()
    return await session.scalar(
        sa.select(Job).where(Job.job_type == job_type, Job.target_id == compte.id)
    )


async def traiter(
    session: AsyncSession, job: Job, provider, *, bilan: runner.Bilan | None = None
) -> runner.Bilan:
    """Traite un job sans passer par la boucle, qui ouvre ses propres sessions.

    La boucle est éprouvée séparément, par le test de concurrence.
    """
    return await runner._traiter(  # noqa: SLF001 - accès assumé au harnais
        session, job, toujours(provider), bilan or runner.Bilan()
    )


# --------------------------------------------------------------------------
# planification
# --------------------------------------------------------------------------


async def test_la_planification_est_idempotente(session: AsyncSession) -> None:
    compte = await creer_compte(session)

    premier = await scheduler.planifier_le_travail(session)
    second = await scheduler.planifier_le_travail(session)

    assert premier["crees"] == 2  # renouvellement et relevé
    assert second["crees"] == 0

    combien = await session.scalar(
        sa.select(sa.func.count()).select_from(Job).where(Job.target_id == compte.id)
    )
    assert combien == 2


async def test_un_compte_expired_n_est_plus_planifie(session: AsyncSession) -> None:
    """Inutile de marteler une porte fermée."""
    compte = await creer_compte(session)
    await scheduler.planifier_le_travail(session)
    assert await session.scalar(
        sa.select(sa.func.count()).select_from(Job).where(Job.target_id == compte.id)
    )

    compte.status = SocialAccountStatus.EXPIRED
    await session.flush()

    bilan = await scheduler.planifier_le_travail(session)

    assert bilan["retires"] == 2
    assert (
        await session.scalar(
            sa.select(sa.func.count()).select_from(Job).where(Job.target_id == compte.id)
        )
        == 0
    )

    # Et il ne se replanifie pas au passage suivant, tant qu'il est fermé.
    await scheduler.planifier_le_travail(session)
    assert (
        await session.scalar(
            sa.select(sa.func.count()).select_from(Job).where(Job.target_id == compte.id)
        )
        == 0
    )


async def test_un_compte_reconnecte_est_replanifie(session: AsyncSession) -> None:
    """Le pendant du test précédent. Une planification qui ne sait que retirer
    passerait le test de retrait sans rien garantir."""
    compte = await creer_compte(session, status=SocialAccountStatus.EXPIRED)
    await scheduler.planifier_le_travail(session)
    assert (
        await session.scalar(
            sa.select(sa.func.count()).select_from(Job).where(Job.target_id == compte.id)
        )
        == 0
    )

    compte.status = SocialAccountStatus.ACTIVE
    await session.flush()
    await scheduler.planifier_le_travail(session)

    assert (
        await session.scalar(
            sa.select(sa.func.count()).select_from(Job).where(Job.target_id == compte.id)
        )
        == 2
    )


async def test_la_planification_ne_ressuscite_pas_un_job_epuise(session: AsyncSession) -> None:
    """Un balayage qui réactiverait ce qu'un administrateur n'a pas encore
    regardé annulerait tout l'intérêt de l'épuisement."""
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.METRICS_REFRESH)
    job.status = JobStatus.EXHAUSTED
    job.attempts = get_settings().job_max_attempts
    await session.flush()

    await scheduler.planifier_le_travail(session)
    await session.refresh(job)

    assert job.status is JobStatus.EXHAUSTED
    assert job.attempts == get_settings().job_max_attempts


# --------------------------------------------------------------------------
# report et épuisement
# --------------------------------------------------------------------------


def test_le_delai_de_report_croit_et_plafonne() -> None:
    settings = get_settings()

    delais = [service.delai_de_report(n, settings).total_seconds() for n in range(1, 12)]

    # Strictement croissant tant que le plafond n'est pas atteint.
    montee = [d for d in delais if d < settings.job_retry_max_seconds]
    assert montee == sorted(montee)
    assert len(set(montee)) == len(montee)

    # Et plafonné : sans cela la dixième tentative tomberait dans plusieurs
    # semaines, et un compte se réparerait après que le créateur a renoncé.
    assert max(delais) == settings.job_retry_max_seconds
    assert delais[-1] == settings.job_retry_max_seconds


async def test_un_echec_transitoire_reporte_sans_rien_basculer(session: AsyncSession) -> None:
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.TOKEN_REFRESH)
    provider = FauxRenouvellement(leve=SocialProviderError("Instagram injoignable"))

    avant = job.run_after
    bilan = await traiter(session, job, provider)

    assert bilan.reportes == 1
    assert job.status is JobStatus.PENDING
    assert job.attempts == 1
    assert job.run_after > avant
    assert job.last_error
    # Une panne d'en face ne déconnecte pas un compte sain.
    assert compte.status is SocialAccountStatus.ACTIVE
    assert compte.access_token_encrypted == "IGQVJXY-jeton"


async def test_le_job_s_arrete_apres_le_nombre_de_tentatives(
    session: AsyncSession, client: AsyncClient
) -> None:
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.TOKEN_REFRESH)
    provider = FauxRenouvellement(leve=SocialProviderError("Instagram injoignable"))

    maximum = get_settings().job_max_attempts
    for tentative in range(maximum):
        job.run_after = datetime.now(UTC) - timedelta(seconds=1)
        await traiter(session, job, provider)
        assert job.attempts == tentative + 1

    assert job.status is JobStatus.EXHAUSTED
    # Il ne repart pas seul : la réclamation ne le voit plus.
    assert await service.reclamer(session, limite=10) == []

    # Et il est visible, avec la raison de son abandon.
    epuises = await service.epuises(session)
    assert job.id in {j.id for j in epuises}
    assert next(j for j in epuises if j.id == job.id).last_error


async def test_un_job_epuise_se_rearme(session: AsyncSession) -> None:
    """Sans ce geste, s'arrêter reviendrait à abandonner.

    Ce test a été intermittent une fois : `run_after` était posé depuis
    l'horloge du processus et comparé à `clock_timestamp()` par la réclamation.
    Quelques millisecondes d'avance suffisaient pour que le job réarmé ne soit
    pas encore dû. Toutes les échéances sont désormais calculées par la base.
    """
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.TOKEN_REFRESH)
    job.status = JobStatus.EXHAUSTED
    job.attempts = 5
    await session.flush()

    await service.rearmer(session, job.id)

    assert job.status is JobStatus.PENDING
    assert job.attempts == 0
    # Immédiatement dû, à l'horloge de la base et non à celle du processus.
    assert job.run_after <= await session.scalar(sa.select(sa.func.clock_timestamp()))
    assert job.id in {j.id for j in await service.reclamer(session, limite=10)}


async def test_rearmer_un_job_en_attente_est_refuse(session: AsyncSession) -> None:
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.TOKEN_REFRESH)

    with pytest.raises(service.JobNotExhausted):
        await service.rearmer(session, job.id)

    # La session reste utilisable, et le job n'a pas bougé.
    assert job.status is JobStatus.PENDING
    assert job.attempts == 0


# --------------------------------------------------------------------------
# renouvellement de jeton
# --------------------------------------------------------------------------


async def test_le_jeton_est_renouvele_avant_l_echeance(session: AsyncSession) -> None:
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.TOKEN_REFRESH)
    provider = FauxRenouvellement()

    bilan = await traiter(session, job, provider)

    assert bilan.reussis == 1
    assert provider.appels == 1
    assert compte.access_token_encrypted == "jeton-renouvele"
    assert compte.token_expires_at > datetime.now(UTC) + timedelta(days=50)
    # Reprogrammé, pas consommé : la ligne est le travail, pas son occurrence.
    assert job.status is JobStatus.PENDING
    assert job.attempts == 0
    assert job.run_after > datetime.now(UTC)


async def test_un_jeton_loin_de_l_echeance_n_est_pas_touche(session: AsyncSession) -> None:
    """La marge sert à avoir une seconde chance, pas à renouveler tous les jours."""
    compte = await creer_compte(session, token_expires_at=datetime.now(UTC) + timedelta(days=59))
    job = await job_de(session, compte, JobType.TOKEN_REFRESH)
    provider = FauxRenouvellement()

    bilan = await traiter(session, job, provider)

    assert bilan.reussis == 1
    assert provider.appels == 0
    assert compte.access_token_encrypted == "IGQVJXY-jeton"


async def test_un_refus_d_authentification_bascule_le_compte_et_retire_le_job(
    session: AsyncSession,
) -> None:
    """Le jeton est mort : réessayer ne changerait rien, seule une reconnexion
    par le créateur rouvre la porte."""
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.TOKEN_REFRESH)
    job_id = job.id
    provider = FauxRenouvellement(leve=SocialAuthError("jeton refusé"))

    bilan = await traiter(session, job, provider)

    assert bilan.retires == 1
    assert bilan.reportes == 0
    assert compte.status is SocialAccountStatus.EXPIRED
    # Non reporté : la ligne a disparu, elle n'attend rien de personne.
    assert await session.get(Job, job_id) is None


async def test_un_compte_devenu_inactif_retire_son_job_de_relevé(
    session: AsyncSession,
) -> None:
    compte = await creer_compte(session, status=SocialAccountStatus.REVOKED)
    job = await job_de(session, compte, JobType.METRICS_REFRESH)
    job_id = job.id

    bilan = await traiter(session, job, FauxFournisseur(rend=metriques()))

    assert bilan.retires == 1
    assert await session.get(Job, job_id) is None


async def test_un_job_dont_la_cible_a_disparu_est_retire(session: AsyncSession) -> None:
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.METRICS_REFRESH)
    job_id, compte_id = job.id, compte.id

    await session.delete(compte)
    await session.flush()

    bilan = await traiter(session, job, FauxFournisseur(rend=metriques()))

    assert bilan.retires == 1
    assert await session.get(Job, job_id) is None
    assert (
        await session.scalar(
            sa.select(sa.func.count()).select_from(Job).where(Job.target_id == compte_id)
        )
        == 0
    )


# --------------------------------------------------------------------------
# relevé planifié
# --------------------------------------------------------------------------


async def test_le_releve_planifie_ecrit_un_snapshot(session: AsyncSession) -> None:
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.METRICS_REFRESH)

    bilan = await traiter(session, job, FauxFournisseur(rend=metriques()))

    assert bilan.reussis == 1
    assert compte.last_synced_at is not None
    assert job.run_after > datetime.now(UTC) + timedelta(hours=23)


async def test_un_releve_deja_fait_a_la_demande_n_est_pas_un_echec(
    session: AsyncSession,
) -> None:
    """C'est du travail déjà fait, pas une panne : les tentatives ne bougent pas."""
    compte = await creer_compte(session, last_synced_at=datetime.now(UTC))
    job = await job_de(session, compte, JobType.METRICS_REFRESH)
    provider = FauxFournisseur(rend=metriques())

    bilan = await traiter(session, job, provider)

    assert bilan.reussis == 1
    assert provider.appels == 0
    assert job.attempts == 0


async def test_une_tentative_echouee_consomme_la_borne_de_frequence(
    session: AsyncSession,
) -> None:
    """La porte laissée ouverte à la tâche précédente.

    La borne se lisait sur le dernier succès : un relevé qui échoue ne
    consommait rien, donc il suffisait d'échouer pour pouvoir recommencer
    aussitôt, en boucle. Elle se lit maintenant sur la dernière tentative.
    """
    from app.services import metrics as metrics_service

    compte = await creer_compte(session)

    with pytest.raises(SocialProviderError):
        await metrics_service.refresh_profile_metrics(
            session, account=compte, provider=FauxFournisseur(leve=SocialProviderError("panne"))
        )

    assert compte.last_synced_at is None
    assert compte.last_sync_attempt_at is not None

    # La seconde tentative est refusée, alors qu'aucune n'a réussi.
    with pytest.raises(metrics_service.RefreshTooSoon):
        await metrics_service.refresh_profile_metrics(
            session, account=compte, provider=FauxFournisseur(rend=metriques())
        )


# --------------------------------------------------------------------------
# concurrence — le test qui compte
# --------------------------------------------------------------------------


class FournisseurQuiAttend:
    """Retient le traitement le temps qu'une seconde exécution passe.

    Sans ce blocage, les deux exécutions se succéderaient au lieu de se
    chevaucher, et le test passerait même sans verrou.
    """

    platform = Platform.INSTAGRAM

    def __init__(self) -> None:
        self.entre = asyncio.Event()
        self.liberer = asyncio.Event()
        self.appels = 0

    async def refresh_token(self, *, access_token: str, refresh_token: str | None = None):
        self.appels += 1
        self.entre.set()
        await self.liberer.wait()
        return JetonEchange(
            access_token="jeton-renouvele", expires_at=datetime.now(UTC) + timedelta(days=60)
        )


async def test_deux_executions_concurrentes_ne_traitent_pas_le_meme_job(
    engine: AsyncEngine,
) -> None:
    """Un verrou, pas une convention.

    Ce test ne peut pas se jouer sur la transaction partagée des autres : il lui
    faut deux connexions réelles, sinon `FOR UPDATE SKIP LOCKED` n'a rien à
    sauter et le test passerait sans rien prouver. Il écrit donc pour de bon, et
    nettoie derrière lui.

    Les lignes sont posées par insertion directe et non par `register` : ce
    dernier écrit une ligne de journal, et `audit_log` est immuable — le ménage
    ne pourrait plus la retirer, et les rangs laissés fausseraient les tests de
    planification qui comptent tous les comptes actifs.
    """
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    lent = FournisseurQuiAttend()
    rapide = FauxRenouvellement()

    async with engine.begin() as conn:
        creator_id = await new_creator(conn)
        compte_id = await new_social_account(
            conn,
            creator_id,
            access_token_encrypted="IGQVJXY-jeton",
            status=SocialAccountStatus.ACTIVE,
            token_expires_at=datetime.now(UTC) + timedelta(days=2),
        )
        await conn.execute(
            sa.insert(Job).values(job_type=JobType.TOKEN_REFRESH, target_id=compte_id)
        )

    try:
        premiere = asyncio.create_task(
            runner.executer(sessions, fournisseur_pour=toujours(lent), maximum=1)
        )
        # On n'entre dans la seconde exécution qu'une fois la première dans le
        # traitement, donc son job verrouillé.
        await asyncio.wait_for(lent.entre.wait(), timeout=10)

        # Sous délai, et c'est ce qui rend le test concluant : sans
        # `SKIP LOCKED`, la seconde exécution *attendrait* le verrou de la
        # première, qui attend elle-même que la seconde ait fini. Le test se
        # bloquerait au lieu d'échouer, et un blocage en intégration continue
        # ne dit rien à personne.
        seconde = await asyncio.wait_for(
            runner.executer(sessions, fournisseur_pour=toujours(rapide), maximum=5), timeout=15
        )

        lent.liberer.set()
        premiere_bilan = await asyncio.wait_for(premiere, timeout=10)

        # La seconde n'a rien trouvé : le seul job dû était verrouillé, et
        # `SKIP LOCKED` la fait passer son chemin au lieu de l'attendre.
        assert seconde.reussis == 0
        assert rapide.appels == 0
        # La première l'a traité, une seule fois.
        assert premiere_bilan.reussis == 1
        assert lent.appels == 1

        async with engine.connect() as verif:
            job = (await verif.execute(sa.select(Job).where(Job.target_id == compte_id))).one()
            assert job.attempts == 0
            assert job.run_after > datetime.now(UTC)
    finally:
        async with engine.begin() as menage:
            await menage.execute(sa.delete(Job).where(Job.target_id == compte_id))
            await menage.execute(sa.delete(SocialAccount).where(SocialAccount.id == compte_id))
            await menage.execute(
                sa.text("DELETE FROM creator_profile WHERE user_id = :u"), {"u": creator_id}
            )
            await menage.execute(sa.text("DELETE FROM app_user WHERE id = :u"), {"u": creator_id})


async def test_le_verrou_ne_bloque_pas_les_autres_jobs(engine: AsyncEngine) -> None:
    """Le pendant du test précédent, et il compte autant.

    `SKIP LOCKED` doit faire *sauter* la ligne verrouillée, pas arrêter la file.
    Un verrou qui bloquerait tout passerait le test de non-doublon en ne
    traitant jamais rien à deux, et transformerait chaque job lent en arrêt de
    la file entière.
    """
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    lent = FournisseurQuiAttend()
    rapide = FauxRenouvellement()

    async with engine.begin() as conn:
        creator_id = await new_creator(conn)
        comptes = []
        for _ in range(2):
            compte_id = await new_social_account(
                conn,
                creator_id,
                access_token_encrypted="IGQVJXY-jeton",
                status=SocialAccountStatus.ACTIVE,
                token_expires_at=datetime.now(UTC) + timedelta(days=2),
            )
            await conn.execute(
                sa.insert(Job).values(job_type=JobType.TOKEN_REFRESH, target_id=compte_id)
            )
            comptes.append(compte_id)

    try:
        premiere = asyncio.create_task(
            runner.executer(sessions, fournisseur_pour=toujours(lent), maximum=1)
        )
        await asyncio.wait_for(lent.entre.wait(), timeout=10)

        seconde = await asyncio.wait_for(
            runner.executer(sessions, fournisseur_pour=toujours(rapide), maximum=5), timeout=15
        )

        lent.liberer.set()
        premiere_bilan = await asyncio.wait_for(premiere, timeout=10)

        # Chacune a traité un job, et pas le même : deux au total, pas trois.
        assert premiere_bilan.reussis == 1
        assert seconde.reussis == 1
        assert lent.appels == 1
        assert rapide.appels == 1
    finally:
        async with engine.begin() as menage:
            await menage.execute(sa.delete(Job).where(Job.target_id.in_(comptes)))
            await menage.execute(sa.delete(SocialAccount).where(SocialAccount.id.in_(comptes)))
            await menage.execute(
                sa.text("DELETE FROM creator_profile WHERE user_id = :u"), {"u": creator_id}
            )
            await menage.execute(sa.text("DELETE FROM app_user WHERE id = :u"), {"u": creator_id})


# --------------------------------------------------------------------------
# routes d'administration
# --------------------------------------------------------------------------


async def test_la_file_des_jobs_epuises_est_reservee_aux_administrateurs(
    client: AsyncClient,
) -> None:
    async def connecte(role: UserRole) -> dict:
        email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
        await client.post(
            f"{PREFIX}/auth/register",
            json={"email": email, "password": password, "role": role.value},
        )
        jetons = (
            await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
        ).json()
        return {"headers": {"Authorization": f"Bearer {jetons['access_token']}"}}

    createur = await connecte(UserRole.CREATOR)
    assert (await client.get(f"{PREFIX}/admin/jobs/exhausted", **createur)).status_code == 403

    admin = await connecte(UserRole.ADMIN)
    assert (await client.get(f"{PREFIX}/admin/jobs/exhausted", **admin)).status_code == 200


async def test_la_route_de_reprise_refuse_un_job_en_attente(
    client: AsyncClient, session: AsyncSession
) -> None:
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.TOKEN_REFRESH)
    await session.commit()

    email, password = f"{uuid.uuid4()}@example.com", "un-mot-de-passe-solide-42"
    await client.post(
        f"{PREFIX}/auth/register",
        json={"email": email, "password": password, "role": UserRole.ADMIN.value},
    )
    jetons = (
        await client.post(f"{PREFIX}/auth/login", json={"email": email, "password": password})
    ).json()
    entetes = {"Authorization": f"Bearer {jetons['access_token']}"}

    refus = await client.post(f"{PREFIX}/admin/jobs/{job.id}/retry", headers=entetes)
    assert refus.status_code == 409
    assert refus.json()["detail"] == "job_not_exhausted"

    introuvable = await client.post(f"{PREFIX}/admin/jobs/{uuid.uuid4()}/retry", headers=entetes)
    assert introuvable.status_code == 404


async def test_une_plateforme_non_configuree_n_arrete_pas_le_passage(
    engine: AsyncEngine,
) -> None:
    """Trouvé en lançant la commande pour de vrai.

    Le fournisseur refuse d'exister quand l'application Meta n'est pas déclarée.
    Cette erreur remontait jusqu'à la boucle : elle arrêtait le passage au
    premier compte concerné **et** annulait sa transaction, si bien qu'aucun
    autre job n'était traité et que rien n'en gardait la trace. Une commande
    lancée sur un environnement sans clés ne faisait donc rien, sans rien dire.
    """
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    def refuse(platform):
        raise ConfigurationError("application Instagram non configurée")

    async with engine.begin() as conn:
        creator_id = await new_creator(conn)
        comptes = []
        for _ in range(3):
            compte_id = await new_social_account(
                conn,
                creator_id,
                access_token_encrypted="IGQVJXY-jeton",
                status=SocialAccountStatus.ACTIVE,
                token_expires_at=datetime.now(UTC) + timedelta(days=2),
            )
            await conn.execute(
                sa.insert(Job).values(job_type=JobType.TOKEN_REFRESH, target_id=compte_id)
            )
            comptes.append(compte_id)

    try:
        bilan = await runner.executer(sessions, fournisseur_pour=refuse, maximum=10)

        # Les trois sont traités, pas seulement le premier.
        assert bilan.reportes == 3

        async with engine.connect() as verif:
            lignes = (
                await verif.execute(
                    sa.select(Job.attempts, Job.last_error).where(Job.target_id.in_(comptes))
                )
            ).all()

        assert len(lignes) == 3
        for ligne in lignes:
            # Et chacun garde la trace de ce qui l'a empêché.
            assert ligne.attempts == 1
            assert "non configurée" in ligne.last_error
    finally:
        async with engine.begin() as menage:
            await menage.execute(sa.delete(Job).where(Job.target_id.in_(comptes)))
            await menage.execute(sa.delete(SocialAccount).where(SocialAccount.id.in_(comptes)))
            await menage.execute(
                sa.text("DELETE FROM creator_profile WHERE user_id = :u"), {"u": creator_id}
            )
            await menage.execute(sa.text("DELETE FROM app_user WHERE id = :u"), {"u": creator_id})


async def test_un_type_de_job_sans_traitement_est_epuise_pas_ignore(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un job sauté en silence à chaque passage ne se découvre jamais."""
    compte = await creer_compte(session)
    job = await job_de(session, compte, JobType.METRICS_REFRESH)

    monkeypatch.setattr(handlers, "TRAITEMENTS", {})

    bilan = await traiter(session, job, FauxFournisseur(rend=metriques()))

    assert bilan.ignores == 1
    assert job.attempts == 1
    assert job.last_error


def test_le_fournisseur_reel_porte_toute_l_interface() -> None:
    """Les faux de ce fichier n'implémentent qu'une opération chacun, et c'est
    délibéré. Ce test dit où se vérifie l'interface complète."""
    from app.integrations.instagram import InstagramProvider

    attendues = {
        nom
        for nom in dir(SocialProvider)
        if not nom.startswith("_") and callable(getattr(SocialProvider, nom, None))
    }
    assert "refresh_token" in attendues
    for operation in attendues:
        assert hasattr(InstagramProvider, operation), operation
