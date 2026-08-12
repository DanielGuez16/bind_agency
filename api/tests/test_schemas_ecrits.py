"""Un champ accepté par un schéma et ignoré par le service est un défaut.

Pas une omission : l'appelant reçoit un 200, croit avoir enregistré, et ne
découvre le contraire qu'en relisant — ou jamais. C'est arrivé avec les photos
de couverture et d'article, acceptées par les schémas et jetées par les services
de création.

Ce test parcourt tous les schémas d'écriture et exige que chaque champ apparaisse
**en position d'écriture** quelque part : passé à un constructeur (`champ=`),
affecté (`.champ =`), ou nommé dans une liste de champs modifiables (`"champ"`).
Une simple mention dans un commentaire ne suffit pas.

**Portée exacte, et elle n'est pas totale.** Le test attrape le cas « déclaré et
écrit nulle part », qui est celui des photos. Il n'attrape pas « écrit par un
service et oublié par un autre qui accepte le même nom de champ » : la
correspondance schéma → service n'est pas déductible, et la deviner produirait
des exceptions plus fragiles que le contrôle. Il ne prouve pas non plus que
l'écriture est correcte — c'est le rôle des tests de chaque service.
"""

import dataclasses
import importlib
import inspect
import pathlib
import pkgutil
import re

import pytest

import app.schemas as paquet
import app.services as services

#: Suffixes des schémas qui décrivent une écriture. Un `*Read` ne s'écrit pas.
ECRITURE = re.compile(r"(Create|Update|Demande|Payload)$")

#: Champs dont l'absence côté service est normale, avec leur raison. Liste
#: courte et justifiée : c'est elle qu'on relit quand le test tombe.
TOLERES = {
    # Transporte les coordonnées, dépliées en longitude/latitude par le service.
    "business.BusinessCreate.coordinates",
    "business.BusinessUpdate.coordinates",
    # Le service reçoit déjà l'objet `Coordinates`, pas ses composantes.
    "business.CoordinatesPayload.longitude",
    "business.CoordinatesPayload.latitude",
}


def _source_ecriture() -> str:
    racine = pathlib.Path(__file__).resolve().parents[1] / "app"
    return "\n".join(
        chemin.read_text(encoding="utf-8")
        for dossier in ("services", "routers", "workers")
        for chemin in (racine / dossier).glob("*.py")
    )


def _schemas_d_ecriture() -> list[tuple[str, type]]:
    trouves = []
    for module in pkgutil.iter_modules(paquet.__path__):
        m = importlib.import_module(f"app.schemas.{module.name}")
        for nom, classe in inspect.getmembers(m, inspect.isclass):
            if (
                classe.__module__ == m.__name__
                and hasattr(classe, "model_fields")
                and ECRITURE.search(nom)
            ):
                trouves.append((f"{module.name}.{nom}", classe))
    return sorted(trouves)


SCHEMAS = _schemas_d_ecriture()
SOURCE = _source_ecriture()


def test_il_y_a_bien_des_schemas_a_inspecter() -> None:
    """Sans cette assertion, un renommage de paquet rendrait le test vert en
    n'inspectant plus rien."""
    assert len(SCHEMAS) >= 10


@pytest.mark.parametrize(("nom", "classe"), SCHEMAS, ids=[n for n, _ in SCHEMAS])
def test_chaque_champ_accepte_est_ecrit_quelque_part(nom: str, classe: type) -> None:
    ignores = []
    for champ in classe.model_fields:
        if f"{nom}.{champ}" in TOLERES:
            continue
        # Trois formes d'écriture : argument nommé, affectation, liste de champs.
        ecrit = re.search(rf"\b{re.escape(champ)}\s*=", SOURCE) or re.search(
            rf'"{re.escape(champ)}"', SOURCE
        )
        if not ecrit:
            ignores.append(champ)

    assert not ignores, (
        f"{nom} accepte {ignores} sans que rien ne les écrive. "
        "Un champ accepté puis ignoré rend un 200 à qui n'a rien enregistré."
    )


def test_les_tolerances_sont_toutes_encore_utiles() -> None:
    """Une tolérance qui ne sert plus est une exception qu'on croit justifiée.

    Elle finit par couvrir un vrai défaut le jour où le champ change de nom.
    """
    connus = {f"{nom}.{champ}" for nom, classe in SCHEMAS for champ in classe.model_fields}

    assert connus >= TOLERES, f"tolérances obsolètes : {sorted(TOLERES - connus)}"


# --------------------------------------------------------------------------
# le sens inverse : un champ déclaré en lecture que rien ne produit
# --------------------------------------------------------------------------
#
# Le défaut symétrique, et il coûte plus cher. Un schéma d'écriture qui accepte
# un champ ignoré rend un 200 mensonger ; un schéma de lecture qui exige un
# champ que le service ne porte pas rend un **500**, sur toutes les réponses,
# tout le temps. `GET /me/bookings` l'a fait pendant une campagne entière :
# `ReservationDuCreateurRead` déclarait `required_mention` et `required_geotag`,
# la structure du service ne les avait pas, et la validation de réponse levait
# avant que l'en-tête CORS soit posé — l'app ne voyait qu'un refus de CORS et
# cherchait la panne du mauvais côté.
#
# La paire se déduit du nom : `X` dans un service, `XRead` dans un schéma. Ce
# n'est pas une convention imposée, c'est celle qui existe ; les structures sans
# schéma du même nom sortent simplement de l'examen.


def _paires_lecture() -> list[tuple[str, type, type]]:
    """Les couples (structure de service, schéma de lecture) qui portent le même nom."""
    schemas: dict[str, type] = {}
    for module in pkgutil.iter_modules(paquet.__path__):
        m = importlib.import_module(f"app.schemas.{module.name}")
        for nom, classe in inspect.getmembers(m, inspect.isclass):
            if classe.__module__ == m.__name__ and hasattr(classe, "model_fields"):
                schemas.setdefault(nom, classe)

    paires = []
    for module in pkgutil.iter_modules(services.__path__):
        m = importlib.import_module(f"app.services.{module.name}")
        for nom, classe in inspect.getmembers(m, inspect.isclass):
            if classe.__module__ != m.__name__ or not dataclasses.is_dataclass(classe):
                continue
            schema = schemas.get(f"{nom}Read")
            if schema is not None:
                paires.append((f"{module.name}.{nom}", classe, schema))
    return sorted(paires, key=lambda p: p[0])


PAIRES = _paires_lecture()


def test_il_y_a_bien_des_paires_a_inspecter() -> None:
    """Sans cette assertion, une convention de nommage abandonnée rendrait le
    test vert en n'inspectant plus rien."""
    assert len(PAIRES) >= 20


@pytest.mark.parametrize(("nom", "structure", "schema"), PAIRES, ids=[n for n, _, _ in PAIRES])
def test_chaque_champ_lu_existe_sur_la_structure(nom: str, structure: type, schema: type) -> None:
    """Un champ que le schéma exige et que la structure n'a pas est un 500.

    Les propriétés comptent : `taux_d_honoration` et `dernier_motif` sont
    calculés et non stockés, et `from_attributes` les lit comme le reste.
    """
    disponibles = {champ.name for champ in dataclasses.fields(structure)} | {
        attribut for attribut in vars(structure) if not attribut.startswith("_")
    }
    absents = [champ for champ in schema.model_fields if champ not in disponibles]

    assert not absents, (
        f"{schema.__name__} déclare {absents} que {nom} ne porte pas. "
        "La validation de réponse lèvera un 500 sur chaque appel, "
        "et l'appelant ne verra qu'un refus de CORS."
    )
