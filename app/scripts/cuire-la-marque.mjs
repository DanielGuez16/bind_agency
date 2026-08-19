/**
 * Cuisson des fichiers de la marque.
 *
 * ---
 *
 * ## La règle
 *
 * **Le logotype partout où on a la place de le lire, la marque compacte
 * partout ailleurs. Le seuil est la lisibilité des quatre lettres, pas le
 * support.**
 *
 * Elle s'est écrite en trois temps, et chacun a coûté une découverte. Le
 * logotype réduit à seize pixels donnait quatre taches ; refuser de le réduire
 * était juste, mais laisser le favicon dans cet état l'était moins. Design a
 * livré la marque compacte. Restait la tuile d'application, gardée au logotype
 * parce qu'elle est fournie en 1024 — jusqu'à mesurer ce qu'un lanceur en
 * affiche : **vingt-sept pixels de large pour quatre lettres** à 48 dp. La
 * résolution du fichier n'a jamais été la question.
 *
 * **Ce script ne produit donc plus que la marque compacte.** Tous ses fichiers
 * sont des tuiles, et aucune tuile ne s'affiche assez grand. Le logotype n'est
 * plus cuit du tout : il ne vit que dans l'interface, en texte, là où l'écran
 * lui donne la place — la règle exprimée par la structure plutôt que par un
 * commentaire.
 *
 * Le seuil est mesuré, pas choisi. `B!ND` dans la fonte du produit occupe
 * 0,592 fois le corps par lettre. Dix pixels par lettre est encadré par deux
 * mesures : 6,75 au lanceur Android, dont la capture est illisible, et 11,1 au
 * plus petit usage in-app, qui se lit. `Marque` refuse de rendre en dessous.
 *
 * ---
 *
 * **Il n'y a plus de navigateur ici.** Il en fallait un tant que le logotype
 * était cuit : le texte se peint, il ne se calcule pas. La marque compacte est
 * faite de rectangles alignés sur une grille de seize — les écrire directement
 * est exact, et ne laisse entrer aucun lissage.
 *
 * Voir `marque-compacte.mjs` pour la géométrie et ce qu'elle protège.
 *
 * Relancer : `node scripts/cuire-la-marque.mjs`
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

import { aplat, couche, enIco, enPng, GRILLE, MARGES, SIGNE, TUILE } from './marque-compacte.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');
const SORTIE = join(RACINE, 'assets');
/**
 * Ce que le navigateur va chercher à la racine du site.
 *
 * `public/` est recopié tel quel à la racine du build par `expo export` —
 * vérifié, pas supposé — et l'emporte sur ce qu'Expo génère. C'est ce qui
 * permet de livrer un `.ico` dont chaque taille est **dessinée** au lieu d'être
 * réduite, et de poser l'icône d'iOS sans remplacer le gabarit HTML : Safari
 * demande `/apple-touch-icon.png` par convention, et tout navigateur demande
 * `/favicon.ico`.
 */
const PUBLIC = join(RACINE, 'public');

/** Les jetons, lus et non recopiés : deux sources finiraient par diverger. */
const jetons = JSON.parse(await readFile(join(RACINE, 'src/theme/tokens.json'), 'utf-8'));
/** Le seuil de lisibilité, tenu du côté produit et lu ici — jamais recopié. */
const produit = JSON.parse(await readFile(join(RACINE, 'src/theme/produit.json'), 'utf-8'));

/**
 * Les trois couleurs du sigle, lues du dessin et non recomposées.
 *
 * **La tuile est encre, pas orange** — c'était l'inverse avant la correction du
 * 2026-08-15. Sur une tuile orange le point disparaîtrait, et c'est lui la
 * marque : le sens du sigle est le rapport entre le fût et le point, pas la
 * silhouette.
 */
// **Dérivée, plus lue.** Design a retiré la liste de `tokens.json` en v1.1 :
// elle énumérait trois hexadécimaux à côté d'une prose qui nommait trois
// jetons, et c'est la liste qui serait restée à l'orange brut. L'ordre est
// celui du dessin — tuile, fût, point.
const PALETTE = [jetons.color.ink.default, '#FFFFFF', jetons.logo.signature];

/**
 * Le gabarit d'Android, et sa zone sûre.
 *
 * 108 unités dont 72 garanties visibles. À quatre fois la densité de référence
 * cela fait 432 et 288 — et 288 vaut dix-huit pixels par unité de la grille de
 * seize, donc aucun arrondi.
 */
const ANDROID = { cote: 432, zoneSure: 288 };

/**
 * Ce que chaque fichier est, et **à quelle taille il est vu**.
 *
 * `afficheA` n'est pas la résolution du fichier : c'est ce que l'utilisateur en
 * voit. C'est la seule grandeur qui décide, et c'est celle qu'on avait cessé de
 * regarder en gardant le logotype sur une icône livrée en 1024.
 */
