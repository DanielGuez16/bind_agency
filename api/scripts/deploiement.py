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
"""

import argparse
import sys

from alembic.config import Config
from sqlalchemy import make_url

from alembic import command
from app.core.config import API_ROOT, get_settings


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

    print("migrations…")
    migrer()
    print("migrations : à jour.")

    if not options.avec_jeu_de_donnees:
        print("jeu de données : ignoré (passer --avec-jeu-de-donnees pour l'écrire).")
        return 0

    # Importé ici et non en tête : le module de jeu de données tire tout le
    # modèle et ses services, ce qui n'a pas lieu d'être quand on ne fait que
    # migrer. Ses propres garde-fous s'appliquent — il refuse une base qu'il
    # n'a pas le droit de détruire, et il le vérifie deux fois.
    from app import seed

    print("jeu de données : effacement puis écriture…")
    return seed.main()


if __name__ == "__main__":
    sys.exit(main())
