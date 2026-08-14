"""La vignette produite au dépôt, et ce qu'elle ne doit jamais casser.

**Ce que ça répare.** Une photo de prestation partait vers le fil telle qu'elle
sortait du téléphone : quatre mille pixels de large pour un cadre de cent
cinquante points. Le gâchis se paie à chaque affichage, pour tout le monde, et
deux fois sur le réseau d'un salon.

**Ce qui est éprouvé, dans l'ordre d'importance.**

1. La vignette est bien plus légère et bien plus petite que l'original. Un test
   qui vérifierait seulement qu'un second objet existe passerait alors qu'on
   aurait rangé deux fois la même photo.
2. Le dépôt de l'original **n'échoue jamais** à cause de la vignette. Une photo
   perdue parce qu'un décodeur a hoqueté est pire que tout ce qu'on gagne.
3. Le repli de la route des médias : les images d'avant ce changement n'ont pas
   de vignette, et l'app en demande une partout où elle affiche petit.
"""

import io

import pytest

from app.integrations import images
from app.integrations.object_store import MemoryObjectStore
from app.services import storage


#: Une photographie de synthèse, assez grande pour qu'une réduction se voie.
#: Du bruit plutôt qu'un aplat : un aplat se compresse à quelques octets et la
#: comparaison de poids ne dirait plus rien.
def _photo(cote: int = 2000) -> bytes:
    from PIL import Image

    graine = 1
    pixels = bytearray()
    for _ in range(cote * cote):
        graine = (graine * 1103515245 + 12345) & 0x7FFFFFFF
        pixels += bytes(((graine >> 16) & 0xFF, (graine >> 8) & 0xFF, graine & 0xFF))

    image = Image.frombytes("RGB", (cote, cote), bytes(pixels))
    sortie = io.BytesIO()
    image.save(sortie, format="JPEG", quality=95)
    return sortie.getvalue()


# --------------------------------------------------------------------------
# la réduction elle-même
# --------------------------------------------------------------------------


def test_la_vignette_est_plus_petite_et_plus_legere() -> None:
    """**Le cœur du changement.** Vérifier qu'un second objet existe ne
    suffirait pas : on aurait pu ranger deux fois la même photo."""
    from PIL import Image

    original = _photo()
    reduite = images.vignette(original)

    assert reduite is not None
    assert len(reduite) < len(original) / 4

    with Image.open(io.BytesIO(reduite)) as lue:
        assert max(lue.size) == images.COTE_VIGNETTE


def test_une_image_deja_petite_n_est_pas_agrandie() -> None:
    """`thumbnail` ne fait que réduire. Agrandir produirait un fichier plus
    lourd que l'original pour une image plus floue — l'exact contraire."""
    from PIL import Image

    petite = _photo(cote=120)

    reduite = images.vignette(petite)

    assert reduite is not None
    with Image.open(io.BytesIO(reduite)) as lue:
        assert max(lue.size) == 120


def test_un_fichier_illisible_ne_rend_pas_de_vignette() -> None:
    """`None` et non une exception : l'appelant dépose alors l'original seul.
    Un JPEG tronqué réencodé en vignette à moitié grise se diagnostique bien
    plus mal qu'une vignette absente."""
    assert images.vignette(b"ceci n'est pas une image") is None


def test_le_rapport_est_conserve() -> None:
    """On borne, on ne recadre pas. Une couverture est en 16:9, une photo de
    prestation en carré, une page de carte en portrait : imposer un rapport ici
    recadrerait au dépôt une image dont l'écran décide déjà du cadrage."""
    from PIL import Image

    sortie = io.BytesIO()
    Image.new("RGB", (1600, 900), (120, 90, 60)).save(sortie, format="JPEG")

    reduite = images.vignette(sortie.getvalue())

    assert reduite is not None
    with Image.open(io.BytesIO(reduite)) as lue:
        assert lue.size == (images.COTE_VIGNETTE, images.COTE_VIGNETTE * 9 // 16)


# --------------------------------------------------------------------------
# le dépôt
# --------------------------------------------------------------------------


@pytest.fixture
def depot(monkeypatch: pytest.MonkeyPatch) -> MemoryObjectStore:
    store = MemoryObjectStore()
    monkeypatch.setattr(storage, "get_object_store", lambda: store)
    return store


async def test_le_depot_range_l_original_et_sa_vignette(depot: MemoryObjectStore) -> None:
    original = _photo()

    cle = await storage.deposer_une_image(original, prefixe="photos/commerces/x")

    assert await depot.lire(cle) == original
    vignette = await depot.lire(storage.cle_de_vignette(cle))
    assert vignette is not None and len(vignette) < len(original) / 4


async def test_une_image_illisible_se_depose_quand_meme(depot: MemoryObjectStore) -> None:
    """**Le dépôt de l'original n'échoue jamais à cause de la vignette.** Perdre
    une photo que le commerce vient d'envoyer, pour une raison qui ne le regarde
    pas, coûte plus que tout ce que la vignette fait gagner.

    Un fichier qui n'est pas une image est refusé plus haut, par la signature :
    ici on éprouve que la couche de dépôt, elle, ne s'y casse pas.
    """
    cle = await storage.deposer_une_image(b"pas une image", prefixe="photos/commerces/x")

    assert await depot.lire(cle) == b"pas une image"
    assert await depot.lire(storage.cle_de_vignette(cle)) is None


async def test_pillow_absent_depose_l_original_seul(
    depot: MemoryObjectStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Le repli du semis, repris tel quel : dégradé, pas cassé."""
    monkeypatch.setattr(images, "_pillow", lambda: None)
    original = _photo(cote=200)

    cle = await storage.deposer_une_image(original, prefixe="photos/commerces/x")

    assert await depot.lire(cle) == original
    assert await depot.lire(storage.cle_de_vignette(cle)) is None


def test_les_deux_cles_se_derivent_l_une_de_l_autre() -> None:
    """Dérivée plutôt que stockée : une colonne de plus par table portant une
    image se désynchroniserait au premier dépôt qui échoue à mi-chemin."""
    cle = "photos/commerces/x/2026-08-14/abcdef"

    assert storage.cle_d_origine(storage.cle_de_vignette(cle)) == cle
    # Et sur une clé qui n'est pas une vignette, la fonction ne fait rien :
    # l'appliquer deux fois ne doit pas ronger la clé.
    assert storage.cle_d_origine(cle) == cle
