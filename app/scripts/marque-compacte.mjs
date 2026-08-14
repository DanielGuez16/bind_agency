/**
 * La marque en petit : le bloc, avec le point évidé.
 *
 * **Pourquoi elle existe.** Quatre lettres ne tiennent pas dans seize pixels.
 * Le logotype y donnait quatre taches, et refuser de le réduire était juste —
 * mais laisser le favicon dans cet état l'était moins. Design a livré un dessin
 * qui part des deux signes que la marque possède vraiment : le bloc orange
 * plein, et le point d'exclamation. Le second est **évidé** dans le premier.
 *
 * C'est ce qui empêche la lecture parasite. Un point d'exclamation orange sur
 * fond blanc est un panneau d'alerte ; le même point creusé dans un carré plein
 * devient une marque, parce que l'objet reconnu est le carré et le signe ce qui
 * y manque.
 *
 * **Tout est en unités d'une grille de seize**, et c'est la contrainte qui
 * porte le dessin : chaque cote tombe sur un pixel entier à 16, 32, 64 et 128.
 * La forme est donc *la même* à ces tailles, au lieu d'être arrondie
 * différemment à chacune. C'est aussi pourquoi ce fichier ne passe pas par un
 * navigateur : il n'y a ni texte ni dégradé ici, seulement des rectangles
 * alignés sur la grille. Les écrire directement est exact ; les faire peindre
 * puis relire ne le serait pas davantage, et laisserait entrer un lissage.
 *
 * **Deux couleurs, exactement.** Sans lissage, un blanc de deux unités reste
 * deux pixels : il ne se comble pas en gris. La contrainte garantit le dessin
 * au lieu de le menacer.
 *
 * Ce fichier ne fournit que la géométrie et les rendus. Ce qui les écrit sur le
 * disque est `cuire-la-marque.mjs`.
 */
import { PNG } from 'pngjs';

/** La grille. Toutes les cotes ci-dessous sont dans cette unité. */
export const GRILLE = 16;

/**
 * Le dessin, recopié de `BIND Mark - Favicon 16.dc.html`.
 *
 * **Le fût est trapu, et c'est voulu.** Un vrai point d'exclamation a un fût
 * quatre fois plus haut que large ; à seize pixels ce rapport donne un fût d'un
 * pixel, qui disparaît. Six sur quatre est le rapport le plus élancé qui
 * survive — c'est précisément pourquoi ce dessin n'est pas une réduction du
 * logotype, et pourquoi le remplacer par une réduction le casserait.
 *
 * **Le point est carré, pas rond.** Un disque de quatre pixels en deux couleurs
 * n'est pas un disque : c'est un carré à coins mordus, et il tremble d'une
 * taille à l'autre. Le carré est franc et s'accorde à l'angle droit du système.
 */
export const SIGNE = [
  /** Le fût. */
  { x: 6, y: 2, largeur: 4, hauteur: 6 },
  /** Le point. Deux unités de blanc le séparent du fût. */
  { x: 6, y: 10, largeur: 4, hauteur: 4 },
];

/**
 * Ce que les plateformes ont le droit de mordre.
 *
 * Le signe est centré, à deux unités du haut et du bas, six de chaque côté. Un
 * masque circulaire ou arrondi entame donc le fond, jamais le dessin — rien à
 * redessiner pour une tuile d'application.
 *
 * *Écart relevé sur la planche :* sa dernière colonne annonce « quatre à gauche
 * et à droite ». La géométrie qu'elle donne huit fois, et son tableau de cotes,
 * disent six — quatre est la largeur du signe, pas sa marge. C'est la géométrie
 * qui fait foi ici, et l'affirmation sur les masques tient mieux encore avec
 * six.
 */
export const MARGES = { haut: 2, bas: 2, gauche: 6, droite: 6 };

function enCanaux(hexa) {
  const n = parseInt(hexa.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * La tuile, à `cote` pixels.
 *
 * **Les bords sont arrondis à l'entier, jamais laissés en fraction.** Aux
 * tailles multiples de seize la question ne se pose pas. Ailleurs — l'icône
 * d'iOS fait 180, qu'Apple impose et qui vaut 11,25 unités — une cote
 * fractionnaire ferait lisser le bord par n'importe quel moteur de rendu, et le
 * dessin sortirait en trois couleurs au lieu de deux. Arrondir garde deux
 * couleurs franches et déplace un bord d'un demi-pixel.
 */
export function tuile(cote, surface, encre) {
  const png = new PNG({ width: cote, height: cote });
  const fond = enCanaux(surface);
  const trait = enCanaux(encre);
  const unite = cote / GRILLE;

  const dansLeSigne = (x, y) =>
    SIGNE.some(
      (part) =>
        x >= Math.round(part.x * unite) &&
        x < Math.round((part.x + part.largeur) * unite) &&
        y >= Math.round(part.y * unite) &&
        y < Math.round((part.y + part.hauteur) * unite),
    );

  for (let y = 0; y < cote; y += 1) {
    for (let x = 0; x < cote; x += 1) {
      const i = (cote * y + x) << 2;
      const [r, v, b] = dansLeSigne(x, y) ? trait : fond;
      png.data[i] = r;
      png.data[i + 1] = v;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return png;
}

export function enPng(cote, surface, encre) {
  return PNG.sync.write(tuile(cote, surface, encre));
}

/**
 * Un `.ico` portant plusieurs tailles, chacune **dessinée** et non réduite.
 *
 * C'est tout l'intérêt de le fabriquer ici plutôt que de laisser la chaîne le
 * produire : `expo export` compile un `.ico` de trois images en *réduisant* le
 * PNG source, et une réduction lisse — elle rendrait en gris le blanc de deux
 * unités que le dessin protège. Chaque taille est donc tracée sur la grille.
 *
 * Les entrées sont des PNG. Le format l'admet depuis Vista et tous les
 * navigateurs le lisent ; ce sont les seuls consommateurs d'un favicon.
 */
export function enIco(cotes, surface, encre) {
  const images = cotes.map((cote) => enPng(cote, surface, encre));

  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0); // réservé
  entete.writeUInt16LE(1, 2); // 1 = icône
  entete.writeUInt16LE(cotes.length, 4);

  let decalage = 6 + 16 * cotes.length;
  const repertoire = cotes.map((cote, rang) => {
    const entree = Buffer.alloc(16);
    // 0 signifie 256 dans ce format ; aucune de nos tailles ne l'atteint.
    entree.writeUInt8(cote >= 256 ? 0 : cote, 0);
    entree.writeUInt8(cote >= 256 ? 0 : cote, 1);
    entree.writeUInt8(0, 2); // couleurs de palette : 0, l'image est en vraies couleurs
    entree.writeUInt8(0, 3); // réservé
    entree.writeUInt16LE(1, 4); // plans
    entree.writeUInt16LE(32, 6); // bits par pixel
    entree.writeUInt32LE(images[rang].length, 8);
    entree.writeUInt32LE(decalage, 12);
    decalage += images[rang].length;
    return entree;
  });

  return Buffer.concat([entete, ...repertoire, ...images]);
}
