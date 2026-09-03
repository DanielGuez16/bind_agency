"""Commande du travail planifié.

    python -m app.workers plan     # aligne la file sur l'état des comptes
    python -m app.workers run      # exécute ce qui est dû

Deux verbes séparés, et c'est délibéré : aligner la file est sûr et se relance
sans conséquence, exécuter parle au réseau. Les fondre en une seule commande
ferait qu'on hésiterait à lancer la première.
"""

import asyncio
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import seed
from app.core.config import ConfigurationError, get_settings
from app.integrations.instagram import InstagramProvider
from app.integrations.object_store import (
    check_object_store_configuration,
    verifier_les_deux_compartiments,
)
from app.integrations.social import SocialProvider
from app.models.enums import Platform
from app.workers import runner, scheduler

USAGE = "usage : python -m app.workers [plan|run|boucle]"


def _fournisseurs(client: httpx.AsyncClient):
    """Un fournisseur par plateforme, construit à la demande.

    Une plateforme non configurée lève à la construction plutôt que d'échouer
    plus loin, chez elle, avec un message à elle. Le job concerné sera reporté
    comme n'importe quel échec, ce qui est le bon comportement : la
    configuration peut arriver entre deux passages.
    """

    def pour(platform: Platform) -> SocialProvider:
        if platform is Platform.INSTAGRAM:
            return InstagramProvider(client)
        raise ConfigurationError(f"aucun fournisseur pour {platform.value}")

    return pour


async def _plan() -> str:
    engine = create_async_engine(str(get_settings().database_url))
    try:
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as session, session.begin():
            bilan = await scheduler.planifier_le_travail(session)
        return f"{bilan['crees']} job(s) créé(s), {bilan['retires']} retiré(s)."
    finally:
        await engine.dispose()


async def _run() -> str:
    engine = create_async_engine(str(get_settings().database_url))
    try:
        async with httpx.AsyncClient() as client:
            bilan = await runner.executer(
                async_sessionmaker(engine, expire_on_commit=False),
                fournisseur_pour=_fournisseurs(client),
            )
        return (
            f"{bilan.reussis} réussi(s), {bilan.reportes} reporté(s), "
            f"{bilan.epuises} épuisé(s), {bilan.retires} retiré(s)."
        )
    finally:
        await engine.dispose()


#: Le fuseau sur lequel se lit l'heure du semis. Celui des commerces du jeu de
#: démonstration, tous à Miami : « quatre heures du matin » ne veut rien dire
#: sur le fuseau du serveur, qui est à Oregon et change avec l'hébergeur.
FUSEAU_DE_LA_DEMONSTRATION = ZoneInfo("America/New_York")


def _maintenant_a_miami() -> datetime:
    return datetime.now(FUSEAU_DE_LA_DEMONSTRATION)


def _jour_deja_seme(maintenant: datetime, *, heure: int | None) -> date:
    """Le jour à considérer comme déjà semé au démarrage du service.

    Aujourd'hui si l'heure du semis est passée, la veille sinon. Poser
    aujourd'hui dans les deux cas ferait attendre vingt-cinq heures à un service
    redémarré à trois heures du matin ; poser la veille dans les deux cas le
    ferait semer dans la minute à chaque redéploiement de la journée.
    """
    if heure is None or maintenant.hour >= heure:
        return maintenant.date()
    return maintenant.date() - timedelta(days=1)


def _doit_semer(maintenant: datetime, *, heure: int | None, dernier_jour: date) -> bool:
    """L'heure est venue, et ce jour-là n'a pas encore été semé.

    Les deux conditions, pas une : l'heure seule sèmerait à chaque tour de
    trente secondes pendant toute l'heure qui suit.
    """
    return heure is not None and maintenant.hour >= heure and maintenant.date() > dernier_jour


