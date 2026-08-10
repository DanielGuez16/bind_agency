"""Lecture des vraies photos du jeu de démonstration.

Ce que ces tests protègent, c'est le **repli**. Les fichiers ne sont pas
versionnés : ici comme en intégration continue, ils sont le plus souvent
absents, et un semis qui s'arrêterait pour ça rendrait le jeu de données
inutilisable partout ailleurs que sur la machine qui a téléchargé les photos.

Aucun de ces tests ne lit `assets/photos/` : ils posent leurs propres fichiers
dans un dossier temporaire. Dépendre du contenu réel ferait passer ou échouer la
suite selon ce qui traîne sur le disque de celui qui la lance.
"""

import io

import pytest

from app.integrations import photos_reelles


@pytest.fixture
def racine(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """Un `assets/photos/` jetable, à la place du vrai."""
    monkeypatch.setattr(photos_reelles, "RACINE", tmp_path)
    return tmp_path


def poser_jpeg(racine, chemin: str, *, taille: tuple[int, int] = (2400, 1600)) -> None:
    from PIL import Image

    fichier = racine / chemin
    fichier.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", taille, (120, 90, 200)).save(fichier, format="JPEG")


def dimensions(contenu: bytes) -> tuple[int, int]:
    from PIL import Image

    with Image.open(io.BytesIO(contenu)) as image:
        return image.size


def test_un_fichier_absent_ne_leve_pas(racine) -> None:
    """Le cas normal en intégration continue, pas un cas d'erreur."""
    assert photos_reelles.lire("commerces/absent/cover.jpg", taille=(400, 400)) is None


def test_une_photo_est_ramenee_a_la_taille_demandee(racine) -> None:
    poser_jpeg(racine, "commerces/salon/cover.jpg", taille=(2400, 1600))

    photo = photos_reelles.lire("commerces/salon/cover.jpg", taille=photos_reelles.COUVERTURE)

    assert photo is not None
    assert photo.redimensionnee
    assert dimensions(photo.contenu) == photos_reelles.COUVERTURE


def test_un_format_qui_ne_correspond_pas_est_recadre_et_non_deforme(racine) -> None:
    """Une photo verticale déposée pour une couverture ressort en 16:9.

    Sans recadrage, elle arriverait écrasée ou bordée selon le composant qui
    l'affiche, et le défaut se découvrirait écran par écran plutôt qu'ici.
    """
    poser_jpeg(racine, "commerces/salon/cover.jpg", taille=(1000, 3000))

    photo = photos_reelles.lire("commerces/salon/cover.jpg", taille=photos_reelles.COUVERTURE)

    assert photo is not None
    assert dimensions(photo.contenu) == photos_reelles.COUVERTURE


def test_le_poids_tombe_franchement(racine) -> None:
    """La raison d'être du redimensionnement : ne pas servir 8 Mo à un fil mobile."""
    poser_jpeg(racine, "categories/beauty.jpg", taille=(4000, 4000))
    original = (racine / "categories/beauty.jpg").stat().st_size

    photo = photos_reelles.lire("categories/beauty.jpg", taille=photos_reelles.CATEGORIE)

    assert photo is not None
    assert len(photo.contenu) < original / 10


def test_un_fichier_illisible_est_traite_comme_absent(racine) -> None:
    """Un JPEG tronqué ne doit surtout pas être déposé tel quel.

    Il s'afficherait à moitié, ce qui se diagnostique bien plus mal qu'une
    absence — et le repli au dégradé existe précisément pour ça.
    """
    fichier = racine / "categories/beauty.jpg"
    fichier.parent.mkdir(parents=True, exist_ok=True)
    fichier.write_bytes(b"ceci n'est pas une image")

    assert photos_reelles.lire("categories/beauty.jpg", taille=(400, 400)) is None


def test_sans_pillow_l_original_est_depose_et_signale(racine, monkeypatch) -> None:
    """Le mode dégradé : moins bien, pas cassé — mais jamais silencieux.

    `redimensionnee` est ce qui permet au semis de le dire. Déposer huit
    mégaoctets sans que personne ne l'apprenne serait le vrai défaut.
    """
    poser_jpeg(racine, "categories/beauty.jpg", taille=(1200, 1200))
    monkeypatch.setattr(photos_reelles, "_pillow", lambda: None)

    photo = photos_reelles.lire("categories/beauty.jpg", taille=(400, 400))

    assert photo is not None
    assert not photo.redimensionnee
    assert photo.contenu == (racine / "categories/beauty.jpg").read_bytes()
    assert not photos_reelles.pillow_disponible()


def test_la_video_n_est_pas_touchee(racine) -> None:
    """Elle n'est pas une image : la réencoder demanderait `ffmpeg`."""
    fichier = racine / "accueil/video.mp4"
    fichier.parent.mkdir(parents=True, exist_ok=True)
    fichier.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 500)

    assert photos_reelles.lire_telle_quelle("accueil/video.mp4") == fichier.read_bytes()
    assert photos_reelles.lire_telle_quelle("accueil/absente.mp4") is None
