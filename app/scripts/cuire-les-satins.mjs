/**
 * Cuisson des trois satins.
 *
 * **Ce script ne tourne jamais dans l'application.** Il produit des fichiers,
 * une fois, et c'est exactement ce que la passation exige : « Les trois satins
 * sont livrés en images 2x et 3x, pas calculés à l'exécution. » React Native ne
 * sait pas empiler des radiales, et `expo-linear-gradient` donnerait la pente
 * droite que la direction refuse — un dégradé linéaire à deux arrêts est le
 * cliché qu'elle évite.
 *
 * **Les recettes sont celles de la planche, arrêt par arrêt.** Elles ne sont
 * pas déduites d'une photo : les visuels Instagram portent la même famille de
 * plis, mais compressés en JPEG, donc avec un banding qui n'appartient pas à la
 * charte. Recadrer un aplat de 8 bits abîmé par la compression aurait figé ce
 * défaut dans le produit, et il se serait vu sur les grandes surfaces — un
 * satin vit sur 240 px de haut au minimum.
 *
 * **C'est le navigateur qui peint, et pas nous.** Le rendu passe par le moteur
 * de Chromium, qui interprète la déclaration CSS de la planche telle quelle.
 * Réimplémenter l'ellipse et l'interpolation en aurait fait une approximation
 * de plus, à vérifier à l'œil ; ici il n'y a rien à vérifier, c'est le même
 * peintre. La dépendance existe déjà — c'est celle des tests de bout en bout.
 *
 * **En JPEG, et c'est le seul endroit du produit où ce serait vrai.** Un satin
 * n'a ni transparence, ni arête, ni aplat de texte : rien de ce que le JPEG
 * abîme. Mesuré plutôt que supposé — à qualité 90, l'écart maximal au rendu du
 * navigateur est de 5 valeurs sur 255, soit moins que l'écart entre deux
 * moteurs de rendu, pour un dix-huitième du poids. Les neuf PNG pesaient
 * 2,6 Mo ; c'est un demi-mégaoctet de bundle par écran d'accueil, sur une
 * image qui n'a que des dégradés à dire.
 *
 * Relancer : `node scripts/cuire-les-satins.mjs`
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, '..', 'assets', 'satin');

/**
 * Les trois recettes, recopiées de `BIND AGENCY - Design System v1.0.dc.html`.
 *
 * **Les arrêts sont remappés sur la rampe Ambre, la structure ne bouge pas.**
 * `tokens.json → satin.recette` donne trois recettes à un seul dégradé ; les
 * suivre à la lettre ferait de chaque satin une pente, c'est-à-dire exactement
 * ce que les radiales croisées existent pour éviter. Ce que Design y nomme sont
 * les couleurs, et ce sont elles qui ont été reprises.
 *
 * Des bandes claires et sombres qui se croisent, **sans direction unique** :
 * c'est ce qui distingue un satin d'une pente. Chaque déclaration se termine
 * par le fond plein sur lequel les radiales se posent.
 */
const RECETTES = {
  'satin-drape':
    'radial-gradient(120% 80% at 15% 10%, #F8F4EF 0%, rgba(248,244,239,0) 42%), ' +
    'radial-gradient(90% 120% at 88% 30%, #EBC9A3 0%, rgba(235,201,163,0) 55%), ' +
    'radial-gradient(140% 100% at 30% 105%, #5C300A 0%, rgba(92,48,10,0) 60%), ' +
    'radial-gradient(80% 60% at 70% 85%, #D5770B 0%, rgba(213,119,11,0) 65%), #F39120',
  'satin-fold':
    'radial-gradient(100% 140% at 80% 0%, #F8F4EF 0%, rgba(248,244,239,0) 38%), ' +
    'radial-gradient(120% 90% at 0% 55%, #D5770B 0%, rgba(213,119,11,0) 58%), ' +
    'radial-gradient(90% 70% at 55% 100%, #5C300A 0%, rgba(92,48,10,0) 62%), ' +
    'radial-gradient(70% 90% at 35% 25%, #F2A855 0%, rgba(242,168,85,0) 60%), #F39120',
  'satin-ember':
    'radial-gradient(110% 70% at 50% 0%, #EBC9A3 0%, rgba(235,201,163,0) 45%), ' +
    'radial-gradient(130% 110% at 10% 90%, #17140F 0%, rgba(23,20,15,0) 55%), ' +
    'radial-gradient(90% 80% at 95% 60%, #A55709 0%, rgba(165,87,9,0) 60%), #5C300A',
};

/**
 * La taille de base.
 *
 * 390 est la largeur du compact de référence ; 320 tient la borne des 240 px
 * que le composant impose, avec la marge d'une surface qui se présente. Le
 * satin est ensuite étiré par `resizeMode`, ce qu'un dégradé supporte sans
 * artefact — c'est le seul genre d'image dont la déformation ne se voit pas.
 */
const BASE = { width: 390, height: 320 };

