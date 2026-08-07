"""Images de démonstration, générées et non téléchargées.

**Pourquoi générer plutôt que récupérer.** Des photos libres de droits existent,
mais les embarquer signifie des mégaoctets dans le dépôt et une question de
licence à retrancher à chaque fichier ; les télécharger au moment du jeu de
données rend celui-ci dépendant du réseau, y compris en intégration continue, où
il tourne à chaque exécution. Générer donne des images stables, sans réseau,
sans licence, et identiques d'une machine à l'autre.

**Elles ne ressemblent pas à des placeholders.** Pas de rayures, pas de mot
« image », pas de croix. Un fond bi-ton et deux formes douces : de loin, sur une
carte de 150 points de haut, cela se lit comme une photographie floue — ce qui
est exactement le rôle qu'on lui demande de tenir pendant une démonstration.

**Aucune dépendance ajoutée.** Un encodeur PNG tient en trente lignes avec
`zlib` et `struct`, tous deux dans la bibliothèque standard. Ajouter Pillow au
produit entier pour une préoccupation de démonstration serait payer un coût
permanent pour un besoin temporaire.

**La teinte est dérivée du nom.** Deux exécutions du jeu de données produisent
les mêmes images, et deux prestations différentes ne partagent pas la leur —
sinon une carte de salon paraîtrait n'avoir qu'une photo répétée.
"""

import hashlib
import struct
import zlib

#: Les trois formats du produit, repris de la passation : couverture 16:9,
#: prestation 1:1, vignette.
#:
#: Volontairement petites. Elles s'affichent sur 150 points de haut ; les
#: générer en 640 de large coûtait une demi-seconde et 380 Ko chacune, pour une
#: différence que personne ne voit. Un jeu de données qui met vingt secondes à
#: fabriquer ses images finit par ne plus être rejoué.
COUVERTURE = (400, 225)
PRESTATION = (320, 320)
VIGNETTE = (128, 128)


def _teinte(graine: int) -> tuple[int, int, int]:
    """Une couleur douce et jamais criarde.

    Saturation et luminosité sont bornées : une teinte pleine ferait une image
    qui attire l'œil plus que le contenu, et une carte de fil deviendrait un
    échantillonneur de couleurs.
    """
    h = (graine % 360) / 360.0
    s, v = 0.34, 0.78

    i = int(h * 6)
    f = h * 6 - i
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r, g, b = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i % 6]
    return int(r * 255), int(g * 255), int(b * 255)


def _melange(a: tuple[int, int, int], b: tuple[int, int, int], part: float) -> tuple[int, int, int]:
    return tuple(int(x + (y - x) * part) for x, y in zip(a, b, strict=True))  # type: ignore[return-value]


def _png(largeur: int, hauteur: int, pixels: bytes) -> bytes:
    """Encode un PNG RVB sans perte.

    Chaque ligne est préfixée d'un octet de filtre à zéro — « aucun filtre ».
    Les filtres servent à mieux compresser des photographies ; sur des aplats
    dégradés, ils n'apportent rien et compliqueraient trente lignes qui doivent
    rester lisibles.
    """

    def bloc(nom: bytes, donnees: bytes) -> bytes:
        return (
            struct.pack(">I", len(donnees))
            + nom
            + donnees
            + struct.pack(">I", zlib.crc32(nom + donnees) & 0xFFFFFFFF)
        )

    entete = struct.pack(">IIBBBBB", largeur, hauteur, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + bloc(b"IHDR", entete)
        + bloc(b"IDAT", zlib.compress(pixels, 9))
        + bloc(b"IEND", b"")
    )


def image(nom: str, taille: tuple[int, int] = COUVERTURE) -> bytes:
    """Une image dérivée du nom, stable et sans texte.

    Trois couches, et chacune corrige un défaut de la précédente.

    Le **dégradé diagonal** seul se lit comme un fond d'application. Les **deux
    taches de lumière** décentrées lui donnent une composition, comme une source
    lumineuse hors cadre. Le **grain** est ce qui fait basculer la lecture : un
    aplat parfaitement lisse ne ressemble à rien de photographié, et l'œil le
    range immédiatement dans « image manquante ». Un bruit de quelques niveaux
    suffit, invisible de près, décisif de loin.

    Le **vignettage** ferme la composition : sans lui, les bords restent trop
    clairs et l'image paraît déborder de son cadre.
    """
    graine = int(hashlib.sha256(nom.encode()).hexdigest()[:8], 16)
    largeur, hauteur = taille

    haut = _teinte(graine)
    bas = _teinte(graine + 47)
    clair = _melange(haut, (255, 255, 255), 0.42)

    # Deux sources, décentrées de façon reproductible. Leurs rayons dépendent de
    # la plus petite dimension pour que la composition tienne aussi bien en 16:9
    # qu'en carré.
    court = min(largeur, hauteur)
    sources = (
        (
            largeur * (0.22 + (graine >> 8 & 0xFF) / 255 * 0.4),
            hauteur * (0.18 + (graine >> 16 & 0xFF) / 255 * 0.4),
            court * 0.48,
            0.62,
        ),
        (
            largeur * (0.58 + (graine >> 24 & 0x3F) / 63 * 0.34),
            hauteur * (0.55 + (graine >> 4 & 0x3F) / 63 * 0.34),
            court * 0.3,
            0.34,
        ),
    )

    milieu_x, milieu_y = largeur / 2, hauteur / 2
    diagonale = (milieu_x**2 + milieu_y**2) ** 0.5

    # Générateur de bruit déterministe : même nom, même grain. `random` aurait
    # marché, mais dépendre de son état global rendrait deux appels successifs
    # dépendants de leur ordre.
    bruit = graine | 1

    lignes = bytearray()
    for y in range(hauteur):
        lignes.append(0)  # octet de filtre
        for x in range(largeur):
            part = (x / largeur + y / hauteur) / 2
            r, g, b = _melange(haut, bas, part)

            for cx, cy, rayon, force in sources:
                distance = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                if distance < rayon:
                    # Bord adouci sur les derniers 40 % du rayon : un cercle net
                    # ferait forme géométrique, un cercle fondu fait lumière.
                    douceur = min(1.0, (rayon - distance) / (rayon * 0.4))
                    r, g, b = _melange((r, g, b), clair, force * douceur * douceur)

            # Vignettage : deux dixièmes d'assombrissement dans les coins.
            bord = ((x - milieu_x) ** 2 + (y - milieu_y) ** 2) ** 0.5 / diagonale
            facteur = 1.0 - 0.22 * bord * bord

            # Amplitude modeste : au-delà, le grain cesse d'être une texture et
            # devient du bruit — et il fait exploser la taille du fichier, un
            # PNG compressant mal ce qui n'a pas de motif.
            bruit = (bruit * 1103515245 + 12345) & 0x7FFFFFFF
            grain = (bruit >> 16 & 0x07) - 4

            lignes.append(max(0, min(255, int(r * facteur) + grain)))
            lignes.append(max(0, min(255, int(g * facteur) + grain)))
            lignes.append(max(0, min(255, int(b * facteur) + grain)))

    return _png(largeur, hauteur, bytes(lignes))