async def _semer_a_nouveau() -> str:
    """Table rase, migrations, puis le jeu de démonstration. **Tout est effacé.**

    **Ce n'est pas un job de la file, et ça ne peut pas l'être.** Un traitement
    tourne dans une transaction qui tient déjà un verrou sur la ligne de son
    propre job ; le semis commence par `DROP TABLE jobs CASCADE`, qui demande un
    verrou exclusif sur cette même table. Le job attendrait sa propre
    transaction, indéfiniment. Le semis vit donc dans la boucle, entre deux
    passages, quand plus rien n'est réclamé.

    **Les mêmes vérifications que `scripts.deploiement`, dans le même ordre, et
    pour les mêmes raisons.** `verifier_la_cible` refuse un environnement qui
    n'est pas celui de démonstration, une base locale, ou une base que
    `SEED_DATABASE_NAME` ne nomme pas — trois façons d'effacer ce qu'on ne
    voulait pas. Le dépôt d'objets se vérifie ensuite parce que le semis y
    dépose des photos : sans dépôt joignable il échouerait **après** avoir
    effacé, et laisserait une base à moitié écrite.
    """
    settings = get_settings()
    seed.verifier_la_cible(settings)
    check_object_store_configuration()
    await verifier_les_deux_compartiments()

    # `reset_schema` est synchrone — psycopg puis alembic — et tient la boucle
    # plusieurs dizaines de secondes. Dans un thread, sinon rien d'autre ne
    # tourne pendant les migrations.
    await asyncio.to_thread(seed.reset_schema)
    resume = await seed.populate()
    return (
        f"semis de démonstration : {resume.commerces} commerces, "
        f"{resume.createurs} créateurs, {resume.contreparties} contreparties. "
        "Tout ce qui existait avant a été effacé."
    )


async def _boucle() -> str:
    """Planifie, puis exécute sans fin. **C'est le mode du service de fond.**

    `run` fait un passage et rend la main : c'est ce qu'il faut à un cron, et
    c'est exactement ce qu'un service de fond ne supporte pas — il redémarrerait
    en boucle d'échec, et l'hébergeur finirait par le déclarer mort.

    **La planification est refaite à chaque tour, pas seulement au démarrage.**
    Un compte social qui s'active pendant que le service tourne doit gagner ses
    travaux sans qu'on redéploie ; et les balayages globaux se recréent d'eux-
    mêmes si quelque chose les a retirés.

    **Une erreur ne tue pas la boucle.** Un passage qui lève — la base qui
    redémarre, un fournisseur injoignable — est écrit puis oublié : la file est
    reprise au tour suivant, et rien n'est perdu puisque rien n'a été acquitté.
    Laisser remonter arrêterait l'envoi des emails jusqu'au prochain
    déploiement.

    **Le semis de démonstration se replante ici, une fois par nuit, si on l'a
    demandé.** Inerte tant que `DEMO_RESEED_HOUR` est vide, ce qui est le
    défaut : voir `_semer_a_nouveau`, qui efface tout avant d'écrire.
    """
    settings = get_settings()
    repos = settings.worker_loop_seconds
    heure_du_semis = settings.demo_reseed_hour

    # **Le jour en cours compte comme déjà semé si son heure est passée.** Sans
    # cette nuance, un service redémarré à six heures du matin sèmerait dans la
    # minute — et un redéploiement arrive à chaque fusion sur `main`, donc en
    # pleine journée. Redémarré *avant* l'heure, il sème le jour même : c'est la
    # même règle, prise dans l'autre sens.
    dernier_jour = _jour_deja_seme(_maintenant_a_miami(), heure=heure_du_semis)

    while True:
        try:
            maintenant = _maintenant_a_miami()
            if _doit_semer(maintenant, heure=heure_du_semis, dernier_jour=dernier_jour):
                # Posé **avant** l'appel : un semis qui échoue ne doit pas être
                # retenté à chaque tour de trente secondes jusqu'au matin. Il
                # repart la nuit suivante, comme s'il avait réussi.
                dernier_jour = maintenant.date()
                print(await _semer_a_nouveau(), flush=True)
            print(await _plan(), flush=True)
            print(await _run(), flush=True)
        except Exception as erreur:  # noqa: BLE001 - la boucle survit à tout
            print(f"passage en échec, repris au suivant : {erreur}", file=sys.stderr, flush=True)
        await asyncio.sleep(repos)


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in ("plan", "run", "boucle"):
        print(USAGE, file=sys.stderr)
        return 2

    if argv[1] == "boucle":
        asyncio.run(_boucle())
        return 0

    print(asyncio.run(_plan() if argv[1] == "plan" else _run()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
