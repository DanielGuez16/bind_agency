"""Le monogramme BIND, aux quatre tailles du favicon.

Rejoué à la main plutôt qu'exporté d'un outil : la géométrie vit déjà dans
`src/components/Logo.tsx`, et deux sources finiraient par diverger. Ce script
la reprend telle quelle — hampe et deux arcs sur une grille de 32, trait à
2,75 — et rend des PNG.

**Le 16 est un dessin distinct, pas une réduction.** Sous 32, un trait rond sur
trois pixels devient une bouillie grise : le trait s'épaissit et les extrémités
passent en coupe droite. C'est la seule taille qui déroge, et elle y gagne le
seul critère qui compte à seize pixels — qu'on reconnaisse un B.

**Aucune version ne porte de texte.** Le nom n'accompagne le signe que sur
l'accueil et la connexion, où il y a la place ; à seize pixels il ferait quatre
taches illisibles.

    python scripts/marque.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

RACINE = Path(__file__).resolve().parents[1] / "assets"

#: `accent.default` du thème sombre sur `bg.inverse` : le signe clair sur
#: l'encre. C'est la seule paire qui tient à seize pixels — l'accent du thème
#: clair sur la même encre passerait pour du gris.
SIGNE = (0x3F, 0xE3, 0xC6, 0xFF)
ENCRE = (0x14, 0x10, 0x1F, 0xFF)

#: La grille de référence, celle du `viewBox` du composant.
GRILLE = 32
#: Le trait, à cette grille. Même densité que les icônes du produit.
TRAIT = 2.75

#: Le monogramme occupe 20 des 32 unités en largeur : le reste est la marge du
#: favicon, qui doit tenir dans un onglet sans toucher les bords.
MARGE = 0.14


def _dessiner(taille: int, echelle: int, trait: float, extremites_rondes: bool) -> Image.Image:
    """Le signe, dessiné à `echelle` fois la taille voulue puis réduit.

    Le suréchantillonnage est ce qui donne des bords propres : `ImageDraw` ne
    lisse rien, et un arc tracé directement à 32 pixels sort en escalier.
    """
    cote = taille * echelle
    image = Image.new("RGBA", (cote, cote), ENCRE)
    trace = ImageDraw.Draw(image)

    # De la grille de 32 aux pixels, marge comprise.
    utile = cote * (1 - 2 * MARGE)
    decalage = cote * MARGE

    def point(x: float, y: float) -> tuple[float, float]:
        return (decalage + x / GRILLE * utile, decalage + y / GRILLE * utile)

    epaisseur = max(1, round(trait / GRILLE * utile))

    # La hampe.
    trace.line([point(9, 3), point(9, 29)], fill=SIGNE, width=epaisseur)

    # Les deux panses. Chacune : un trait vers la droite, un demi-cercle, un
    # trait de retour. Les coordonnées sont celles des chemins du composant.
    for haut, bas, droite, rayon in ((5, 16, 13.5, 5.5), (16, 27, 15, 5.5)):
        centre_y = (haut + bas) / 2
        trace.line([point(9, haut), point(droite, haut)], fill=SIGNE, width=epaisseur)
        trace.line([point(9, bas), point(droite, bas)], fill=SIGNE, width=epaisseur)
        gauche_x, haut_y = point(droite - rayon, centre_y - rayon)
        droite_x, bas_y = point(droite + rayon, centre_y + rayon)
        trace.arc(
            [gauche_x, haut_y, droite_x, bas_y],
            start=270,
            end=90,
            fill=SIGNE,
            width=epaisseur,
        )

    if extremites_rondes:
        # `ImageDraw` coupe droit. Aux tailles où le rond se voit, on le pose.
        for x, y in (point(9, 3), point(9, 29), point(9, 5), point(9, 16), point(9, 27)):
            rayon = epaisseur / 2
            trace.ellipse([x - rayon, y - rayon, x + rayon, y + rayon], fill=SIGNE)

    return image.resize((taille, taille), Image.LANCZOS) if echelle > 1 else image


def main() -> None:
    # 32 et au-delà : le trait du système, les extrémités rondes, et un
    # suréchantillonnage de huit qui rend les arcs lisses.
    for taille in (32, 64, 180):
        image = _dessiner(taille, echelle=8, trait=TRAIT, extremites_rondes=True)
        image.save(RACINE / f"marque-{taille}.png")
        print(f"  marque-{taille}.png")

    # Seize : le dessin distinct. Trait épaissi de moitié, coupe droite, et
    # aucun suréchantillonnage — c'est lui qui étalerait le trait sur deux
    # pixels gris au lieu d'un pixel franc.
    seize = _dessiner(16, echelle=1, trait=TRAIT * 1.5, extremites_rondes=False)
    # **Enregistré en deux couleurs, et c'est vérifiable.** Le dessin distinct
    # n'a aucun pixel intermédiaire : le dire dans un commentaire n'engage
    # personne, l'enregistrer en palette de deux entrées le prouve — une
    # réduction du trente-deux, elle, en demanderait des dizaines. Le fichier
    # y gagne au passage la moitié de son poids.
    seize.convert("P", palette=Image.ADAPTIVE, colors=2).save(RACINE / "marque-16.png")
    print("  marque-16.png (dessin distinct, deux couleurs)")

    # L'icône de l'application, sur la même encre. Le chevron qu'elle portait
    # est retiré : le signe est le monogramme, partout.
    _dessiner(1024, echelle=2, trait=TRAIT, extremites_rondes=True).convert("RGB").save(
        RACINE / "icon.png"
    )
    print("  icon.png")

    # Le favicon du web est le 32 : les navigateurs le réduisent eux-mêmes à
    # 16 dans l'onglet, et leur réduction vaut la nôtre au-dessus de ce seuil.
    _dessiner(64, echelle=8, trait=TRAIT, extremites_rondes=True).save(RACINE / "favicon.png")
    print("  favicon.png")


if __name__ == "__main__":
    main()
