"""Les deux traitements planifiés de cette phase.

Un traitement ne connaît ni la file, ni le report, ni le compteur de
tentatives : il fait son travail et rend une issue. C'est l'exécuteur qui
traduit l'issue en écriture sur le job. Sans cette séparation, chaque nouveau
traitement réinventerait sa propre politique de report, et il y en aurait
autant que de traitements.

**Trois issues, pas deux.** Un traitement peut réussir, échouer de façon
passagère, ou constater qu'il n'a plus lieu d'exister. La troisième est celle
qu'on oublie : sans elle, un compte dont le jeton est définitivement refusé
serait reporté, réessayé, épuisé, puis remonterait dans la file d'administration
comme s'il y avait quelque chose à réparer — alors que la seule suite possible
est une reconnexion par le créateur.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.social import SocialAuthError, SocialProvider, SocialProviderError
from app.models import Job, SocialAccount
from app.models.enums import JobType, SocialAccountStatus
from app.services import metrics as metrics_service


@dataclass(frozen=True, slots=True)
class Fait:
    """Réussi. `prochain` est la période avant le prochain passage."""

    prochain: timedelta


@dataclass(frozen=True, slots=True)
class Echec:
    """Passager. À reporter, puis à épuiser si ça dure."""

    erreur: str


@dataclass(frozen=True, slots=True)
class Retire:
    """Ce travail n'a plus d'objet. Le job est supprimé, pas reporté.

    Réessayer ne changerait rien : ce n'est pas la plateforme qui a un problème,
    c'est la cible qui est sortie du périmètre.
    """

    raison: str


Issue = Fait | Echec | Retire


async def renouveler_le_jeton(
    session: AsyncSession, *, account: SocialAccount, provider: SocialProvider
) -> Issue:
    """Repousse l'échéance du jeton bien avant qu'elle n'arrive.

    Les jetons de longue durée Meta valent soixante jours et ne se renouvellent
    **que tant qu'ils sont valides** : passé l'échéance il n'y a plus de
    renouvellement possible, seulement une reconnexion par le créateur. D'où la
    marge — renouveler au dernier moment ne laisserait aucune seconde chance si
    Meta est indisponible ce jour-là.
    """
    settings = get_settings()
    marge = timedelta(seconds=settings.token_refresh_margin_seconds)
    periode = timedelta(seconds=settings.token_refresh_interval_seconds)

    if account.status is not SocialAccountStatus.ACTIVE or account.access_token_encrypted is None:
        return Retire(f"compte {account.status.value}")

    if account.token_expires_at is not None and account.token_expires_at - marge > datetime.now(
        UTC
    ):
        # Rien à faire aujourd'hui. Le job repasse demain : c'est le même
        # mécanisme de report, sans échec.
        return Fait(prochain=periode)

    try:
        jeton = await provider.refresh_token(
            access_token=account.access_token_encrypted,
            refresh_token=account.refresh_token_encrypted,
        )
    except SocialAuthError as error:
        # Le jeton est mort. Le compte bascule, et le job disparaît : il n'y a
        # rien à réessayer tant que le créateur n'a pas reconnecté.
        account.status = SocialAccountStatus.EXPIRED
        await session.flush()
        return Retire(f"jeton refusé : {error}")
    except SocialProviderError as error:
        # Panne d'en face. On ne bascule rien — déconnecter un compte sain sur
        # une indisponibilité de Meta ferait recommencer un parcours OAuth pour
        # rien.
        return Echec(str(error))

    account.access_token_encrypted = jeton.access_token
    account.token_expires_at = jeton.expires_at
    if jeton.refresh_token is not None:
        account.refresh_token_encrypted = jeton.refresh_token
    await session.flush()

    return Fait(prochain=periode)


async def relever_les_metriques(
    session: AsyncSession, *, account: SocialAccount, provider: SocialProvider
) -> Issue:
    """Le relevé quotidien. Le même service que le déclenchement à la demande.

    Volontairement le même : deux chemins d'écriture pour un même snapshot
    finiraient par diverger, et c'est le second qu'on oublierait de corriger.
    """
    periode = timedelta(seconds=get_settings().metrics_refresh_interval_seconds)

    try:
        await metrics_service.refresh_profile_metrics(session, account=account, provider=provider)
    except metrics_service.SocialAccountNotActive as error:
        return Retire(str(error))
    except metrics_service.SocialTokenExpired as error:
        # Le service a déjà fait basculer le compte. Rien à réessayer.
        return Retire(f"jeton refusé : {error}")
    except metrics_service.RefreshTooSoon:
        # Un relevé à la demande est passé juste avant. Ce n'est pas un échec,
        # c'est du travail déjà fait : on repasse à la période normale sans
        # incrémenter les tentatives.
        return Fait(prochain=periode)
    except SocialProviderError as error:
        return Echec(str(error))

    return Fait(prochain=periode)


#: Ce que chaque type de job sait faire. Un type absent d'ici est un job qui ne
#: tournera jamais — l'exécuteur le dit plutôt que de l'ignorer.
TRAITEMENTS = {
    JobType.TOKEN_REFRESH: renouveler_le_jeton,
    JobType.METRICS_REFRESH: relever_les_metriques,
}


async def cible(session: AsyncSession, job: Job) -> SocialAccount | None:
    """La ligne visée par le job. Les deux types de cette phase visent un compte."""
    return await session.get(SocialAccount, job.target_id)
