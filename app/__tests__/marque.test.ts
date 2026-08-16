/**
 * Les fichiers de la marque.
 *
 * **Une icône absente ne se voit pas en développement.** Expo sert un carré
 * gris et continue ; le manque n'apparaît qu'au dépôt sur les magasins, ou dans
 * l'onglet de quelqu'un d'autre. C'est le genre de fichier qu'on régénère en
 * changeant de machine et qu'on oublie de commiter.
 *
 * **Et une icône présente ne se relit jamais.** C'est le défaut que ce fichier
 * n'attrapait pas, et il a coûté cher : l'ancien monogramme — un « B » vert
 * d'eau sur indigo, hérité du système d'avant — a traversé le remplacement
 * complet de la direction artistique. Les jetons ont changé, les fontes ont
 * changé, les soixante-quatre écrans ont changé ; l'onglet du navigateur
 * montrait toujours l'ancienne marque, en ligne, pendant des jours. Les tests
 * d'alors vérifiaient que les fichiers **existaient** et faisaient la bonne
 * taille. Aucun ne regardait ce qu'ils montraient.
 *
 * La question « est-ce la bonne marque ? » ne se décide pas d'un test. La
 * question « est-ce encore la palette d'un système qu'on a retiré ? » se
 * décide, et c'est celle-là qui aurait suffi : ces fichiers ne portent que des
 * couleurs déclarées dans les jetons. Le vert d'eau et l'indigo n'y sont plus
 * depuis la v1.0, et une icône qui les porte tombe.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { render, screen } from '@testing-library/react-native';
import { PNG } from 'pngjs';
import { createElement } from 'react';

import { Marque } from '../src/components';
import { produit } from '../src/theme';

const ASSETS = join(__dirname, '..', 'assets');
/** Recopié tel quel à la racine du build : c'est là que Safari va chercher. */
const PUBLIC = join(__dirname, '..', 'public');
type Rectangle = {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  role: 'fut' | 'point';
  couleur: string;
};
const declare = JSON.parse(readFileSync(join(ASSETS, 'marque.json'), 'utf-8')) as {
  mot: string;
  couleurs: Record<string, string>;
  lisibilite: { largeurParLettre: number; pixelsParLettreMinimum: number };
  palette: string[];
  compacte: {
    grille: number;
    tuile: string;
    signe: Rectangle[];
    marges: { haut: number; bas: number; gauche: number; droite: number };
    android: { cote: number; zoneSure: number };
  };
  fichiers: {
    nom: string;
    ou: 'assets' | 'public';
    afficheA: number;
    marque: string;
    aplat?: boolean;
    couche?: boolean;
  }[];
};

const DOSSIER = { assets: ASSETS, public: PUBLIC } as const;

/**
 * Les dimensions d'un PNG, lues dans son en-tête.
 *
 * `IHDR` est toujours le premier bloc, largeur et hauteur en gros-boutiste aux
 * octets 16 à 24. Aucune dépendance pour lire huit octets.
 */
