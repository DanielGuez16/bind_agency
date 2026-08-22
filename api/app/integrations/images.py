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

**Et une dérivée ne sert à rien tant que l'écran demande l'original.** Le mur
appelait `urlDuMedia` et non `urlDeLaVignette` : il tirait donc l'original borné
à 2000 pixels pour le poser dans un cadre de 100 points. Mesuré sur un fil de
vingt salons — quatre-vingts images, la grille ne virtualise pas — 10,5 Mo de
photographies Instagram, 52 Mo de photos de téléphone, contre 50 Ko de JSON. Le
réglage de la vignette ne valait rien tant que personne ne la demandait.

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
#: **Trois cent vingt, et le nombre vient des écrans, pas d'une habitude.** Les
#: cinq cadres qui lisent une vignette sont mesurés : 100 points sur le mur —
#: le plus grand — puis 64 sur la fiche, 56 dans la galerie et dans la carte,
#: 40 × 52 dans la bande de la visionneuse. À densité triple, le plus grand
#: demande 300 pixels. 320 le couvre, et rien de plus.
#:
#: Elle valait 480, calibrée sur des cartes de 150 points que la grille v3 ne
#: rend plus. Mesuré sur onze photographies réelles : 19 Ko à 480, 10 Ko à 320 ;
#: sur une photo de téléphone de 4032 × 3024, 48 Ko contre 23. Sur un fil de
#: vingt salons — quatre-vingts images chargées d'un coup, la grille du mur ne
#: virtualise pas — cela fait 1,5 Mo contre 0,8.
#:
#: **Le plafond ne se relit pas sur les images déjà rangées.** Une vignette
#: déposée hier reste à 480 : elle est plus lourde que nécessaire et parfaitement
#: correcte, et la regénérer coûterait un balayage de tout le dépôt pour un
#: gain qui se réalise de lui-même à mesure que les photos se remplacent.
COTE_VIGNETTE = 320

#: Le côté le plus long d'un aperçu flouté, en pixels.
#:
#: **Trente-deux, et c'est petit exprès.** L'aperçu remplace la photo pour qui
#: n'a pas payé : ce qui compte n'est pas qu'il soit joli mais qu'il ne
#: contienne plus le visage. À trente-deux pixels, il n'y a plus de visage dans
#: le fichier — pas caché, absent.
COTE_APERCU = 32

#: Le rayon du flou appliqué après la réduction, en pixels de l'image réduite.
#:
#: Deux sur trente-deux : de quoi effacer l'escalier des blocs sans faire un
#: aplat gris, qui ne dirait plus rien du tout. Le flou n'est pas ce qui
#: protège — la réduction l'a déjà fait — il rend seulement le résultat
#: regardable.
RAYON_FLOU = 2

#: Le côté le plus long d'un original rangé, en pixels.
#:
#: **L'original n'était pas borné du tout** : on rangeait ce qu'on recevait,
#: c'est-à-dire quatre mille pixels sortis d'un téléphone. Tant que le fil
#: servait la vignette, personne ne le payait. Le mur, lui, sert l'original —
#: une couverture pleine largeur sur 520 points ne peut pas se contenter de 480
#: pixels — et trois salons par écran de quatre mille pixels rendraient le
#: défilement impraticable sur le réseau d'un salon.
#:
#: **Deux mille, et pas moins.** Une couverture verticale se livre en
#: 1600 × 2000 : le plafond ne doit rien écrêter de ce format, seulement de ce
#: qui le dépasse. Il borne le grand côté, sans recadrer, comme la vignette.
COTE_ORIGINAL = 2000

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


def borner_l_original(brut: bytes, *, cote: int = COTE_ORIGINAL) -> bytes | None:
    """Réduit l'image **seulement si elle dépasse**, et rend `None` sinon.

    **La différence avec `vignette` est tout le sujet.** `vignette` réencode
    toujours : elle produit un JPEG à qualité 82 même quand l'image est déjà
    plus petite que la borne. Sur une vignette c'est sans conséquence — elle
    n'existe que pour être affichée petit. Sur l'original, ce serait une perte
    sèche appliquée à des images qui n'avaient rien à perdre : une page de carte
    photographiée en PNG net deviendrait un JPEG, et les prix s'y liraient moins
    bien qu'avant.

    On ne touche donc que ce qui dépasse. Une image dans les clous ressort
    **telle qu'elle est arrivée**, octet pour octet, et l'appelant garde ses
    octets d'origine.

    `None` couvre les trois cas où il n'y a rien à faire : image déjà dans les
    clous, Pillow absent, image illisible. L'appelant range l'original reçu.
    """
    module = _pillow()
    if module is None:
        return None

    try:
        with module.open(io.BytesIO(brut)) as source:
            if max(source.size) <= cote:
                return None
        return _reduire(brut, cote=cote, module=module)
    except OSError:
        return None


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


def apercu_floute(brut: bytes, *, cote: int = COTE_APERCU) -> bytes | None:
    """Un aperçu dont on ne peut plus tirer le visage. `None` si on ne sait pas.

    **Ce n'est pas un flou d'affichage, c'est une destruction d'information.**
    Un masque posé par l'écran n'est pas un contrôle d'accès : la photo est
    partie, et il suffit d'ouvrir l'outil de développement. Un flou appliqué à
    une image pleine taille ne vaut guère mieux — un flou gaussien léger se
    retire, et il reste toujours plus de pixels qu'il n'en faut pour reconnaître
    quelqu'un.

    L'aperçu est donc **réduit d'abord**, à une trentaine de pixels de côté, et
    flouté ensuite. Ce qui a été jeté à la réduction n'existe plus dans le
    fichier servi ; le flou ne fait qu'adoucir l'escalier des blocs. Ce qui
    reste est une tache de couleurs — assez pour qu'une liste ait des formes et
    des teintes, jamais assez pour reconnaître un visage.

    Le résultat pèse quelques centaines d'octets, ce qui est un effet de bord
    heureux : la liste d'un salon non abonné coûte moins cher que celle d'un
    abonné.
    """
    module = _pillow()
    if module is None:
        return None

    try:
        from PIL import ImageFilter, ImageOps

        with module.open(io.BytesIO(brut)) as source:
            redressee = ImageOps.exif_transpose(source) or source
            if redressee.mode != "RGB":
                redressee = redressee.convert("RGB")

            # **La réduction d'abord.** C'est elle qui détruit ; le flou seul
            # laisserait dans le fichier tous les pixels d'origine, atténués.
            redressee.thumbnail((cote, cote), module.LANCZOS)
            floutee = redressee.filter(ImageFilter.GaussianBlur(radius=RAYON_FLOU))

            sortie = io.BytesIO()
            floutee.save(sortie, format="JPEG", quality=QUALITE, optimize=True)
            return sortie.getvalue()
    except OSError:
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
