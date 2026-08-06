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

import importlib
import inspect
import pathlib
import pkgutil
import re

import pytest

import app.schemas as paquet

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
