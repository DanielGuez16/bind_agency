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
import { readFileSync } from 'node:fs';

import { PNG } from 'pngjs';

/**
 * La géométrie et les couleurs viennent des jetons, **jamais recopiées ici**.
 *
 * `logo.mark16` porte le dessin complet : la grille, la tuile, le fût, le
 * point, les marges, la palette. Ce fichier ne fait que le tracer.
 */
const MARK16 = JSON.parse(
  readFileSync(new URL('../src/theme/tokens.json', import.meta.url), 'utf-8'),
).logo.mark16;

/** La grille. Toutes les cotes ci-dessous sont dans cette unité. */
export const GRILLE = MARK16.grid;

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
  /** Le fût, à l'encre claire — il suit les lettres du logotype. */
  { ...enRectangle(MARK16.stem), role: 'fut', couleur: MARK16.stem.fill },
  /** Le point, orange. Deux unités le séparent du fût. */
  { ...enRectangle(MARK16.dot), role: 'point', couleur: MARK16.dot.fill },
];

function enRectangle(part) {
  return { x: part.x, y: part.y, largeur: part.w, hauteur: part.h };
}

/** Le fond de la tuile : encre, et non orange. */
export const TUILE = MARK16.tile.fill;

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
export const MARGES = {
  haut: MARK16.margin.top,
  bas: MARK16.margin.bottom,
  gauche: MARK16.margin.left,
  droite: MARK16.margin.right,
};

function enCanaux(hexa) {
  const n = parseInt(hexa.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Quelle part du signe couvre ce pixel, ou `null` pour le fond.
 *
 * **Les bords sont arrondis à l'entier, jamais laissés en fraction.** Aux
 * tailles multiples de seize la question ne se pose pas. Ailleurs — l'icône
 * d'iOS fait 180, qu'Apple impose et qui vaut 11,25 unités — une cote
 * fractionnaire ferait lisser le bord par n'importe quel moteur de rendu, et le
 * dessin sortirait avec des couleurs qui ne sont dans aucun jeton. Arrondir
 * garde des aplats francs et déplace un bord d'un demi-pixel.
 */
function partSous(x, y, unite, marge = 0) {
  return (
    SIGNE.find(
      (part) =>
        x >= Math.round(marge + part.x * unite) &&
        x < Math.round(marge + (part.x + part.largeur) * unite) &&
        y >= Math.round(marge + part.y * unite) &&
        y < Math.round(marge + (part.y + part.hauteur) * unite),
    ) ?? null
  );
}

/**
 * La tuile, à `cote` pixels.
 *
 * **Trois couleurs, et c'est le sujet.** La contrainte de palette à deux
 * couleurs est tombée avec la correction du 2026-08-15 : le sens du logotype
 * *est* le contraste entre les lettres et le point, et il ne survit pas à une
 * palette qui ne peut pas porter les deux. Le fût prend l'encre claire, le
 * point l'orange, la tuile l'encre — et le fond est encre et non orange, parce
 * que sur une tuile orange le point disparaîtrait, et c'est lui la marque.
 */
export function tuile(cote) {
  const png = new PNG({ width: cote, height: cote });
  const fond = enCanaux(TUILE);
  const unite = cote / GRILLE;

  for (let y = 0; y < cote; y += 1) {
    for (let x = 0; x < cote; x += 1) {
      const i = (cote * y + x) << 2;
      const part = partSous(x, y, unite);
      const [r, v, b] = part ? enCanaux(part.couleur) : fond;
      png.data[i] = r;
      png.data[i + 1] = v;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return png;
}

/**
 * Une **couche** : le signe seul, sur du vide.
 *
 * Android ne masque pas une tuile, il en compose deux et rogne le tout : sur
 * les 108 unités de son gabarit, seules les 72 du centre sont garanties
 * visibles. Une tuile pleine posée là verrait son signe coupé en haut et en
 * bas — il occupe douze unités sur seize, soit trois quarts de la tuile, quand
 * le masque n'en garantit que deux tiers.
 *
 * La grille de seize est donc ramenée à la **zone sûre**, et le fond est
 * fourni par l'autre couche. Après masquage, ce qu'on voit est exactement la
 * marque compacte — c'est la composition d'Android qui restitue la tuile, pas
 * nous qui la redessinons.
 *
 * 432 est le gabarit d'Android à quatre fois la densité de référence ; sa zone
 * sûre vaut 288, soit dix-huit pixels par unité. Aucun arrondi.
 *
 * `encreUnique` sert la couche monochrome, qu'Android teinte lui-même : elle ne
 * porte qu'une silhouette, donc le point y perd sa couleur. C'est le seul
 * endroit du système où le point n'est pas orange, et c'est la plateforme qui
 * l'impose — pas nous.
 */
export function couche(cote, zoneSure, encreUnique = null) {
  const png = new PNG({ width: cote, height: cote });
  const unite = zoneSure / GRILLE;
  const marge = (cote - zoneSure) / 2;

  for (let y = 0; y < cote; y += 1) {
    for (let x = 0; x < cote; x += 1) {
      const i = (cote * y + x) << 2;
      const part = partSous(x, y, unite, marge);
      if (part) {
        const [r, v, b] = enCanaux(encreUnique ?? part.couleur);
        png.data[i] = r;
        png.data[i + 1] = v;
        png.data[i + 2] = b;
        png.data[i + 3] = 255;
      } else {
        // Le vide est **transparent et noir**, pas transparent et coloré : un
        // pixel transparent qui porte une couleur la laisse remonter dès qu'un
        // rendu prémultiplie, et l'icône gagne un halo.
        png.data[i] = 0;
        png.data[i + 1] = 0;
        png.data[i + 2] = 0;
        png.data[i + 3] = 0;
      }
    }
  }
  return png;
}

/** Un aplat : la couche de fond d'Android, que le masque entame seul. */
export function aplat(cote, surface) {
  const png = new PNG({ width: cote, height: cote });
  const fond = enCanaux(surface);
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = fond[0];
    png.data[i + 1] = fond[1];
    png.data[i + 2] = fond[2];
    png.data[i + 3] = 255;
  }
  return png;
}

export function enPng(cote) {
  return PNG.sync.write(tuile(cote));
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
export function enIco(cotes) {
  const images = cotes.map((cote) => enPng(cote));

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
