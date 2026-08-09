"""Dépôt d'objets, et la preuve qui s'en sert.

Le dépôt local est la nouveauté qui compte : jusqu'ici `deposer` calculait une
clé sans rien écrire, et une preuve archivée n'était consultable nulle part.

Deux propriétés à tenir, et la seconde est celle qu'on oublie : **ce qui est
déposé se relit**, et **une clé venue d'ailleurs ne fait pas écrire n'importe
où** sur la machine.
"""

from pathlib import Path

import pytest

from app.integrations.object_store import (
    LocalObjectStore,
    MemoryObjectStore,
    ObjectStoreError,
    ObjectStoreUnavailable,
    S3ObjectStore,
    cle_pour,
)

CONTENU = b"\x89PNG\r\n\x1a\n une image"


async def test_ce_qui_est_depose_se_relit(tmp_path: Path) -> None:
    depot = LocalObjectStore(tmp_path)
    cle = await depot.deposer(CONTENU, prefixe="photos/item")

    assert await depot.lire(cle) == CONTENU


async def test_le_depot_survit_a_un_redemarrage(tmp_path: Path) -> None:
    """La propriété qui manquait exactement : une preuve archivée reste
    consultable après redémarrage."""
    cle = await LocalObjectStore(tmp_path).deposer(CONTENU, prefixe="proofs/upload")

    # Une seconde instance, comme un second démarrage du processus.
    assert await LocalObjectStore(tmp_path).lire(cle) == CONTENU


async def test_une_cle_inconnue_rend_nul_et_ne_leve_pas(tmp_path: Path) -> None:
    """Une absence se distingue mal d'une panne quand les deux lèvent."""
    assert await LocalObjectStore(tmp_path).lire("photos/item/2026-01-01/inexistant") is None


async def test_deux_depots_du_meme_contenu_partagent_leur_cle(tmp_path: Path) -> None:
    depot = LocalObjectStore(tmp_path)
    premiere = await depot.deposer(CONTENU, prefixe="photos/item")
    seconde = await depot.deposer(CONTENU, prefixe="photos/item")

    assert premiere == seconde


async def test_deux_contenus_differents_ne_la_partagent_pas(tmp_path: Path) -> None:
    """Le pendant : une clé qui ne dépendrait pas du contenu ferait perdre le
    second dépôt sous le premier."""
    depot = LocalObjectStore(tmp_path)
    premiere = await depot.deposer(CONTENU, prefixe="photos/item")
    seconde = await depot.deposer(CONTENU + b"!", prefixe="photos/item")

    assert premiere != seconde


@pytest.mark.parametrize("cle", ["../../etc/passwd", "photos/../../../tmp/echappe", "/etc/passwd"])
async def test_une_cle_ne_sort_pas_de_la_racine(tmp_path: Path, cle: str) -> None:
    """Les clés sont construites par le produit, mais la lecture accepte ce
    qu'on lui donne : une clé qui remonte l'arborescence lirait n'importe quel
    fichier de la machine."""
    with pytest.raises(ObjectStoreError):
        await LocalObjectStore(tmp_path).lire(cle)


async def test_le_depot_memoire_rend_ce_qu_il_a_recu() -> None:
    depot = MemoryObjectStore()
    cle = await depot.deposer(CONTENU, prefixe="photos/item")

    assert await depot.lire(cle) == CONTENU


def test_le_depot_s3_refuse_plutot_que_de_faire_semblant() -> None:
    """Un dépôt qui croit écrire chez un fournisseur et écrit ailleurs est pire
    qu'un dépôt qui refuse.

    Le refus a changé de moment : il était au premier dépôt tant que la classe
    n'était pas branchée, il est maintenant à la construction. Une preuve perdue
    faute d'identifiants ne se rattrape pas.

    Le reste — quel compartiment pour quel préfixe, l'adresse signée — vit dans
    `test_object_store_s3.py`.
    """
    with pytest.raises(ObjectStoreUnavailable):
        S3ObjectStore(
            public="un-seau",
            prive=None,
            endpoint=None,
            region="auto",
            access_key=None,
            secret_key=None,
            duree_signature=300,
        )


def test_la_cle_range_par_prefixe_et_par_jour() -> None:
    """Ce qui rend une politique de rétention écrivable plus tard sans relire
    les lignes."""
    cle = cle_pour(CONTENU, prefixe="proofs/upload")
    prefixe, jour, empreinte = cle.rsplit("/", 2)

    assert prefixe == "proofs/upload"
    assert len(jour) == 10 and jour.count("-") == 2
    assert len(empreinte) == 64
