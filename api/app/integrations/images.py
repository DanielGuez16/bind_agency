"""Réduire une image, au dépôt et jamais au service.

**Le mécanisme n'est pas neuf : il vient du semis.** `photos_reelles` réduisait
déjà les vraies photos de la démonstration au moment de les ranger — redressement
EXIF, conversion de mode, qualité 82. Ce module en extrait le cœur pour que le
produit s'en serve aussi, et `photos_reelles` l'appelle désormais plutôt que d'en
garder une copie. Deux copies d'un même traitement d'image divergent au premier
réglage qu'on touche.

**Ce que ça répare.** Une photo de prestation partait vers le fil telle qu'elle
était sortie du téléphone : quatre mille pixels de large pour un cadre de cent
cinquante points. Le gâchis se paie à chaque affichage, pour tout le monde, et il
se paie deux fois sur un réseau de salon.

**Au dépôt plutôt qu'à la lecture, et c'est une décision.** Le stockage est ce
qui coûte le moins cher de la pile ; une clé dérivée n'a ni cache à invalider ni
coût à l'exécution, et la route des médias continue de ne faire que servir des
octets déjà rangés. Redimensionner à la lecture demanderait un décodeur sur le
chemin chaud, un cache, et une invalidation — trois choses à tenir pour une image
qui ne change jamais.

**La vignette borne le côté le plus long, elle ne recadre pas.** Une couverture
est en 16:9, une photo de prestation en carré, une page de carte en portrait :
imposer un rapport ici recadrerait au dépôt une image dont l'écran décide déjà du
cadrage. On borne, l'application continue de couvrir comme avant, et une seule
taille sert partout.

**Pillow absent ne casse rien.** C'est le même repli que le semis : on dépose ce
qu'on a reçu. Une photo lourde vaut mieux qu'un téléversement refusé — et une
image illisible aussi, parce que c'est le serveur qui la refuse ensuite, avec le
message qui convient.
"""

import io
from types import ModuleType

#: Le côté le plus long d'une vignette, en pixels.
#:
#: Les cartes du fil font cent cinquante points de haut ; à densité triple, on
#: en est à quatre cent cinquante. Quatre cent quatre-vingts couvre les deux avec
#: une marge, et pèse une trentaine de kilooctets là où l'original en pèse
#: plusieurs milliers.
COTE_VIGNETTE = 480

#: 82 et non 95 : au-delà, le poids monte franchement pour une différence que
#: l'œil ne fait pas sur une photographie. Repris tel quel du semis.
QUALITE = 82


def _pillow() -> ModuleType | None:
    """Le module, ou `None` s'il n'est pas installé.

    Jamais une exception : son absence est un mode dégradé — on dépose
    l'original — et pas une panne. Le produit le déclare en dépendance, donc ce
    cas ne devrait pas se présenter ; il reste couvert parce qu'un
    téléversement qui échoue à cause d'un environnement mal installé est le
    genre de panne qu'on découvre un samedi.
    """
    try:
        from PIL import (
            Image,
            ImageOps,  # noqa: F401  (vérifie le paquet entier)
        )
    except ModuleNotFoundError:
        return None
    return Image


def pillow_disponible() -> bool:
    return _pillow() is not None


def vignette(brut: bytes, *, cote: int = COTE_VIGNETTE) -> bytes | None:
    """Une version bornée de l'image, ou `None` si on ne sait pas la produire.

    `None` couvre deux cas que l'appelant traite pareil — déposer l'original
    seul : Pillow absent, et image illisible. Un JPEG tronqué ne doit pas être
    réencodé en une vignette à moitié grise, qui se diagnostique bien plus mal
    qu'une vignette absente.

    **Une image déjà petite n'est pas agrandie.** `thumbnail` ne fait que
    réduire ; une photo de trois cents pixels ressort telle quelle, en poids
    comme en dimensions.
    """
    module = _pillow()
    if module is None:
        return None

    try:
        return _reduire(brut, cote=cote, module=module)
    except OSError:
        # `UnidentifiedImageError` en hérite, comme les lectures tronquées.
        return None


def _reduire(brut: bytes, *, cote: int, module: ModuleType) -> bytes:
    from PIL import ImageOps

    with module.open(io.BytesIO(brut)) as source:
        # L'orientation d'un appareil photo vit dans les métadonnées EXIF, pas
        # dans les pixels : sans ce redressement, une photo prise à la verticale
        # se range couchée, et personne ne comprend pourquoi elle s'affiche
        # droite dans l'aperçu du système.
        redressee = ImageOps.exif_transpose(source) or source

        # Le mode importe avant l'enregistrement : un PNG à canal alpha ou une
        # image en palette ne s'écrivent pas en JPEG, et l'erreur ne survient
        # qu'à la sauvegarde.
        if redressee.mode != "RGB":
            redressee = redressee.convert("RGB")

        # `thumbnail` conserve le rapport et ne fait que réduire. C'est ce qui
        # permet à une seule taille de servir une couverture 16:9, une photo
        # carrée et une page de carte en portrait.
        redressee.thumbnail((cote, cote), module.LANCZOS)

        sortie = io.BytesIO()
        # Rien n'est passé en `exif` : les métadonnées ne sont pas recopiées, et
        # la position GPS d'une photo prise dans un salon ne part pas avec elle.
        redressee.save(sortie, format="JPEG", quality=QUALITE, optimize=True, progressive=True)
        return sortie.getvalue()
