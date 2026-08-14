/**
 * Cuisson des fichiers de la marque.
 *
 * **Ce qu'il remplace, et pourquoi il fallait tout reprendre.** Le script
 * précédent dessinait à la main, en Python, un « B » construit — deux arcs
 * inégaux tenus par un axe débordant — en vert d'eau sur un indigo. C'était le
 * monogramme du système d'avant. Il a traversé le remplacement complet de la
 * direction artistique sans que rien ne l'arrête : les jetons ont changé, les
 * fontes ont changé, les écrans ont changé, et l'onglet du navigateur montrait
 * toujours l'ancienne marque. Une icône ne se relit jamais, c'est tout le
 * problème.
 *
 * **La marque est le mot.** `B!ND`, le point d'exclamation à la place du I. Il
 * n'y a plus de signe à côté du mot, donc plus de monogramme à réduire : ces
 * fichiers portent le mot lui-même.
 *
 * **C'est le navigateur qui peint, avec la fonte du produit.** Le fichier
 * `.ttf` est celui que l'application embarque, lu depuis `node_modules` et
 * inséré dans la page : pas une fonte système qui lui ressemble, pas une
 * approximation. Même raisonnement que pour les satins — réimplémenter un
 * rendu de texte en aurait fait une ressemblance à vérifier à l'œil.
 *
 * **Ce que ces fichiers ne sont pas.** Le logo de l'agence est dessiné à la
 * main : le D porte une coupe oblique qu'aucune fonte ne donne. Ceci est donc
 * la meilleure approximation disponible, et elle est nommée comme telle dans
 * `tokens.json` (`$meta.unconfirmed`). Le jour où le vectoriel arrive, ce
 * script est remplacé par un tracé — pas retouché.
 *
 * **Seize pixels ne lisent pas quatre lettres, et on ne l'invente pas.** La
 * tentation serait d'y mettre un « B » seul, ou un « B! » : ce serait dessiner
 * un monogramme que personne n'a validé, c'est-à-dire refaire exactement ce
 * qu'on vient de retirer. À cette taille l'identité tient à la couleur — une
 * tuile orange dans un onglet se reconnaît sans se lire — et le mot y est
 * présent, dense, plutôt qu'inventé.
 *
 * Relancer : `node scripts/cuire-la-marque.mjs`
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');
const SORTIE = join(RACINE, 'assets');
/**
 * Ce que le navigateur va chercher à la racine du site.
 *
 * `public/` est recopié tel quel à la racine du build par `expo export` —
 * vérifié, pas supposé. C'est ce qui permet de poser l'icône d'iOS **sans
 * remplacer le gabarit HTML** qu'Expo génère : Safari demande
 * `/apple-touch-icon.png` par convention quand aucune balise ne la déclare, et
 * le gabarit d'Expo n'en déclare aucune — il n'écrit qu'un `<link rel="icon">`.
 */
const PUBLIC = join(RACINE, 'public');

/** Les jetons, lus et non recopiés : deux sources finiraient par diverger. */
const jetons = JSON.parse(await readFile(join(RACINE, 'src/theme/tokens.json'), 'utf-8'));
const produit = JSON.parse(await readFile(join(RACINE, 'src/theme/produit.json'), 'utf-8'));

/** La surface de marque, et l'encre claire qui s'y pose. */
const ORANGE = jetons.color.brand['500'];
const CLAIR = jetons.color.ink.onDark;
/** L'encre, pour la version qu'Android teinte lui-même. */
const ENCRE = jetons.color.ink.default;

const MOT = jetons.logo.wordmark.text;
const INTERLETTRE = jetons.logo.wordmark.letterSpacing;
const GRAISSE = produit.type['type.wordmark'].weight;

const ttf = await readFile(
  join(RACINE, 'node_modules/@expo-google-fonts/outfit/300Light/Outfit_300Light.ttf'),
);
const FONTE = `data:font/ttf;base64,${ttf.toString('base64')}`;

/**
 * Une tuile carrée portant le mot.
 *
 * Le mot occupe `part` de la largeur : les icônes d'application respirent
 * (Android masque les bords, iOS arrondit), le favicon serre pour rester
 * lisible dans un onglet.
 */
