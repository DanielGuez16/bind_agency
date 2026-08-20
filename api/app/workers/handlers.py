"""Les traitements planifiés.

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

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.email import get_sender
from app.integrations.push import get_push_sender
from app.integrations.social import SocialAuthError, SocialProvider, SocialProviderError
from app.models import Business, Collaboration, Job, SocialAccount
from app.models.enums import JobType, Platform, SocialAccountStatus
from app.services import (
    account_deletion,
    booking_states,
    collaboration,
    grace,
    notifications,
    outbox,
    tracking,
)
from app.services import metrics as metrics_service

logger = logging.getLogger(__name__)


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


async def expirer_les_gardes(session: AsyncSession, *, account, provider) -> Issue:
    """Balayage global des gardes dépassés.

    Ne vise aucun compte : sa cible est une sentinelle. Un job par réservation
    coûterait une ligne par place tenue, pour un travail qui se fait en une
    requête.
    """
    await booking_states.expirer_les_gardes_depasses(session)
    # Le même balayage traite les demandes que le commerce n'a pas tranchées :
    # les deux libèrent une place tenue, et un second job pour la même
    # propriété se désynchroniserait du premier.
    await booking_states.expirer_les_attentes_depassees(session)
    return Fait(prochain=timedelta(seconds=get_settings().booking_sweep_interval_seconds))


async def expirer_les_echeances(session: AsyncSession, *, account, provider) -> Issue:
    """Balayage global des échéances de publication.

    Fait tomber en `unfulfilled`, jamais en `approved` : une échéance dépassée
    signifie qu'aucune publication n'a été apportée, et le commerce a donné une
    prestation contre elle.
    """
    await collaboration.expirer_les_echeances(session)
    return Fait(prochain=timedelta(seconds=get_settings().collaboration_sweep_interval_seconds))


async def appliquer_les_suppressions(session: AsyncSession, *, account, provider) -> Issue:
    """Anonymise les comptes dont le délai de trente jours est écoulé.

    Le service rejoue la garde des contreparties : un compte qui en a une
    ouverte est laissé en attente et revu au balayage suivant. C'est voulu —
    rien ne doit faire disparaître quelqu'un en laissant une publication due, et
    rien ne doit non plus annuler sa demande à sa place.
    """
    await account_deletion.appliquer_les_echeances(session)
    return Fait(prochain=timedelta(seconds=get_settings().account_deletion_sweep_interval_seconds))


async def rappeler_les_echeances(session: AsyncSession, *, account, provider) -> Issue:
    """Rappelle les échéances qui approchent.

    **Le rappel se dépose, il ne s'envoie plus ici.** Un envoi raté faisait
    échouer le balayage entier, donc le reportait — et laissait sans rappel
    toutes les échéances qui suivaient dans la même passe. Chaque message porte
    maintenant son propre report.
    """
    settings = get_settings()

    identifiants = await notifications.echeances_a_rappeler(
        session, avance_secondes=settings.collaboration_reminder_lead_seconds
    )
    for identifiant in identifiants:
        ligne = await session.get(Collaboration, identifiant)
        if ligne is None:
            continue
        contexte = await notifications.contexte_de(session, ligne)
        if contexte is None:
            continue
        # **Déposé, pas envoyé.** Les deux canaux partent du même dépôt : la
        # boîte pour la trace, l'écran verrouillé pour l'urgence. Un service
        # d'envoi injoignable reporte ce message-là et non le balayage entier,
        # qui laissait sans rappel toutes les échéances derrière lui.
        await outbox.deposer(
            session,
            user_id=contexte.user_id,
            cle="collaboration.reminder",
            creator=contexte.creator,
            business=contexte.business,
            item=contexte.item,
            deadline=contexte.deadline,
            requirements=contexte.requirements,
        )

    return Fait(prochain=timedelta(seconds=settings.collaboration_reminder_interval_seconds))


async def purger_les_clics(session: AsyncSession, *, account, provider) -> Issue:
    """Efface les empreintes échues, leur sel, et les coups écartés trop vieux.

    **C'est ce job qui rend l'oubli réel.** La fonction de purge existait avant
    lui et n'était appelée par personne : la garantie tenait alors dans une
    docstring, ce qui ne protège personne.

    Le sel parti, aucune empreinte n'est plus recalculable — même en possession
    de l'adresse d'origine, et même par nous.
    """
    await tracking.purger(session)
    return Fait(prochain=timedelta(seconds=get_settings().link_click_purge_interval_seconds))


async def _prevenir_le_commerce(
    session: AsyncSession, *, commerce: Business, cle: str, **valeurs: object
) -> None:
    """Dépose le message pour **tous les membres** du salon.

    Tous, et non le propriétaire seul : un comptoir se tient à plusieurs, et la
    personne qui a créé le compte n'est pas forcément celle qui lit ses
    messages. Chacun garde sa préférence — elle est relue au moment où le
    message sortirait, et non ici.

    Un dépôt par membre et par canal : c'est ce qui permet à l'un de recevoir
    quand l'autre a coupé, et à un envoi raté de ne reporter que le sien.
    """
    from app.models import BusinessMember

    membres = await session.scalars(
        sa.select(BusinessMember.user_id).where(BusinessMember.business_id == commerce.id)
    )
    for user_id in membres:
        await outbox.deposer(session, user_id=user_id, cle=cle, business=commerce.name, **valeurs)


async def balayer_les_periodes_de_grace(session: AsyncSession, *, account, provider) -> Issue:
    """Ouvre, avertit, et ferme les périodes de grâce d'abonnement.

    **Trois gestes dans cet ordre, et l'ordre compte.** On ouvre d'abord — un
    commerce ouvert avant ce dispositif, ou dont l'abonnement s'est arrêté, n'a
    pas d'échéance et resterait visible pour toujours sans que rien ne le
    regarde. On avertit ensuite, une seule fois. On ferme enfin.

    **Prévenir avant est la moitié de la règle.** Disparaître du fil sans
    l'avoir dit se lit comme une panne, et c'est le support qui l'apprend.

    Un envoi qui échoue fait échouer le job, donc le reporte : c'est ce qu'on
    veut d'un avertissement. Le faire réussir en silence laisserait un salon
    quitter le fil sans jamais avoir été prévenu — exactement ce que ce
    dispositif existe pour éviter.
    """
    settings = get_settings()
    maintenant = datetime.now(UTC)

    ouvertes = 0
    for identifiant in await grace.sans_echeance_ni_abonnement(session):
        commerce = await session.get(Business, identifiant)
        if commerce is not None and await grace.ouvrir(
            session, business=commerce, maintenant=maintenant
        ):
            ouvertes += 1

    averties = 0
    for identifiant in await grace.a_prevenir(session, maintenant=maintenant):
        commerce = await session.get(Business, identifiant)
        if commerce is None or commerce.grace_ends_at is None:
            continue
        echeance = commerce.grace_ends_at.astimezone(ZoneInfo(commerce.timezone)).strftime(
            "%Y-%m-%d"
        )
        await _prevenir_le_commerce(
            session,
            commerce=commerce,
            cle="subscription.graceEnding",
            echeance=echeance,
        )
        # **Écrit après l'envoi.** Le poser avant ferait passer pour prévenu un
        # salon dont le message n'est jamais parti, et le job reporté ne le
        # rattraperait plus.
        commerce.grace_warned_at = maintenant
        await session.flush()
        averties += 1

    fermees = 0
    for identifiant in await grace.echues(session, maintenant=maintenant):
        commerce = await session.get(Business, identifiant)
        if commerce is None or not await grace.fermer(
            session, business=commerce, maintenant=maintenant
        ):
            continue
        fermees += 1
        await _prevenir_le_commerce(
            session,
            commerce=commerce,
            cle="subscription.ended",
        )

    logger.info(
        "périodes de grâce : %d ouvertes, %d averties, %d fermées", ouvertes, averties, fermees
    )
    return Fait(prochain=timedelta(seconds=settings.subscription_grace_sweep_interval_seconds))


async def vider_la_boite_d_envoi(session: AsyncSession, *, account, provider) -> Issue:
    """Sort de la boîte d'envoi ce qui peut en sortir.

    **C'est ici que les messages partent, et nulle part ailleurs.** Une décision
    de réservation, une prise en main, une ouverture de reprise déposent leur
    message dans la transaction qui les écrit, puis répondent. Le message part
    d'ici, une minute plus tard au pire — et il part même si le processus qui a
    pris la décision est mort entre-temps, ce qui n'était pas le cas avant.

    Le report des échecs est celui de la boîte, pas celui du job : un service
    d'envoi injoignable ne doit pas faire échouer le balayage entier, sans quoi
    un message cassé bloquerait tous les autres derrière lui.
    """
    resultat = await outbox.vider(session, email_sender=get_sender(), push_sender=get_push_sender())
    if resultat.envoyes or resultat.ecartes or resultat.reportes:
        logger.info(
            "boîte d'envoi : %d partis, %d écartés, %d reportés",
            resultat.envoyes,
            resultat.ecartes,
            resultat.reportes,
        )
    return Fait(prochain=timedelta(seconds=get_settings().outbox_sweep_interval_seconds))


#: Ce que chaque type de job sait faire. Un type absent d'ici est un job qui ne
#: tournera jamais — l'exécuteur le dit plutôt que de l'ignorer.
TRAITEMENTS = {
    JobType.TOKEN_REFRESH: renouveler_le_jeton,
    JobType.METRICS_REFRESH: relever_les_metriques,
    JobType.BOOKING_HOLD_SWEEP: expirer_les_gardes,
    JobType.COLLABORATION_DEADLINE_SWEEP: expirer_les_echeances,
    JobType.ACCOUNT_DELETION_SWEEP: appliquer_les_suppressions,
    JobType.COLLABORATION_REMINDER_SWEEP: rappeler_les_echeances,
    JobType.LINK_CLICK_PURGE_SWEEP: purger_les_clics,
    JobType.SUBSCRIPTION_GRACE_SWEEP: balayer_les_periodes_de_grace,
    JobType.OUTBOX_SWEEP: vider_la_boite_d_envoi,
}


#: Types dont la cible n'est pas une ligne : ce sont des balayages globaux.
SANS_CIBLE = frozenset(
    {
        JobType.BOOKING_HOLD_SWEEP,
        JobType.COLLABORATION_DEADLINE_SWEEP,
        JobType.COLLABORATION_REMINDER_SWEEP,
        JobType.LINK_CLICK_PURGE_SWEEP,
        JobType.SUBSCRIPTION_GRACE_SWEEP,
        JobType.OUTBOX_SWEEP,
    }
)


async def cible(session: AsyncSession, job: Job) -> SocialAccount | None:
    """La ligne visée par le job, quand il en vise une.

    Un balayage global n'a pas de cible : rendre `None` le ferait supprimer par
    l'exécuteur, qui prend l'absence de cible pour une cible disparue.
    """
    if job.job_type in SANS_CIBLE:
        return SENTINELLE
    return await session.get(SocialAccount, job.target_id)


#: Objet-témoin pour les balayages. Il n'est jamais lu : seul le fait qu'il ne
#: soit pas `None` compte, et son `platform` sert à choisir un fournisseur qui
#: ne servira pas non plus.
SENTINELLE = SocialAccount(platform=Platform.INSTAGRAM)
