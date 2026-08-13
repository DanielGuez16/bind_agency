"""Tout réglage est documenté dans `.env.example`.

**Le défaut que ce fichier répare.** Trente-quatre réglages sur cent dix n'y
figuraient pas — dont plusieurs ajoutés récemment, par moi. Chacun a une valeur
par défaut dans le code, donc rien ne cassait : le produit tournait, et la seule
façon de savoir qu'un délai était réglable était de lire `config.py`.

C'est le genre de dette qui ne fait jamais mal une bonne fois : elle fait perdre
une heure à chaque fois que quelqu'un cherche « comment allonger la garde de
réservation » et conclut que ce n'est pas réglable.

**La liste d'exclusion porte ses raisons.** Trois champs n'ont rien à faire dans
un fichier d'exemple, et le dire ici est ce qui empêche d'y ranger un quatrième
pour éviter d'écrire une ligne.
"""

import pathlib
import re

from app.core.config import API_ROOT, Settings

EXEMPLE = API_ROOT / ".env.example"

#: Les champs qu'on ne documente pas, et pourquoi.
#:
#: Trois seulement. Chaque ajout à cette liste doit porter sa raison : c'est le
#: seul moment où quelqu'un se demandera si elle en est une.
EXCLUS = {
    # Lue par la seule session pytest. La poser dans le fichier d'exemple
    # inviterait à la renseigner en production, où elle ne sert à rien et où
    # elle désignerait une base qu'un jeu de données accepte d'effacer.
    "test_database_url": "lue par pytest seulement",
}


def _declarees() -> set[str]:
    """Les variables nommées dans le fichier d'exemple, commentées ou non.

    Commentées comprises : `# STRIPE_SECRET_KEY=sk_test_...` documente le
    réglage tout en disant qu'on le laisse vide par défaut. L'exiger décommenté
    ferait démarrer le produit sur une clé factice.
    """
    contenu = pathlib.Path(EXEMPLE).read_text(encoding="utf-8")
    return {m.group(1).lower() for m in re.finditer(r"^#?\s*([A-Z][A-Z0-9_]*)=", contenu, re.M)}


def test_chaque_reglage_figure_dans_le_fichier_d_exemple() -> None:
    """**La garantie de ce fichier.**

    Un réglage absent du fichier d'exemple est un réglage que personne ne sait
    régler — il existe, il a un défaut, et il est invisible.
    """
    manquants = sorted(set(Settings.model_fields) - _declarees() - set(EXCLUS))

    assert manquants == [], (
        f"réglages absents de .env.example : {manquants}. "
        "Les y écrire avec leur valeur par défaut, ou les exclure avec leur raison."
    )


def test_le_fichier_d_exemple_ne_nomme_rien_qui_n_existe_plus() -> None:
    """Le sens inverse, et il compte autant.

    Une variable qui ne correspond plus à aucun champ se recopie dans un vrai
    `.env`, où elle est ignorée en silence — et quelqu'un passe une demi-heure
    à se demander pourquoi son réglage ne prend pas.
    """
    connus = {nom.lower() for nom in Settings.model_fields}
    inconnues = sorted(nom for nom in _declarees() if nom not in connus)

    assert inconnues == [], f"nommées dans .env.example et inconnues de Settings : {inconnues}"


def test_les_exclusions_servent_toutes_encore() -> None:
    """Une exclusion qui ne correspond plus à un champ est une exception qu'on
    croit justifiée. Elle finit par couvrir un vrai oubli le jour où le champ
    change de nom."""
    obsoletes = sorted(set(EXCLUS) - set(Settings.model_fields))

    assert obsoletes == []


def test_chaque_exclusion_dit_pourquoi() -> None:
    """Une raison vide est une case cochée, pas une décision."""
    sans_raison = [nom for nom, raison in EXCLUS.items() if not raison.strip()]

    assert sans_raison == []
