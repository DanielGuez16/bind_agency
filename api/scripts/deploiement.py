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

**La configuration vient d'un fichier nommé, ou de rien.** `--depuis` remplace
`api/.env` au lieu de s'y ajouter : une variable oubliée dans le fichier distant
ne se comble pas en silence avec celle de la machine. La commande s'arrête et
nomme ce qui manque. C'est la seule façon de garantir qu'on vise l'environnement
qu'on croit — un mélange des deux configurations n'existe nulle part.

**Les deux chemins ne se recouvrent pas.** Le jeu de données fait table rase
puis migre lui-même : migrer avant lui revenait à construire un schéma pour le
jeter à la ligne suivante. Sans conséquence, mais deux fois plus long sur une
base distante, et une sortie où la même chaîne de migrations défile deux fois ne
se lit plus.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

from alembic.config import Config
from sqlalchemy import make_url

from alembic import command
from app import seed
from app.core.config import API_ROOT
from app.integrations.object_store import (
    check_object_store_configuration,
    verifier_les_deux_compartiments,
)


def _valeurs(fichier: Path) -> dict[str, str]:
    """Les couples nom / valeur d'un fichier d'environnement, commentaires exclus."""
    valeurs: dict[str, str] = {}
    for ligne in fichier.read_text(encoding="utf-8").splitlines():
        nue = ligne.strip()
        if nue and not nue.startswith("#") and "=" in nue:
            nom, valeur = nue.split("=", 1)
            valeurs[nom.strip()] = valeur.strip()
    return valeurs


def variables_attendues(exemple: Path) -> list[str]:
    """Les noms de variables que le fichier d'exemple déclare.

    Lus dans le fichier versionné plutôt que recopiés ici : deux listes
    finiraient par diverger, et c'est celle du code qui manquerait la variable
    ajoutée au modèle.
    """
    return list(_valeurs(exemple))


def charger(fichier: Path) -> None:
    """Pose le fichier comme **la** configuration, et vérifie qu'il est complet.

    Appelé avant toute lecture des réglages : `BIND_ENV_FILE` est lu à
    l'import du module de configuration, et le poser plus tard n'aurait
    d'effet sur rien.
    """
    if not fichier.exists():
        raise SystemExit(
            f"fichier de configuration absent : {fichier}\n"
            f"le créer à partir de {fichier.with_suffix('.demo.example').name} "
            "et le remplir. Rien n'a été touché."
        )

    exemple = fichier.parent / f"{fichier.name}.example"
    valeurs = _valeurs(fichier)

    # **Le modèle versionné ne porte jamais de valeur.** Rempli à la place du
    # fichier ignoré — deux noms qui ne diffèrent que par un suffixe —, il
    # emporte des identifiants dans l'historique du dépôt, d'où rien ne les
    # sort. Le refus arrive avant la première écriture, et avant le commit.
    portees = [nom for nom, valeur in _valeurs(exemple).items() if valeur]
    if portees:
        raise SystemExit(
            f"{exemple} porte des valeurs : {', '.join(portees)}.\n"
            "Ce fichier est versionné. Les valeurs vont dans "
            f"{fichier.name}, qui est ignoré par git. Rien n'a été touché."
        )

    manquantes = [nom for nom in variables_attendues(exemple) if not valeurs.get(nom, "").strip()]
    if manquantes:
        raise SystemExit(
            f"{fichier} est incomplet : {', '.join(manquantes)}.\n"
            "Ces variables ne retombent pas sur api/.env — la commande viserait "
            "un mélange des deux. Rien n'a été touché."
        )

    os.environ["BIND_ENV_FILE"] = str(fichier)


def cible_lisible() -> str:
    """L'hôte et la base, sans le mot de passe.

    `render_as_string` masque le mot de passe par défaut ; on ne prend malgré
    tout que les deux champs qui nous intéressent, pour qu'un copier-coller de
    journal ne transporte rien d'autre.
    """
    from app.core.config import get_settings

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
    analyseur.add_argument(
        "--depuis",
        type=Path,
        default=None,
        help=(
            "fichier de configuration à utiliser à la place de api/.env. "
            "Il le remplace : une variable absente n'est pas comblée par le "
            "fichier local, elle arrête la commande."
        ),
    )
    options = analyseur.parse_args()

    if options.depuis is not None:
        charger(options.depuis)

    # Importé ici et non en tête de module : `BIND_ENV_FILE` doit être posé
    # avant la première lecture des réglages, et un import de tête la
    # déclencherait avant que `charger` n'ait rien pu faire.
    from app.core.config import get_settings

    settings = get_settings()
    print(f"environnement : {settings.environment}")
    print(f"base          : {cible_lisible()}")

    # **Tout vérifier avant d'écrire quoi que ce soit.** Les migrations
    # tournaient d'abord et le refus arrivait après : la mauvaise base était
    # déjà migrée quand la commande disait non. Migrer ne détruit rien, mais
    # une écriture reste une écriture, et « refuse plutôt que d'agir » ne
    # souffre pas d'exception d'ordre.
    try:
        seed.verifier_l_hote(settings)
        if options.avec_jeu_de_donnees:
            seed.verifier_la_cible(settings)
    except seed.SeedRefused as refus:
        # Un refus est une réponse, pas un incident : la trace d'exception le
        # faisait lire comme une panne de la commande, alors qu'elle a fait
        # exactement ce qu'on lui demande.
        print(f"refus : {refus}", file=sys.stderr)
        return 2

    if options.avec_jeu_de_donnees:
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