/**
 * Les deux encres du système qui peuvent se poser sur un satin.
 *
 * Le blanc pur n'en fait pas partie : le système n'en a pas. `ink.onDark` est
 * son clair, et c'est lui qu'il faut mesurer, pas une valeur idéale.
 */
const ENCRES = { 'ink.default': '#17140F', 'ink.onDark': '#F5F4F2' };

const navigateur = await chromium.launch();
await mkdir(SORTIE, { recursive: true });

/**
 * Le contraste réel, mesuré dans le tiers haut et le tiers bas de chaque satin.
 *
 * **Ce n'est pas une précaution, c'est ce qui décide où le titre se pose.** Un
 * satin n'est ni clair ni sombre : il a des plis. Sur `drape`, l'encre tient à
 * 7:1 en haut et tombe à 1,7:1 en bas ; sur `ember`, c'est exactement l'inverse.
 * Poser le titre au même endroit sur les trois donnerait un écran illisible sur
 * deux — et personne ne le verrait avant une capture.
 *
 * Le résultat est écrit à côté des images, et un test le compare à ce que le
 * composant fait. Le mesurer ici plutôt que dans le test évite d'embarquer un
 * décodeur d'image dans la suite ; le recuire sans remesurer est impossible,
 * les deux sortent de la même exécution.
 */
const mesures = {};

for (const [nom, fond] of Object.entries(RECETTES)) {
  for (const [echelle, suffixe] of [
    [1, ''],
    [2, '@2x'],
    [3, '@3x'],
  ]) {
    const page = await navigateur.newPage({
      viewport: BASE,
      deviceScaleFactor: echelle,
    });
    await page.setContent(
      `<body style="margin:0"><div style="width:${BASE.width}px;height:${BASE.height}px;background:${fond}"></div></body>`,
    );
    const chemin = join(SORTIE, `${nom}${suffixe}.jpg`);
    await page.screenshot({ path: chemin, type: 'jpeg', quality: 90 });
    await page.close();
    console.log(`${chemin}  ${BASE.width * echelle}×${BASE.height * echelle}`);
  }

  const page = await navigateur.newPage({ viewport: BASE });
  await page.setContent(
    `<body style="margin:0"><div id="s" style="width:${BASE.width}px;height:${BASE.height}px;background:${fond}"></div></body>`,
  );
  mesures[nom] = await page.evaluate(
    async ({ largeur, hauteur, encres }) => {
      // On repeint le dégradé dans un canevas pour pouvoir le lire : un
      // `background` CSS ne s'échantillonne pas autrement.
      const toile = document.createElement('canvas');
      toile.width = largeur;
      toile.height = hauteur;
      const ctx = toile.getContext('2d');
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}">` +
        `<foreignObject width="100%" height="100%">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${largeur}px;height:${hauteur}px;background:${document.getElementById('s').style.background}"></div>` +
        `</foreignObject></svg>`;
      const image = new Image();
      await new Promise((ok) => {
        image.onload = ok;
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
      ctx.drawImage(image, 0, 0);

      const luminance = (r, v, b) =>
        [r, v, b]
          .map((c) => c / 255)
          .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((somme, c, i) => somme + c * [0.2126, 0.7152, 0.0722][i], 0);

      const contraste = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

      const bande = (haut, bas) => {
        const px = ctx.getImageData(0, haut, largeur, bas - haut).data;
        let mini = 1;
        let maxi = 0;
        for (let i = 0; i < px.length; i += 4) {
          const l = luminance(px[i], px[i + 1], px[i + 2]);
          if (l < mini) mini = l;
          if (l > maxi) maxi = l;
        }
        const resultat = {};
        for (const [nomEncre, hexa] of Object.entries(encres)) {
          const le = luminance(
            parseInt(hexa.slice(1, 3), 16),
            parseInt(hexa.slice(3, 5), 16),
            parseInt(hexa.slice(5, 7), 16),
          );
          // Le pire pixel de la bande, pas sa moyenne : un titre traverse la
          // bande entière, et c'est là où il passe le plus mal qu'il se lit mal.
          resultat[nomEncre] =
            Math.round(Math.min(contraste(le, mini), contraste(le, maxi)) * 100) / 100;
        }
        return resultat;
      };

      return { haut: bande(0, Math.floor(hauteur / 3)), bas: bande(Math.floor((hauteur * 2) / 3), hauteur) };
    },
    { largeur: BASE.width, hauteur: BASE.height, encres: ENCRES },
  );
  await page.close();
  console.log(`  contrastes ${nom} :`, JSON.stringify(mesures[nom]));
}

await writeFile(
  join(SORTIE, 'contrastes.json'),
  `${JSON.stringify(
    {
      $pourquoi:
        "Le contraste du pire pixel de chaque bande, pour les deux encres du système. C'est lui qui décide où le titre se pose sur chaque satin — un satin n'est ni clair ni sombre, il a des plis. Produit par scripts/cuire-les-satins.mjs, jamais écrit à la main : le recuire sans remesurer est impossible, les deux sortent de la même exécution.",
      mesures,
    },
    null,
    2,
  )}\n`,
);

await navigateur.close();