function dimensions(fichier: string, dossier = ASSETS): { largeur: number; hauteur: number } {
  const octets = readFileSync(join(dossier, fichier));
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

function versHexa(r: number, v: number, b: number): string {
  return `#${[r, v, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * Tout pixel opaque d'un fichier qui n'est **pas** un mélange de deux couleurs
 * permises.
 *
 * **Compter les couleurs franches ne suffisait pas.** Un mot en trait fin
 * produit des centaines de mélanges entre l'encre et le fond ; sur une tuile de
 * seize pixels, ces mélanges *sont* l'image, et n'importe quel seuil de surface
 * les laisse passer ou fait tout échouer. La bonne propriété n'est pas « quelles
 * couleurs dominent » mais « de quoi cette image est-elle faite » : un mot
 * monochrome posé sur une surface unie ne contient rien d'autre que le segment
 * qui va de l'une à l'autre.
 *
 * Un vert d'eau sur un indigo n'est sur aucun des segments de la v1.0, à
 * n'importe quelle taille et quelle que soit la part qu'il occupe.
 */
function pixelsEtrangers(fichier: string, permises: string[], dossier = ASSETS): string[] {
  const png = PNG.sync.read(readFileSync(join(dossier, fichier)));
  const points = permises.map(enCanaux);
  // Douze valeurs sur 255 : de quoi absorber l'arrondi du rendu et la
  // conversion de l'espace colorimétrique, pas de quoi absorber une teinte.
  const TOLERANCE = 12;

  const fautifs = new Map<string, number>();
  for (let i = 0; i < png.data.length; i += 4) {
    // Le transparent n'est pas une couleur : les couches Android en sont
    // faites, et les compter dirait « du vide » sans rien prouver.
    if (png.data[i + 3] < 250) continue;
    const pixel = [png.data[i], png.data[i + 1], png.data[i + 2]] as const;

    const admis = points.some((a) =>
      points.some((b) => distanceAuSegment(pixel, a, b) <= TOLERANCE),
    );
    if (!admis) {
      const hexa = versHexa(pixel[0], pixel[1], pixel[2]);
      fautifs.set(hexa, (fautifs.get(hexa) ?? 0) + 1);
    }
  }
  return [...fautifs.keys()];
}

function enCanaux(hexa: string): readonly [number, number, number] {
  const n = parseInt(hexa.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** La distance d'un pixel au segment qui joint deux couleurs permises. */
function distanceAuSegment(
  p: readonly [number, number, number],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const carre = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  // Deux couleurs confondues : le segment est un point, et la projection n'a
  // pas de sens — c'est le cas des tuiles d'une seule encre.
  const t = carre === 0 ? 0 : Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / carre));
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

/**
 * Tout ce que la marque imprime, **lu du manifeste** et non recopié.
 *
 * Les quatre `marque-*.png` ont disparu, puis `favicon.png`, puis
 * `splash-icon.png` : à chaque fois un fichier que rien ne réclamait, et à
 * chaque fois la même leçon — un fichier orphelin qui porte la marque ne reste
 * pas inerte, il attend qu'on le reprenne en portant une version périmée.
 * C'est ce qui est arrivé au monogramme du système vert.
 */
const TOUS: readonly (readonly [string, string])[] = declare.fichiers.map(
  (fichier) => [fichier.nom, DOSSIER[fichier.ou]] as const,
);

/**
 * Les images d'un `.ico`, chacune telle qu'elle y est rangée.
 *
 * Le format est un en-tête de six octets, puis une entrée de seize par image —
 * côté, taille, décalage — puis les images bout à bout. Les nôtres sont des
 * PNG, que `pngjs` relit tels quels.
 */
function imagesDuIco(chemin: string): { cote: number; png: PNG }[] {
  const octets = readFileSync(chemin);
  const nombre = octets.readUInt16LE(4);
  return Array.from({ length: nombre }, (_, rang) => {
    const entree = 6 + 16 * rang;
    const taille = octets.readUInt32LE(entree + 8);
    const decalage = octets.readUInt32LE(entree + 12);
    return {
      cote: octets.readUInt8(entree) || 256,
      png: PNG.sync.read(octets.subarray(decalage, decalage + taille)),
    };
  });
}

/**
 * Le dessin attendu à une taille donnée, reconstruit depuis la géométrie
 * déclarée — et **en trois valeurs, pas deux**.
 *
 * La correction du 2026-08-15 est là : le fût et le point ne sont plus la même
 * chose. Une lecture binaire « signe ou fond » les confondrait, et laisserait
 * passer très exactement la faute que le vectoriel de la fondatrice a corrigée.
 */
function attendu(cote: number): string[][] {
  const unite = cote / declare.compacte.grille;
  return Array.from({ length: cote }, (_, y) =>
    Array.from({ length: cote }, (_, x) => {
      const part = declare.compacte.signe.find(
        (candidate) =>
          x >= Math.round(candidate.x * unite) &&
          x < Math.round((candidate.x + candidate.largeur) * unite) &&
          y >= Math.round(candidate.y * unite) &&
          y < Math.round((candidate.y + candidate.hauteur) * unite),
      );
      return part ? part.role : 'tuile';
    }),
  );
}

/** Ce que l'image montre vraiment, ramené aux mêmes trois noms. */
function lu(png: PNG): string[][] {
  const nom = new Map<string, string>([
    [declare.compacte.tuile.toUpperCase(), 'tuile'],
    ...declare.compacte.signe.map(
      (part) => [part.couleur.toUpperCase(), part.role] as [string, string],
    ),
  ]);
  return Array.from({ length: png.height }, (_, y) =>
    Array.from({ length: png.width }, (_, x) => {
      const i = (png.width * y + x) << 2;
      return nom.get(versHexa(png.data[i], png.data[i + 1], png.data[i + 2])) ?? 'étranger';
    }),
  );
}

describe('les fichiers de la marque', () => {
  it.each(TOUS)('%s existe', (fichier, dossier) => {
    expect(existsSync(join(dossier, fichier))).toBe(true);
  });

  it('l’icône d’iOS est à la racine du site, et à sa taille', () => {
    // **Elle n'est pas déclarée par une balise, et n'a pas à l'être.** Le
    // gabarit d'Expo n'écrit qu'un `<link rel="icon">` ; Safari, lui, demande
    // `/apple-touch-icon.png` par convention quand rien ne la déclare. La
    // câbler par là évite de remplacer un gabarit généré pour y ajouter une
    // ligne — un fichier de plus à tenir à jour pour une balise.
    expect(dimensions('apple-touch-icon.png', PUBLIC)).toEqual({ largeur: 180, hauteur: 180 });
  });

  it('aucun fichier de marque ne traîne sans que rien ne le réclame', () => {
    // Le sens inverse, et c'est celui qui compte ici : la garde des couleurs ne
    // regarde que les fichiers qu'on lui nomme. Un orphelin lui échappe par
    // construction — il faut donc refuser les orphelins eux-mêmes.
    const connus = new Set(TOUS.map(([nom]) => nom));
    const traînards = readdirSync(ASSETS).filter(
      (nom) => nom.startsWith('marque-') && !connus.has(nom),
    );
    expect(traînards).toEqual([]);
  });

  it('l’icône d’application est carrée, et assez grande pour les magasins', () => {
    const { largeur, hauteur } = dimensions('icon.png');
    expect(largeur).toBe(hauteur);
    expect(largeur).toBeGreaterThanOrEqual(1024);
  });

  it('la règle décide de chaque fichier, et aucun n’y échappe', () => {
    // **Le logotype partout où on a la place de le lire, la marque compacte
    // partout ailleurs — et le seuil est la lisibilité des quatre lettres, pas
    // le support.** C'est `afficheA` qui décide : ce que l'utilisateur voit,
    // jamais la résolution du fichier. On avait gardé le logotype sur l'icône
    // d'application *parce qu'elle est livrée en 1024*, et un lanceur en
    // affichait vingt-sept pixels pour quatre lettres.
    const { largeurParLettre, pixelsParLettreMinimum } = declare.lisibilite;

    for (const fichier of declare.fichiers) {
      const parLettre = (fichier.afficheA * largeurParLettre) / declare.mot.length;
      expect({
        nom: fichier.nom,
        marque: fichier.marque,
      }).toEqual({
        nom: fichier.nom,
        marque: parLettre >= pixelsParLettreMinimum ? 'logotype' : 'compacte',
      });
    }
  });

  it('et aucun fichier cuit ne porte le logotype, puisque toutes sont des tuiles', () => {
    // Le sens inverse : si un jour un fichier repassait au logotype, c'est
    // qu'on l'afficherait assez grand — et il faudrait le prouver, pas
    // l'affirmer. En attendant, la règle s'exprime par la structure.
    expect(declare.fichiers.map((fichier) => fichier.marque)).toEqual(
      declare.fichiers.map(() => 'compacte'),
    );
  });

  it('aucun fichier ne montre une couleur que les jetons ne déclarent pas', () => {
    // **La garde qui manquait.** Elle ne dit pas que le dessin est le bon ; elle
    // dit qu'il appartient encore au système en vigueur. C'est exactement ce
    // qu'il fallait pour arrêter un monogramme vert dans un produit orange.
    const permises = Object.values(declare.couleurs);

    const fautifs = TOUS.filter(([nom]) => nom.endsWith('.png')).flatMap(([fichier, dossier]) =>
      pixelsEtrangers(fichier, permises, dossier).map((couleur) => `${fichier} : ${couleur}`),
    );

    expect(fautifs).toEqual([]);
  });

  it('et la liste des couleurs permises est bien celle des jetons', () => {
    // Sans ceci, `marque.json` pourrait déclarer n'importe quoi et la garde
    // précédente approuverait tout — elle se vérifierait elle-même.
    const jetons = JSON.parse(
      readFileSync(join(__dirname, '..', 'src', 'theme', 'tokens.json'), 'utf-8'),
    );
    expect(declare.couleurs).toEqual({
      tuile: jetons.color.ink.default,
      fut: '#FFFFFF',
      point: jetons.color.brand['500'],
    });
    // Et la palette du dessin est bien celle que les jetons déclarent : trois
    // couleurs, pas deux. La contrainte à deux est tombée avec la correction —
    // le sens du sigle **est** le contraste entre le fût et le point.
    expect(declare.palette).toEqual(jetons.logo.mark16.palette);
    expect(declare.palette).toHaveLength(3);
    expect(declare.mot).toBe(jetons.logo.wordmark.text);
  });

  it('la couleur qu’Android compose derrière l’icône vient des jetons', () => {
    // **Le dernier endroit où l'ancien système avait survécu.** Android ne se
    // contente pas du fichier de fond : `app.json` déclare une couleur, et
    // c'est elle qu'on voit dans le tiroir d'applications quand le masque
    // dépasse la couche. Elle est restée bleu pâle — la teinte du système
    // d'avant — pendant que tout le reste passait à l'orange, parce qu'elle
    // vit dans un fichier de configuration que personne ne relit.
    const config = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf-8'));
    expect(config.expo.android.adaptiveIcon.backgroundColor).toBe(declare.couleurs.tuile);
  });

  it('la tuile est bien de l’encre, et pas de l’orange', () => {
    // **Le fond est encre et non orange, et c'est une décision.** Sur une tuile
    // orange le point disparaîtrait, et c'est lui la marque : le sens du sigle
    // est le rapport entre le fût et le point, pas la silhouette. On lit le
    // coin, loin du signe.
    for (const [fichier, dossier] of [
      ['icon.png', ASSETS],
      ['android-icon-background.png', ASSETS],
      ['apple-touch-icon.png', PUBLIC],
    ] as const) {
      const png = PNG.sync.read(readFileSync(join(dossier, fichier)));
      const coin = (png.width * Math.round(png.height * 0.12) + Math.round(png.width * 0.12)) * 4;
      expect({
        fichier,
        coin: versHexa(png.data[coin], png.data[coin + 1], png.data[coin + 2]),
      }).toEqual({ fichier, coin: declare.couleurs.tuile.toUpperCase() });
    }
  });
});

/**
 * La marque en petit : le bloc, avec le point évidé.
 *
 * **La propriété qui porte ce dessin est la grille.** Tout est posé en unités
 * d'une grille de seize, donc chaque cote tombe sur un pixel entier à 16, 32,
 * 64 et 128 : la forme est *la même* aux quatre tailles au lieu d'être arrondie
 * quatre fois différemment. Un test qui se contenterait de vérifier « il y a
 * bien deux couleurs » laisserait passer un dessin qui tremble d'une taille à
 * l'autre — c'est-à-dire le défaut exact qu'on cherche à éviter, et celui qu'une
 * réduction produit toujours.
 */
describe('la marque compacte', () => {
  const ICO = join(PUBLIC, 'favicon.ico');

  it('le favicon porte les trois tailles, dessinées et non réduites', () => {
    // Expo sait produire un `.ico` de trois images, mais en **réduisant** la
    // source — et une réduction lisse. Elle rendrait gris le blanc de deux
    // unités entre le fût et le point, qui est ce que le dessin protège.
    expect(imagesDuIco(ICO).map((image) => image.cote)).toEqual([16, 32, 48]);
  });

  it.each([16, 32, 48])('à %i, le dessin est exactement celui de la grille', (cote) => {
    const image = imagesDuIco(ICO).find((candidate) => candidate.cote === cote)!;
    expect(lu(image.png)).toEqual(attendu(cote));
  });

  it('et il ne connaît que ses trois couleurs, à chaque taille', () => {
    // Sans lissage, un vide de deux unités reste deux pixels : il ne se comble
    // pas en gris. Trois couleurs et pas une de plus — un quatrième ton serait
    // un bord lissé, donc une réduction déguisée.
    for (const { cote, png } of imagesDuIco(ICO)) {
      const trouvees = new Set<string>();
      for (let i = 0; i < png.data.length; i += 4) {
        trouvees.add(versHexa(png.data[i], png.data[i + 1], png.data[i + 2]));
      }
      expect({ cote, couleurs: [...trouvees].sort() }).toEqual({
        cote,
        couleurs: declare.palette.map((c) => c.toUpperCase()).sort(),
      });
    }
  });

  it('le point est orange, et le fût ne l’est pas', () => {
    // **La correction du 2026-08-15, et la seule chose qui compte ici.** La
    // règle précédente disait « jamais coloré à part », déduite de visuels
    // entièrement blancs sur orange où un point orange ne *pouvait pas* se
    // distinguer. Le vectoriel montre l'inverse : le point est la seule couleur
    // du logotype, et c'est elle qui fait la marque.
    //
    // Un sigle dont le fût prendrait l'orange, ou dont le point prendrait
    // l'encre du fût, resterait net, franc, sur la grille — et serait la faute.
    const jetons = JSON.parse(
      readFileSync(join(__dirname, '..', 'src', 'theme', 'tokens.json'), 'utf-8'),
    );
    const { png } = imagesDuIco(ICO).find((image) => image.cote === 48)!;
    const pixels = lu(png);
    const unite = 48 / declare.compacte.grille;
    const au = (colonne: number, ligne: number) =>
      pixels[Math.floor((ligne + 0.5) * unite)][Math.floor((colonne + 0.5) * unite)];

    // Au cœur du fût, et au cœur du point.
    expect({ fut: au(8, 4), point: au(8, 12) }).toEqual({ fut: 'fut', point: 'point' });
    expect(declare.couleurs.point).toBe(jetons.color.brand['500']);
    expect(declare.couleurs.fut).not.toBe(declare.couleurs.point);
  });

  it('la forme est la même aux trois tailles, et pas seulement nette à chacune', () => {
    // **Le sens inverse, et c'est celui qui compte.** Chaque taille prise seule
    // pourrait être franche et pourtant différente des autres : c'est ce que
    // donne un dessin arrondi indépendamment à chaque échelle. On compare donc
    // les trois **au centre de chaque unité de la grille**, où la forme est
    // définie, plutôt que pixel à pixel — seules les cotes doivent coïncider.
    const grille = declare.compacte.grille;
    const empreintes = imagesDuIco(ICO).map(({ cote, png }) => {
      const pixels = lu(png);
      const unite = cote / grille;
      const glyphe = { tuile: '.', fut: '#', point: 'o', étranger: '?' } as const;
      return Array.from({ length: grille }, (_, ligne) =>
        Array.from({ length: grille }, (_, colonne) =>
          glyphe[
            pixels[Math.floor((ligne + 0.5) * unite)][
              Math.floor((colonne + 0.5) * unite)
            ] as keyof typeof glyphe
          ],
        ).join(''),
      ).join('|');
    });

    expect(new Set(empreintes).size).toBe(1);
    // Et cette empreinte est bien le dessin de la planche : un fût de 4 sur 6,
    // deux unités de vide, un point de 4 sur 4, le tout centré — et le point
    // écrit d'un autre signe que le fût, parce qu'il est d'une autre couleur.
    expect(empreintes[0].split('|')).toEqual([
      '................',
      '................',
      '......####......',
      '......####......',
      '......####......',
      '......####......',
      '......####......',
      '......####......',
      '................',
      '................',
      '......oooo......',
      '......oooo......',
      '......oooo......',
      '......oooo......',
      '................',
      '................',
    ]);
  });

  it('l’icône d’iOS porte le même dessin, arrondi à l’entier', () => {
    // 180 est la taille qu'Apple impose, et elle ne tombe pas sur la grille —
    // 11,25 unités. Les bords sont arrondis plutôt que laissés en fraction :
    // deux couleurs franches, au prix d'un demi-pixel.
    const png = PNG.sync.read(readFileSync(join(PUBLIC, 'apple-touch-icon.png')));
    expect({ largeur: png.width, hauteur: png.height }).toEqual({ largeur: 180, hauteur: 180 });
    expect(lu(png)).toEqual(attendu(180));
  });

  it('les marges laissent les masques mordre le fond, jamais le dessin', () => {
    // Un masque circulaire ou arrondi entame les bords d'une tuile
    // d'application. Le signe est centré, à deux unités du haut et du bas, six
    // de chaque côté — donc rien à redessiner pour iOS ou Android.
    const { grille, signe, marges } = declare.compacte;
    const hauts = Math.min(...signe.map((part) => part.y));
    const bas = grille - Math.max(...signe.map((part) => part.y + part.hauteur));
    const gauches = Math.min(...signe.map((part) => part.x));
    const droites = grille - Math.max(...signe.map((part) => part.x + part.largeur));
    expect({ haut: hauts, bas, gauche: gauches, droite: droites }).toEqual(marges);
  });

  it('rien ne fabrique un second favicon derrière celui-ci', () => {
    // **Un fichier généré puis masqué est pire qu'un orphelin.** `public/`
    // l'emporte sur ce qu'Expo écrit : tant que `web.favicon` désignait une
    // source, la chaîne compilait un `.ico` que le nôtre recouvrait
    // silencieusement — et le jour où l'on retire le nôtre, c'est l'autre qui
    // reparaît, avec le dessin qu'il portait.
    const config = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf-8'));
    expect(config.expo.web.favicon).toBeUndefined();
    expect(existsSync(join(ASSETS, 'favicon.png'))).toBe(false);
  });
});

/**
 * Le logotype vivant, celui de l'interface.
 *
 * **C'est le seul endroit où il reste**, maintenant qu'aucun fichier ne le
 * porte. Le protéger là est donc tout ce qu'il y a à protéger — et un logotype
 * illisible ne se signale pas : il ressemble à un logotype, en plus petit, et
 * il traverse une revue. C'est exactement ainsi que l'ancien monogramme a
 * traversé le remplacement complet du système.
 */
describe('le plancher du logotype', () => {
  it('se calcule depuis deux mesures, il ne s’écrit pas', () => {
    const { PLANCHER_DU_LOGOTYPE } = require('../src/components');
    const { largeurParLettre, pixelsParLettreMinimum } = declare.lisibilite;
    // `taille × 0,72` donne le corps, et une lettre vaut `largeurParLettre` du
    // corps. Le plancher est la plus petite taille qui tienne le minimum.
    expect(PLANCHER_DU_LOGOTYPE).toBe(
      Math.ceil(pixelsParLettreMinimum / (0.72 * largeurParLettre)),
    );
    // Et il vaut bien quelque chose : un plancher à zéro passerait le calcul.
    expect(PLANCHER_DU_LOGOTYPE).toBeGreaterThan(0);
  });

  it('refuse de rendre en dessous, et dit quoi employer à la place', () => {
    const { Marque, PLANCHER_DU_LOGOTYPE } = require('../src/components');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { createElement } = require('react');

    expect(() =>
      renderToStaticMarkup(createElement(Marque, { taille: PLANCHER_DU_LOGOTYPE - 1 })),
    ).toThrow(/marque compacte/);
  });

  it('et le plus petit usage du produit passe au-dessus', () => {
    // Le sens inverse. Un plancher qui refuserait ce que le produit emploie
    // déjà serait faux, pas strict — et il se ferait baisser au lieu d'être cru.
    const { PLANCHER_DU_LOGOTYPE } = require('../src/components');
    const source = readdirSync(join(__dirname, '..', 'src'), { recursive: true }) as string[];

    const tailles = source
      .filter((chemin) => chemin.endsWith('.tsx'))
      .flatMap((chemin) => [
        ...readFileSync(join(__dirname, '..', 'src', chemin), 'utf-8').matchAll(
          /<Marque[^>]*taille=\{(\d+)\}/g,
        ),
      ])
      .map((trouve) => Number(trouve[1]));

    expect(tailles.length).toBeGreaterThan(0);
    expect(tailles.filter((taille) => taille < PLANCHER_DU_LOGOTYPE)).toEqual([]);
  });
});

/**
 * Le logotype vivant, et la correction du 2026-08-15.
 *
 * **Le point est la seule couleur du logotype.** La règle précédente disait
 * l'inverse — « le « ! » n'est jamais coloré à part » — et l'erreur était
 * méthodique plutôt qu'accidentelle : elle avait été déduite de visuels
 * Instagram entièrement blancs sur orange, **où un point orange ne peut pas se
 * distinguer du fond**. L'information manquait de la seule source disponible,
 * et il en est sorti une règle au lieu d'une incertitude.
 *
 * La conséquence technique est ce que ces tests protègent : le « ! » ne peut
 * pas être posé comme caractère, parce qu'une couleur de texte s'applique au
 * glyphe entier et que le fût prendrait celle du point.
 */
/** Les chaînes rendues, dans l'ordre, quel que soit le composant qui les pose. */
function feuillesDeTexte(noeud: unknown): string[] {
  if (typeof noeud === 'string') return [noeud];
  if (Array.isArray(noeud)) return noeud.flatMap(feuillesDeTexte);
  if (noeud && typeof noeud === 'object') {
    return feuillesDeTexte((noeud as { children?: unknown }).children);
  }
  return [];
}

describe('le logotype porte son point', () => {
  /**
   * Le logotype rendu, et **ses props lues sur l'arbre**.
   *
   * Une première version de ces tests cherchait les couleurs dans le HTML
   * produit : les styles y arrivent en `[object Object]` et l'assertion ne
   * regardait rien. Les props se lisent.
   */
  async function rendu(variante: 'encre' | 'blanc') {
    const vue = await render(createElement(Marque, { taille: 40, variante, testID: 'logo' }));
    /**
     * `react-native-svg` normalise `fill` en entier ARGB avant de le poser sur
     * l'arbre : lire la prop telle quelle compare une chaîne à un objet, et
     * l'assertion échoue pour la mauvaise raison.
     */
    const couleurLue = (valeur: unknown): string => {
      if (typeof valeur === 'string') return valeur.toUpperCase();
      const brut = (valeur as { payload?: number }).payload ?? 0;
      return `#${(brut & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
    };
    const empile = (valeur: unknown): Record<string, unknown> =>
      Array.isArray(valeur)
        ? Object.assign({}, ...valeur.map(empile))
        : ((valeur as Record<string, unknown>) ?? {});
    return {
      // Toutes les feuilles de texte de l'arbre, mises bout à bout : c'est ce
      // que l'œil lit, indépendamment du composant qui l'a posé.
      textes: feuillesDeTexte(vue.toJSON()).join(''),
      lettres: couleurLue(empile(screen.getByTestId('logo-lettres').props.style).color),
      fut: couleurLue(
        screen.getByTestId('logo-signe-fut', { includeHiddenElements: true }).props.fill,
      ),
      point: couleurLue(
        screen.getByTestId('logo-signe-point', { includeHiddenElements: true }).props.fill,
      ),
    };
  }

  it('le « ! » est dessiné, jamais posé comme caractère', () => {
    // **La conséquence technique de la correction.** Posé en texte, le fût
    // prendrait la couleur du point : une couleur de texte s'applique au glyphe
    // entier, et rien ne permet d'en peindre la moitié. Un logotype qui le
    // poserait en caractère serait plus court à écrire, passerait la revue, et
    // son fût serait orange.
    const source = readFileSync(join(__dirname, '..', 'src', 'components', 'Logo.tsx'), 'utf-8');
    const utiles = source.split('\n').filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne));

    // Le mot est coupé sur le « ! », jamais rendu d'un bloc…
    expect(utiles.some((ligne) => ligne.includes("wordmark.text.split('!')"))).toBe(true);
    // …et le signe est un tracé.
    expect(utiles.some((ligne) => ligne.includes('<Polygon'))).toBe(true);
    expect(utiles.some((ligne) => ligne.includes('<Circle'))).toBe(true);
  });

  it('et le rendu ne porte que les lettres, jamais le « ! » en texte', async () => {
    // Le sens inverse, lu sur l'arbre : la garde précédente lit un fichier, et
    // un fichier peut contenir les deux formes. Ce que l'écran montre décide.
    const { textes } = await rendu('encre');
    expect(textes).toBe(declare.mot.replace('!', ''));
  });

  it.each(['encre', 'blanc'] as const)(
    'sur %s, le fût suit les lettres et le point reste orange',
    async (variante) => {
      const { lettres, fut, point } = await rendu(variante);

      // Le fût suit les lettres — c'est toute la correction.
      expect(fut).toBe(produit.marque.encres[variante].toUpperCase());
      expect(lettres).toBe(produit.marque.encres[variante].toUpperCase());
      // Et le point ne les suit pas.
      expect(point).toBe(produit.marque.encres.point.toUpperCase());
      expect(point).not.toBe(fut);
    },
  );

  it('les deux variantes diffèrent par les lettres, jamais par le point', async () => {
    // **Le sens inverse, et c'est celui qui compte.** Une variante blanche dont
    // le point suivrait les lettres serait un logotype monochrome pâle —
    // c'est-à-dire l'erreur d'avant, remise en place par la porte de derrière.
    const surClair = await rendu('encre');
    const surSombre = await rendu('blanc');

    expect(surClair.lettres).not.toBe(surSombre.lettres);
    expect(surClair.fut).not.toBe(surSombre.fut);
    expect(surClair.point).toBe(surSombre.point);
  });

  it('les encres du logotype sont rattachées aux jetons, sauf le blanc', () => {
    // Deux des trois doublent un jeton : elles ne doivent pas devenir une
    // seconde source. Le blanc est le seul chiffre propre au logo — la
    // passation dit #FFFFFF, et non `ink.onDark`, qui est l'encre claire du
    // texte courant. Les faire coïncider ferait suivre le logo le jour où l'une
    // des deux bougerait.
    const jetons = JSON.parse(
      readFileSync(join(__dirname, '..', 'src', 'theme', 'tokens.json'), 'utf-8'),
    );
    expect(produit.marque.encres.encre).toBe(jetons.color.ink.default);
    expect(produit.marque.encres.point).toBe(jetons.color.brand['500']);
    expect(produit.marque.encres.blanc).not.toBe(jetons.color.ink.onDark);
    expect(jetons.logo.monochrome).toBe(false);
  });

  it('aucune signature nulle part, y compris à l’écran', async () => {
    // La garde de fichier ne voit pas une chaîne écrite à la main dans le JSX.
    // Celle-ci lit ce que le logotype rend, et rien d'autre n'y a sa place.
    // Ni AGENCY ni CRÉATEUR DE LIEN. Le jeton part avec le prop : un réglage
    // qui ne commande plus rien est pire que son absence.
    expect(produit.type).not.toHaveProperty('type.tagline');
    expect((await rendu('encre')).textes).not.toMatch(/AGENCY|CR[ÉE]ATEUR/i);

    const fautifs = readdirSync(join(__dirname, '..', 'src'), { recursive: true })
      .filter((chemin) => typeof chemin === 'string' && /\.tsx?$/.test(chemin as string))
      .filter((chemin) =>
        /type\.tagline|signature-agence/.test(
          readFileSync(join(__dirname, '..', 'src', chemin as string), 'utf-8'),
        ),
      );
    expect(fautifs).toEqual([]);
  });
});
