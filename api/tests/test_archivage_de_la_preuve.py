"""L'archivage d'une publication, et l'adresse qui s'y perdait.

**Trois manques qui se cachaient l'un l'autre.** Le champ `source_url` traverse
tout le produit — le schéma l'accepte, la méthode de client le transporte,
l'écran du commerce sait l'ouvrir — et rien ne le remplissait : l'écran de
soumission n'avait pas de champ, le semis posait `None`, et le niveau 3 jetait
ce qu'on lui donnait. Chacun rendait les deux autres invisibles.

**Et le niveau 1 levait à sa première ligne.** `fournisseur_de` est une
dépendance FastAPI, c'est-à-dire un générateur asynchrone ; elle était utilisée
en `async with`. Le chemin n'est atteint que si une adresse est fournie — donc
jamais — et la panne ne pouvait pas se découvrir.
"""

import pytest

from app.models.enums import CaptureMethod
from app.services import storage

ADRESSE = "https://www.instagram.com/p/Cxyz123/"


@pytest.fixture(autouse=True)
def depot(monkeypatch: pytest.MonkeyPatch):
    """Un dépôt qui rend toujours le même contenu : ce test porte sur l'adresse,
    pas sur le stockage."""

    class Depot:
        async def lire(self, cle: str) -> bytes:
            return b"une-image"

    monkeypatch.setattr(storage, "get_object_store", lambda: Depot())


async def test_le_niveau_trois_retient_l_adresse_declaree() -> None:
    """**Le manque exact relevé en campagne.** Le commerce n'avait que la
    capture ; « ouvrir la publication » n'apparaissait jamais, parce que le seul
    niveau qui fonctionne aujourd'hui ne rendait aucune adresse."""
    capture = await storage._par_capture_ecran("proofs/upload/abc", ADRESSE)

    assert capture is not None
    assert capture.source_url == ADRESSE
    # Et rien ne prétend qu'elle a été vérifiée : c'est une adresse déclarée.
    assert capture.capture_method is CaptureMethod.UPLOAD


async def test_le_niveau_trois_sans_adresse_n_en_invente_pas() -> None:
    """L'autre sens. Une adresse fabriquée mènerait le commerce sur une page
    d'erreur, qu'il lirait comme une publication supprimée."""
    capture = await storage._par_capture_ecran("proofs/upload/abc", None)

    assert capture is not None
    assert capture.source_url is None


async def test_l_archivage_complet_transmet_l_adresse_au_dernier_niveau(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """**Le test qui garde le câblage**, et non le seul niveau 3.

    `archiver_la_publication` essaie trois niveaux et rend le premier qui
    aboutit. Le troisième recevait `screenshot_key` seul : l'adresse était
    perdue une ligne avant d'être écrite, et éprouver `_par_capture_ecran` seul
    n'aurait rien dit de ce chemin-là.
    """

    async def rien(*args, **kwargs):
        return None

    # Les deux premiers niveaux échouent : c'est le cas ordinaire aujourd'hui.
    monkeypatch.setattr(storage, "_par_api", rien)
    monkeypatch.setattr(storage, "_par_url", rien)

    capture = await storage.archiver_la_publication(
        None,
        social_account_id=None,
        source_url=ADRESSE,
        screenshot_key="proofs/upload/abc",
    )

    assert capture is not None
    assert capture.source_url == ADRESSE


def test_le_fournisseur_du_niveau_un_n_est_pas_un_gestionnaire_de_contexte() -> None:
    """**La panne du niveau 1, prise à sa racine plutôt qu'à son symptôme.**

    `fournisseur_de` est une dépendance FastAPI : un générateur asynchrone. Elle
    était employée en `async with`, ce qui lève `TypeError` avant tout appel
    réseau. Le vérifier ici plutôt que de monter un faux fournisseur : ce qui
    était faux n'était pas le fournisseur, c'était la façon de l'ouvrir.
    """
    from app.integrations.providers import fournisseur_de
    from app.models.enums import Platform

    fabrique = fournisseur_de(Platform.INSTAGRAM)

    assert hasattr(fabrique, "__anext__"), "ce n'est plus un générateur asynchrone"
    assert not hasattr(fabrique, "__aenter__"), (
        "un gestionnaire de contexte : `async with` redeviendrait légitime, "
        "et la correction de storage._par_api serait à revoir"
    )