const FICHIERS = [
  { nom: 'favicon.ico', ou: 'public', afficheA: 16, pourquoi: "l'onglet du navigateur" },
  { nom: 'apple-touch-icon.png', ou: 'public', afficheA: 60, pourquoi: "l'écran d'accueil d'iOS" },
  { nom: 'icon.png', ou: 'assets', afficheA: 60, pourquoi: "la tuile d'application" },
  // Les trois couches d'Android. Le fond est un aplat : le signe vit dans la
  // couche de premier plan, et le masque du constructeur n'entame que lui.
  { nom: 'android-icon-background.png', ou: 'assets', afficheA: 48, aplat: true, pourquoi: 'le lanceur Android' },
  { nom: 'android-icon-foreground.png', ou: 'assets', afficheA: 48, couche: true, pourquoi: 'le lanceur Android' },
  { nom: 'android-icon-monochrome.png', ou: 'assets', afficheA: 48, couche: true, pourquoi: 'le lanceur en thème' },
];

await mkdir(SORTIE, { recursive: true });
await mkdir(PUBLIC, { recursive: true });

// Le favicon : trois tailles, chacune tracée. Une réduction rendrait gris le
// blanc de deux unités qui sépare le fût du point, et c'est ce qu'elle protège.
await writeFile(join(PUBLIC, 'favicon.ico'), enIco([16, 32, 48]));
console.log('  public/favicon.ico            16 · 32 · 48');

// 180 est la taille qu'Apple impose ; elle ne tombe pas sur la grille — 11,25
// unités — donc les bords sont arrondis à l'entier. Deux couleurs franches
// plutôt qu'un lissage, au prix d'un demi-pixel.
await writeFile(join(PUBLIC, 'apple-touch-icon.png'), enPng(180));
console.log('  public/apple-touch-icon.png   180');

// La tuile d'application. 1024 vaut soixante-quatre pixels par unité.
await writeFile(join(SORTIE, 'icon.png'), enPng(1024));
console.log('  assets/icon.png               1024');

// Android compose deux couches et rogne le tout : le fond est plein, le signe
// vit dans la zone sûre. Après masquage, ce qu'on voit est la tuile entière.
await writeFile(
  join(SORTIE, 'android-icon-background.png'),
  // Le fond de la composition d'Android : l'encre de la tuile.
  PNG.sync.write(aplat(ANDROID.cote, TUILE)),
);
await writeFile(
  join(SORTIE, 'android-icon-foreground.png'),
  // Le fût clair et le point orange, chacun sa couleur : c'est cette couche
  // qui porte la marque, le fond ne fait que la tenir.
  PNG.sync.write(couche(ANDROID.cote, ANDROID.zoneSure)),
);
// **La monochrome est une silhouette**, qu'Android teinte lui-même : le point y
// perd sa couleur, et c'est le seul endroit du système où cela arrive. La
// plateforme l'impose ; on ne le choisit pas.
await writeFile(
  join(SORTIE, 'android-icon-monochrome.png'),
  PNG.sync.write(couche(ANDROID.cote, ANDROID.zoneSure, jetons.color.ink.default)),
);
console.log(`  assets/android-icon-*.png     ${ANDROID.cote} · zone sûre ${ANDROID.zoneSure}`);

// Ce que les fichiers portent, écrit à côté d'eux : les tests comparent, et la
// règle s'y lit sans lire le script.
await writeFile(
  join(SORTIE, 'marque.json'),
  `${JSON.stringify(
    {
      $regle:
        "Le logotype partout où on a la place de le lire, la marque compacte partout ailleurs. Le seuil est la lisibilité des quatre lettres, pas le support : `afficheA` est ce que l'utilisateur voit, jamais la résolution du fichier. Tous les fichiers cuits sont des tuiles et aucune ne s'affiche assez grand — le logotype n'est donc plus cuit du tout, il ne vit qu'en texte dans l'interface.",
      $pourquoi:
        "Produit par scripts/cuire-la-marque.mjs, lu par __tests__/marque.test.ts. L'ancien monogramme vert a traversé le remplacement complet du système sans que rien ne l'arrête : ce fichier est ce qui l'aurait arrêté.",
      mot: jetons.logo.wordmark.text,
      couleurs: Object.fromEntries(PALETTE.map((c, r) => [['tuile', 'fut', 'point'][r], c])),
      palette: PALETTE,
      lisibilite: produit.marque,
      compacte: { grille: GRILLE, tuile: TUILE, signe: SIGNE, marges: MARGES, android: ANDROID },
      fichiers: FICHIERS.map((fichier) => ({ ...fichier, marque: 'compacte' })),
    },
    null,
    2,
  )}\n`,
);
console.log('  assets/marque.json');