function page({ cote, fond, encre, part }) {
  return `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: 'Marque'; src: url('${FONTE}') format('truetype'); font-weight: 300; }
    html, body { margin: 0; padding: 0; }
    .tuile {
      width: ${cote}px; height: ${cote}px;
      background: ${fond};
      display: flex; align-items: center; justify-content: center;
      /* Le mot est vectoriel jusqu'à la capture : la taille se donne en
         proportion du côté, jamais en pixels arrondis d'une taille de
         référence — un 180 obtenu en agrandissant un 64 serait flou. */
      font-family: 'Marque'; font-weight: ${GRAISSE};
      color: ${encre};
      /* L'interlettrage pousse la dernière lettre hors du bloc centré :
         la moitié en marge gauche recentre optiquement. */
      letter-spacing: ${INTERLETTRE * (cote / 64)}px;
      padding-left: ${(INTERLETTRE * (cote / 64)) / 2}px;
      box-sizing: border-box;
      font-size: ${cote * part}px;
      line-height: 1;
      white-space: nowrap;
      -webkit-font-smoothing: antialiased;
    }
  </style><div class="tuile">${MOT}</div>`;
}

/** Les fichiers, et ce que chacun doit être. */
const FICHIERS = [
  // Le mot clair sur la surface de marque : c'est le traitement en bloc de la
  // fondatrice, à la taille où le blanc sur orange passe largement.
  { nom: 'icon.png', cote: 1024, fond: ORANGE, encre: CLAIR, part: 0.2 },
  { nom: 'splash-icon.png', cote: 1024, fond: ORANGE, encre: CLAIR, part: 0.2 },
  // **Une seule source pour tout le favicon du web.** Expo compile
  // `assets/favicon.png` en un `.ico` de trois images — 16, 32 et 48 — et
  // n'écrit qu'un `<link rel="icon">` vers lui. Les quatre `marque-*.png` qui
  // vivaient ici doublaient donc ce que la chaîne produit déjà, sans que rien
  // ne les réclame : quatre fichiers portant la marque que personne ne
  // regarde, c'est-à-dire exactement ce qui a laissé l'ancien logo survivre.
  { nom: 'favicon.png', cote: 64, fond: ORANGE, encre: CLAIR, part: 0.32 },

  // L'icône d'iOS, la seule des quatre qui avait une destination réelle : 180
  // est sa taille. Elle est **posée là où Safari la cherche** plutôt que rangée
  // dans `assets/`, où rien ne serait jamais allé la prendre.
  {
    nom: 'apple-touch-icon.png',
    dossier: PUBLIC,
    cote: 180,
    fond: ORANGE,
    encre: CLAIR,
    part: 0.26,
  },

  // **Android masque la forme et compose trois couches.** Le premier plan doit
  // tenir dans la zone sûre — les deux tiers du centre — parce que le système
  // rogne les bords selon le masque du constructeur.
  { nom: 'android-icon-background.png', cote: 512, fond: ORANGE, encre: ORANGE, part: 0 },
  {
    nom: 'android-icon-foreground.png',
    cote: 512,
    fond: 'transparent',
    encre: CLAIR,
    part: 0.14,
  },
  // La monochrome est teintée par le système : elle se livre en encre pleine
  // sur du vide, jamais en couleur de marque.
  {
    nom: 'android-icon-monochrome.png',
    cote: 432,
    fond: 'transparent',
    encre: ENCRE,
    part: 0.14,
  },
];

await mkdir(SORTIE, { recursive: true });
await mkdir(PUBLIC, { recursive: true });
const navigateur = await chromium.launch();

for (const fichier of FICHIERS) {
  const contexte = await navigateur.newContext({
    viewport: { width: fichier.cote, height: fichier.cote },
    // Le fond de la page reste transparent : sans cela, les couches Android
    // arriveraient sur du blanc et le masque montrerait un anneau.
    ...(fichier.fond === 'transparent' ? {} : {}),
  });
  const onglet = await contexte.newPage();
  await onglet.setContent(page(fichier));
  await onglet.evaluate(() => document.fonts.ready);
  await onglet.screenshot({
    path: join(fichier.dossier ?? SORTIE, fichier.nom),
    omitBackground: fichier.fond === 'transparent',
  });
  await contexte.close();
  console.log(`  ${fichier.nom}  ${fichier.cote}px`);
}

await navigateur.close();

// Ce que les fichiers portent, écrit à côté d'eux : un test compare les
// couleurs trouvées dans les PNG à celles-ci, et refuse toute autre.
await writeFile(
  join(SORTIE, 'marque.json'),
  `${JSON.stringify(
    {
      $pourquoi:
        "Les couleurs que les fichiers de la marque ont le droit de porter. Produit par scripts/cuire-la-marque.mjs, lu par __tests__/marque.test.ts. L'ancien monogramme vert a traversé le remplacement complet du système sans que rien ne l'arrête : c'est cette liste qui l'aurait arrêté.",
      mot: MOT,
      couleurs: { surface: ORANGE, encreClaire: CLAIR, encre: ENCRE },
    },
    null,
    2,
  )}\n`,
);
console.log('  marque.json');
