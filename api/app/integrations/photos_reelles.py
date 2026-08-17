"""Les vraies photos du jeu de démonstration, quand elles ont été déposées.

`app/integrations/demo_images.py` fabrique des dégradés, et continue de le
faire. Ce module-ci lit ce qui a été déposé à la main dans `assets/photos/`, et
rend `None` quand il n'y a rien. Le semis appelle l'un, puis l'autre : **aucune
photo absente ne fait échouer le jeu de données**, elle fait retomber sur un
dégradé, et le semis nomme le fichier qui manquait.

**Ces fichiers ne sont pas versionnés.** Vingt images de plusieurs mégaoctets
entrent dans l'historique git pour toujours, et rien ne les en sort. Comme le
repli existe, l'intégration continue et une machine fraîchement clonée tournent
sans elles ; `assets/photos/A-FOURNIR.md` dit lesquelles récupérer et où.

**On redimensionne au dépôt, jamais au service.** Une photo d'Unsplash fait
4000 pixels de large et huit mégaoctets ; la servir telle quelle à un fil mobile
qui l'affiche sur 150 points est un gâchis qui se paie à chaque affichage, pour
tous. Réduire une fois au dépôt le paie une fois pour toutes.

**Pillow est passé au produit, et ce module n'en garde plus de copie.** Il
n'était ici que pour le jeu de données ; le produit réduit désormais lui aussi
au dépôt, et le décodeur est déclaré une fois. La détection de sa présence vit
dans `app/integrations/images.py`, que ce module appelle — deux copies d'un même
traitement d'image divergent au premier réglage qu'on touche. S'il est absent,
on dépose l'original et on le signale : c'est moins bien, ce n'est pas cassé.

**Le recadrage est décidé ici, pas à l'affichage.** `ImageOps.fit` remplit le
rapport demandé et rogne le débord, centré : exactement ce que fait un
`object-fit: cover` côté app, mais une fois, sur le fichier rangé. Sans lui, une
photo verticale déposée pour une couverture arriverait en 16:9 déformée ou
bordée de blanc selon le composant, et le défaut se découvrirait écran par
écran.
"""

import io
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from app.core.config import API_ROOT
from app.integrations import images

#: `API_ROOT` est le dossier `api/` ; les photos vivent à la racine du dépôt,
#: à côté de l'app, parce qu'elles n'appartiennent pas plus au backend qu'au
#: frontend — c'est le jeu de démonstration qui les porte.
RACINE = API_ROOT.parent / "assets" / "photos"

#: Les tailles de dépôt. Nettement plus grandes que celles des dégradés
#: générés, qui n'ont jamais à être belles de près, et nettement plus petites
#: que ce qui sort d'une banque d'images.
#:
#: Le double d'un affichage courant, pour tenir sur un écran à densité doublée
#: sans que le fichier double une fois de plus.
COUVERTURE = (1200, 675)
#: L'affiche verticale de l'accueil, au rapport 9:16 de sa vidéo. La réduire au
#: format paysage la recadrerait, et le saut se verrait au démarrage.
AFFICHE_PORTRAIT = (720, 1280)
#: La couverture verticale du mur du fil, en 4:5.
#:
#: **Bornée à 2000 sur le grand côté**, comme tout original depuis que le mur
#: sert l'original et non la vignette : une couverture pleine largeur sur 520
#: points ne peut pas se contenter de 480 pixels. 1600 × 2000 traverse donc
#: sans rien perdre — c'est le format demandé aux photographes.
COUVERTURE_PORTRAIT = (1600, 2000)
#: Une page de carte : du texte, donc plus haut que large et assez défini pour
#: que les prix se lisent.
PAGE_DE_CARTE = (1200, 1600)
PRESTATION = (800, 800)
CATEGORIE = (400, 400)

#: Reprise de `images` : une seule valeur, un seul endroit où la changer.
QUALITE = images.QUALITE


@dataclass(frozen=True, slots=True)
class PhotoReelle:
    """Une photo trouvée sur le disque, prête à déposer."""

    #: Le chemin relatif à `assets/photos/`, tel qu'il s'écrit dans A-FOURNIR.md.
    chemin: str
    contenu: bytes
    #: Faux quand Pillow manque : l'original est déposé tel quel, et le semis
    #: le dit. Un fichier lourd rangé sans qu'on le sache serait pire.
    redimensionnee: bool


def _pillow() -> ModuleType | None:
    """Le module, ou `None`. Emprunté à `images`, qui le déclare une seule fois."""
    return images._pillow()


def pillow_disponible() -> bool:
    # Par `_pillow` et non par `images` directement : un seul point à remplacer
    # pour éprouver le mode dégradé, sans quoi la lecture et cette réponse-ci
    # pourraient dire deux choses différentes.
    return _pillow() is not None


def lire(chemin: str, *, taille: tuple[int, int]) -> PhotoReelle | None:
    """La photo déposée à ce chemin, réduite au format voulu.

    Rend `None` dans deux cas que l'appelant traite de la même façon — repli
    sur un dégradé, et le chemin cité dans le résumé : le fichier n'est pas là,
    ou il est là mais illisible. Un JPEG tronqué par un téléchargement
    interrompu ne doit pas se retrouver déposé tel quel : il s'afficherait à
    moitié, ce qui se diagnostique bien plus mal qu'une absence.
    """
    fichier = RACINE / chemin
    if not fichier.is_file():
        return None

    brut = fichier.read_bytes()

    module = _pillow()
    if module is None:
        return PhotoReelle(chemin=chemin, contenu=brut, redimensionnee=False)

    try:
        reduite = _reduire(brut, taille=taille, module=module)
    except OSError:
        # `UnidentifiedImageError` en hérite, comme les lectures tronquées.
        return None
    return PhotoReelle(chemin=chemin, contenu=reduite, redimensionnee=True)


def lire_telle_quelle(chemin: str) -> bytes | None:
    """Le fichier brut, sans le toucher. Pour ce qui n'est pas une image.

    La vidéo d'accueil passe par ici : la réencoder demanderait `ffmpeg`, une
    dépendance d'un autre ordre, et elle est fournie déjà dimensionnée.
    """
    fichier = RACINE / chemin
    return fichier.read_bytes() if fichier.is_file() else None


def _reduire(brut: bytes, *, taille: tuple[int, int], module: ModuleType) -> bytes:
    from PIL import ImageOps

    with module.open(io.BytesIO(brut)) as source:
        # L'orientation d'un appareil photo vit dans les métadonnées EXIF, pas
        # dans les pixels : sans ce redressement, une photo prise à la
        # verticale se range couchée, et personne ne comprend pourquoi elle
        # s'affiche droite dans l'aperçu du système.
        redressee = ImageOps.exif_transpose(source) or source

        # Le mode importe avant l'enregistrement : un PNG à canal alpha ou une
        # image en palette ne s'écrivent pas en JPEG, et l'erreur ne survient
        # qu'à la sauvegarde.
        if redressee.mode != "RGB":
            redressee = redressee.convert("RGB")

        cadree = ImageOps.fit(redressee, taille, method=module.LANCZOS)

        sortie = io.BytesIO()
        # Rien n'est passé en `exif` : les métadonnées ne sont pas recopiées,
        # et la position GPS d'une photo de banque d'images ne part pas avec.
        cadree.save(sortie, format="JPEG", quality=QUALITE, optimize=True, progressive=True)
        return sortie.getvalue()


def chemin_absolu(chemin: str) -> Path:
    """Pour les messages d'erreur : le chemin que l'humain doit aller remplir."""
    return RACINE / chemin
