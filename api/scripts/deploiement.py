"""Migrations et jeu de données, en une commande, à distance.

Lancée depuis le shell de l'hébergeur — `python -m scripts.deploiement` — ou
localement avec la configuration qui va bien. Elle fait exactement deux choses,
dans cet ordre, et s'arrête à la première qui échoue.

**Elle dit ce qu'elle vise avant d'agir.** Un shell distant ne montre pas la
configuration ; se tromper de base se découvre alors après coup, sur une base
vide. L'hôte et le nom de la base sont écrits en premier, et le mot de passe
n'y figure jamais.

**Le jeu de données est facultatif.** Migrer ne détruit rien ; semer détruit
tout. Les réunir sans les séparer ferait effacer une base à chaque
redéploiement, et un redéploiement arrive à chaque fusion.

**Les deux chemins ne se recouvrent pas.** Le jeu de données fait table rase
puis migre lui-même : migrer avant lui revenait à construire un schéma pour le
jeter à la ligne suivante. Sans conséquence, mais deux fois plus long sur une
base distante, et une sortie où la même chaîne de migrations défile deux fois ne
se lit plus.
"""

import argparse
import asyncio
import sys

from alembic.config import Config
from sqlalchemy import make_url

from alembic import command
from app import seed
from app.core.config import API_ROOT, get_settings
from app.integrations.object_store import (
    check_object_store_configuration,
    verifier_les_deux_compartiments,
)


def cible_lisible() -> str:
    """L'hôte et la base, sans le mot de passe.

    `render_as_string` masque le mot de passe par défaut ; on ne prend malgré
    tout que les deux champs qui nous intéressent, pour qu'un copier-coller de
    journal ne transporte rien d'autre.
    """
    url = make_url(str(get_settings().database_url))
    return f"{url.host or 'local'}/{url.database}"


def migrer() -> None:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    command.upgrade(config, "head")


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument(
        "--avec-jeu-de-donnees",
        action="store_true",
        help="efface la base et la repeuple. Sans cette option, seules les migrations tournent.",
    )
    options = analyseur.parse_args()

    settings = get_settings()
    print(f"environnement : {settings.environment}")
    print(f"base          : {cible_lisible()}")

    # **Tout vérifier avant d'écrire quoi que ce soit.** Les migrations
    # tournaient d'abord et le refus arrivait après : la mauvaise base était
    # déjà migrée quand la commande disait non. Migrer ne détruit rien, mais
    # une écriture reste une écriture, et « refuse plutôt que d'agir » ne
    # souffre pas d'exception d'ordre.
    seed.verifier_l_hote(settings)
    if options.avec_jeu_de_donnees:
        seed.verifier_la_cible(settings)
        # Le jeu de données dépose des photos. Sans dépôt utilisable, il
        # échouerait **après** avoir effacé, laissant une base à moitié écrite
        # et personne pour le savoir. La vérification est celle du démarrage de
        # l'API : une seule règle, pas deux qui divergent.
        check_object_store_configuration()
        # **Et un aller-retour réel dans chaque compartiment.** La
        # configuration peut être valide et pointer à côté : deux noms posés,
        # non vides, différents, et l'un des deux inexistant. Rien ne le dit
        # avant la première lecture — qui arrive des jours plus tard, sur un
        # écran, sous la forme d'une image absente.
        asyncio.run(verifier_les_deux_compartiments())
        print(f"dépôt d'objets : {settings.object_store_provider}, deux compartiments joignables")

    if not options.avec_jeu_de_donnees:
        print("migrations…")
        migrer()
        print("migrations : à jour.")
        print("jeu de données : ignoré (passer --avec-jeu-de-donnees pour l'écrire).")
        return 0

    # Pas de `migrer()` ici : `seed.main()` fait table rase puis migre. Le
    # faire avant construirait un schéma pour le jeter à la ligne suivante.
    print("jeu de données : table rase, migrations, puis écriture…")
    return seed.main()


if __name__ == "__main__":
    sys.exit(main())
