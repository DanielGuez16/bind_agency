"""Deux exécutions de pytest ne visent jamais la même base.

**Le défaut que ce fichier répare.** Le nom de la base ne portait que le worker.
Deux exécutions parallèles — le cas normal dès que deux conversations avancent
dans le même répertoire — ont chacune un `gw0`, donc visaient la même base.
Chacune commence par `DROP DATABASE ... WITH (FORCE)` : la seconde emportait
celle de la première en pleine exécution, et l'échec ressortait en « database
bind_test_gw0 does not exist » sur du code qui n'avait pas bougé. Trois fois en
deux jours, jamais compris avant d'avoir compté les processus `pytest`.
"""

import os

from sqlalchemy import make_url

from tests.conftest import _base_de_cette_execution, empreinte_de_l_execution

BASE = make_url("postgresql+psycopg://bind:bind@localhost:5434/bind_test")


def _nom(**environnement: str) -> str:
    """Le nom dérivé sous un environnement donné, **et rien de la machine**.

    `clear=True` : sans lui, le `PYTEST_XDIST_TESTRUNUID` de la session qui
    exécute ce test fuiterait dans le décor, et les cas ci-dessous diraient
    quelque chose de l'exécution en cours au lieu de ce qu'ils décrivent.
    """
    ancien = dict(os.environ)
    os.environ.clear()
    os.environ.update(environnement)
    try:
        return _base_de_cette_execution(BASE).database
    finally:
        os.environ.clear()
        os.environ.update(ancien)


def test_deux_executions_paralleles_ne_visent_pas_la_meme_base() -> None:
    """**Le cas que le worker seul ne distinguait pas.**

    Même worker, deux exécutions : c'est exactement la collision vécue. Une
    implémentation qui ne regarde que `PYTEST_XDIST_WORKER` rend deux fois
    `bind_test_gw0` et passe tous les autres cas de ce fichier — c'est donc
    celui-ci qui la fait tomber, et lui seul.
    """
    une = _nom(PYTEST_XDIST_TESTRUNUID="aaaaaaaabbbb", PYTEST_XDIST_WORKER="gw0")
    autre = _nom(PYTEST_XDIST_TESTRUNUID="ccccccccdddd", PYTEST_XDIST_WORKER="gw0")

    assert une != autre, f"deux exécutions visent {une}"


def test_deux_workers_d_une_meme_execution_ne_visent_pas_la_meme_base() -> None:
    """L'autre moitié, celle qui existait déjà et qu'on ne doit pas perdre.

    L'empreinte ne remplace pas le worker : à l'intérieur d'une exécution,
    chaque processus crée et détruit encore la sienne.
    """
    gw0 = _nom(PYTEST_XDIST_TESTRUNUID="aaaaaaaabbbb", PYTEST_XDIST_WORKER="gw0")
    gw1 = _nom(PYTEST_XDIST_TESTRUNUID="aaaaaaaabbbb", PYTEST_XDIST_WORKER="gw1")

    assert gw0 != gw1, f"deux workers visent {gw0}"


def test_le_nom_ne_bouge_pas_d_un_appel_a_l_autre() -> None:
    """**La propriété qu'un identifiant tiré au hasard casserait.**

    `uuid4()` dans la dérivation rendrait tous les cas ci-dessus verts — les
    noms seraient bien distincts — et le produit inutilisable : la base créée au
    démarrage ne serait plus celle qu'on cherche au premier test. Les deux
    familles divergent ici, et seulement ici.
    """
    environnement = {"PYTEST_XDIST_TESTRUNUID": "aaaaaaaabbbb", "PYTEST_XDIST_WORKER": "gw0"}

    assert _nom(**environnement) == _nom(**environnement)


def test_une_execution_en_serie_a_son_nom_aussi() -> None:
    """Sans xdist, aucune des deux variables n'est posée.

    C'est le cas de `-n 0`, celui qu'on prend pour éprouver un test isolé — et
    c'est celui où la collision a été rencontrée en dernier.
    """
    assert _nom() == f"bind_test_p{os.getpid()}"


def test_un_nom_explicite_l_emporte() -> None:
    """La porte de sortie, et elle passe avant les deux dérivations."""
    assert _nom(BIND_TEST_SESSION="r9", PYTEST_XDIST_TESTRUNUID="aaaaaaaa") == "bind_test_r9"


def test_le_depot_d_objets_est_isole_comme_la_base() -> None:
    """**L'autre moitié, et c'est celle qui manquait.**

    Le nom d'un objet est l'empreinte de son contenu : deux processus qui sèment
    en même temps écrivent la **même** clé. L'un renomme `X.partiel` en `X`,
    l'autre ne retrouve plus le sien — `FileNotFoundError` sur les tests du
    semis, et rien dans le message ne parle de parallélisme.

    Le suffixe ne portait que le worker : il protégeait les processus d'une même
    exécution et laissait deux exécutions se voler leurs fichiers. Mesuré — 57
    erreurs sur `test_seed.py` en tournant à côté d'une autre session, zéro
    seul.

    **La racine se lit dans l'environnement réel, pas sur un décor.** C'est le
    seul moyen que ce test parle de ce que le processus utilise vraiment : la
    variable est posée à l'import de `conftest`, avant toute construction de la
    configuration, et un décor reproduirait le calcul au lieu de le confronter.
    """
    racine = os.environ["OBJECT_STORE_LOCAL_ROOT"]

    assert empreinte_de_l_execution() in racine, (
        f"le dépôt d'objets ne porte pas l'empreinte de l'exécution : {racine}. "
        "Deux suites simultanées se voleront leurs fichiers."
    )


def test_l_empreinte_tient_dans_un_identifiant_postgres() -> None:
    """63 octets, moins le nom configuré, le worker, et `_seed_probe`.

    Ce n'est pas une inquiétude théorique : `test_seed.py` dérive encore
    `{base}_seed_probe` de ce nom-là, et un identifiant trop long est tronqué en
    silence par Postgres — deux bases distinctes redeviendraient la même.
    """
    assert len(empreinte_de_l_execution()) <= 16
