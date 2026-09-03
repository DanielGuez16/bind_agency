"""Exécution du travail planifié.

**Une transaction par job.** C'est la propriété qui rend l'exécuteur utilisable
à plusieurs : le verrou de réclamation vit dans cette transaction, donc une
seconde exécution ne peut pas prendre un job que la première tient. Et l'échec
d'un job n'annule pas le report d'un autre — un seul `commit` global les ferait
tomber ensemble, ce qui est exactement ce qu'on ne veut pas d'une file.

**Le déclenchement est manuel dans cette tâche.** Une commande, pas une boucle
qui dort. L'ordonnanceur réel — cron, un conteneur planifié, ce que le
déploiement offrira — est une affaire d'exploitation ; l'écrire ici reviendrait
à choisir maintenant, en aveugle, et à devoir le défaire.

    python -m app.workers plan     # aligne la file sur l'état des comptes
    python -m app.workers run      # exécute ce qui est dû
"""

from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import ConfigurationError
from app.integrations.social import SocialProvider
from app.models import Job
from app.models.enums import JobStatus, Platform
from app.services import jobs as job_service
from app.workers import handlers

#: Comment obtenir le fournisseur d'une plateforme. Injecté pour que l'exécuteur
#: n'ait aucune connaissance du réseau — les tests lui passent un faux.
FournisseurPour = Callable[[Platform], SocialProvider]


@dataclass(frozen=True, slots=True)
class Bilan:
    reussis: int = 0
    reportes: int = 0
    epuises: int = 0
    retires: int = 0
    ignores: int = 0

    def plus(self, **champs: int) -> "Bilan":
        valeurs = {
            "reussis": self.reussis,
            "reportes": self.reportes,
            "epuises": self.epuises,
            "retires": self.retires,
            "ignores": self.ignores,
        }
        for nom, delta in champs.items():
            valeurs[nom] += delta
        return Bilan(**valeurs)


async def executer(
    sessions: async_sessionmaker[AsyncSession],
    *,
    fournisseur_pour: FournisseurPour,
    maximum: int = 100,
) -> Bilan:
    """Traite les jobs dus, un par transaction, jusqu'à en manquer.

    `maximum` borne un passage : sans lui, une file qui se remplit plus vite
    qu'elle ne se vide ferait tourner la commande indéfiniment, et personne ne
    saurait qu'elle ne rend plus la main.
    """
    bilan = Bilan()

    for _ in range(maximum):
        async with sessions() as session, session.begin():
            jobs = await job_service.reclamer(session, limite=1)
            if not jobs:
                return bilan
            bilan = await _traiter(session, jobs[0], fournisseur_pour, bilan)

    return bilan


async def _traiter(
    session: AsyncSession, job: Job, fournisseur_pour: FournisseurPour, bilan: Bilan
) -> Bilan:
    traitement = handlers.TRAITEMENTS.get(job.job_type)
    if traitement is None:
        # Un type sans traitement est un oubli de code, pas une donnée
        # aberrante. On l'épuise pour qu'il remonte en file d'administration
        # plutôt que de le sauter en silence à chaque passage.
        await job_service.echouer(session, job, erreur=f"aucun traitement pour {job.job_type}")
        return bilan.plus(ignores=1)

    compte = await handlers.cible(session, job)
    if compte is None:
        await job_service.deplanifier(session, target_id=job.target_id)
        return bilan.plus(retires=1)

    # **Un balayage global n'a rien à voir avec un réseau social, et ne doit
    # rien lui demander.** Sa cible est la sentinelle — voir `handlers.cible` —
    # dont le `platform` n'est qu'un champ non lu pour que l'objet existe. Avant
    # cette ligne, l'exécuteur construisait quand même un `InstagramProvider`
    # pour ce champ non lu, et sa construction **vérifie sa configuration** :
    # sans Instagram configuré, les huit balayages échouaient à ce seul appel,
    # avant même d'atteindre leur propre traitement — qui n'en avait besoin
    # nulle part. C'est resté caché tant qu'un défaut antérieur détruisait ces
    # mêmes jobs plus tôt dans la boucle ; le corriger a découvert celui-ci.
    #
    # Aucun des huit traitements de `handlers.SANS_CIBLE` ne lit `provider` —
    # vérifié sur les huit, pas supposé. Ils gardent le paramètre pour la même
    # signature que les jobs par compte, et n'en font rien.
    if job.job_type in handlers.SANS_CIBLE:
        provider = None
    else:
        try:
            provider = fournisseur_pour(compte.platform)
        except ConfigurationError as error:
            # Une plateforme non configurée fait échouer *son* job, pas le
            # passage entier. Laisser remonter arrêtait la boucle au premier
            # compte concerné et annulait sa transaction : aucun autre job
            # n'était traité, et rien n'en gardait la trace. C'est un échec
            # reportable — la configuration peut arriver entre deux passages.
            statut = await job_service.echouer(session, job, erreur=str(error))
            return bilan.plus(epuises=1 if statut is JobStatus.EXHAUSTED else 0, reportes=1)

    # **Un traitement qui lève fait échouer *son* job, pas le passage entier —
    # exactement la même garantie que ci-dessus, étendue au traitement lui-même
    # et non plus seulement au choix du fournisseur.** Mesuré en production le
    # 2026-09-03 : `vider_la_boite_d_envoi` levait à chaque appel, cette levée
    # sortait de `executer()` sans être rattrapée, et la boucle d'exécution
    # s'arrêtait là — un job voisin sans aucun défaut (`favorite_availability
    # _sweep`) restait bloqué derrière, jamais atteint, tant que le premier
    # gardait l'échéance la plus ancienne de la file.
    try:
        issue = await traitement(session, account=compte, provider=provider)
    except Exception as error:  # noqa: BLE001 - le report est la conduite voulue
        statut = await job_service.echouer(session, job, erreur=str(error))
        return bilan.plus(epuises=1 if statut is JobStatus.EXHAUSTED else 0, reportes=1)

    match issue:
        case handlers.Fait(prochain=prochain):
            await job_service.reussir(session, job, prochain=prochain)
            return bilan.plus(reussis=1)

        case handlers.Retire():
            # La raison n'est pas conservée : la ligne disparaît. Ce qui compte
            # l'est ailleurs — la bascule du compte est journalisée, et son
            # statut se lit sur le compte.
            await job_service.deplanifier(session, target_id=job.target_id)
            return bilan.plus(retires=1)

        case handlers.Echec(erreur=erreur):
            statut = await job_service.echouer(session, job, erreur=erreur)
            if statut is JobStatus.EXHAUSTED:
                return bilan.plus(epuises=1)
            return bilan.plus(reportes=1)

    raise AssertionError(f"issue inattendue : {issue!r}")  # pragma: no cover
