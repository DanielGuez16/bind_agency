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

import { PNG } from 'pngjs';

const ASSETS = join(__dirname, '..', 'assets');
/** Recopié tel quel à la racine du build : c'est là que Safari va chercher. */
const PUBLIC = join(__dirname, '..', 'public');
type Rectangle = { x: number; y: number; largeur: number; hauteur: number };
const declare = JSON.parse(readFileSync(join(ASSETS, 'marque.json'), 'utf-8')) as {
  mot: string;
  couleurs: Record<string, string>;
  compacte: {
    grille: number;
    signe: Rectangle[];
    marges: { haut: number; bas: number; gauche: number; droite: number };
  };
};

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
 * Tout ce que la marque imprime, et **où chaque fichier est réclamé**.
 *
 * **Les quatre `marque-*.png` ont été retirés, et c'est le sujet.** Ils ne
 * servaient à rien : Expo compile `favicon.png` en un `.ico` de trois images —
 * 16, 32 et 48 — et n'écrit qu'un `<link rel="icon">` vers lui. Aucun gabarit
 * ne les citait, aucune balise ne les demandait. Un fichier orphelin qui porte
 * la marque ne reste pas inerte : il finit par resservir, en portant une
 * version périmée. C'est très exactement ce qui venait d'arriver au monogramme
 * du système vert.
 *
 * Un seul avait une destination réelle — le 180, taille de l'icône d'iOS. Il
 * est désormais **posé là où Safari la cherche**, `public/apple-touch-icon.png`,
 * plutôt que rangé où rien n'irait le prendre.
 */
const TOUS: readonly (readonly [string, string])[] = [
  ['icon.png', ASSETS],
  ['splash-icon.png', ASSETS],
  ['android-icon-background.png', ASSETS],
  ['android-icon-foreground.png', ASSETS],
  ['android-icon-monochrome.png', ASSETS],
  ['apple-touch-icon.png', PUBLIC],
];

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

/** Le dessin attendu à une taille donnée, reconstruit depuis la géométrie déclarée. */
function attendu(cote: number): boolean[][] {
  const unite = cote / declare.compacte.grille;
  return Array.from({ length: cote }, (_, y) =>
    Array.from({ length: cote }, (_, x) =>
      declare.compacte.signe.some(
        (part) =>
          x >= Math.round(part.x * unite) &&
          x < Math.round((part.x + part.largeur) * unite) &&
          y >= Math.round(part.y * unite) &&
          y < Math.round((part.y + part.hauteur) * unite),
      ),
    ),
  );
}

/** Ce que l'image montre vraiment : encre ou surface, pixel par pixel. */
function lu(png: PNG): boolean[][] {
  const encre = declare.couleurs.encre.replace('#', '').toUpperCase();
  return Array.from({ length: png.height }, (_, y) =>
    Array.from({ length: png.width }, (_, x) => {
      const i = (png.width * y + x) << 2;
      return versHexa(png.data[i], png.data[i + 1], png.data[i + 2]).slice(1) === encre;
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

  it('aucun fichier ne montre une couleur que les jetons ne déclarent pas', () => {
    // **La garde qui manquait.** Elle ne dit pas que le dessin est le bon ; elle
    // dit qu'il appartient encore au système en vigueur. C'est exactement ce
    // qu'il fallait pour arrêter un monogramme vert dans un produit orange.
    const permises = Object.values(declare.couleurs);

    const fautifs = TOUS.flatMap(([fichier, dossier]) =>
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
      surface: jetons.color.brand['500'],
      encreClaire: jetons.color.ink.onDark,
      encre: jetons.color.ink.default,
    });
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
    expect(config.expo.android.adaptiveIcon.backgroundColor).toBe(declare.couleurs.surface);
  });

  it('la surface de marque occupe vraiment les tuiles, elle n’est pas un liseré', () => {
    // Le sens inverse : un fichier entièrement blanc passerait la garde des
    // couleurs si le blanc était permis. On vérifie que l'orange **est** la
    // tuile — son centre en haut à gauche, loin du mot.
    for (const [fichier, dossier] of [
      ['icon.png', ASSETS],
      ['splash-icon.png', ASSETS],
      ['apple-touch-icon.png', PUBLIC],
    ] as const) {
      const png = PNG.sync.read(readFileSync(join(dossier, fichier)));
      const coin = (png.width * Math.round(png.height * 0.12) + Math.round(png.width * 0.12)) * 4;
      expect({
        fichier,
        coin: versHexa(png.data[coin], png.data[coin + 1], png.data[coin + 2]),
      }).toEqual({ fichier, coin: declare.couleurs.surface.toUpperCase() });
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

  it('et il ne connaît que deux couleurs, à chaque taille', () => {
    // Sans lissage, un blanc de deux unités reste deux pixels. La contrainte
    // garantit le dessin au lieu de le menacer — encore faut-il la tenir.
    for (const { cote, png } of imagesDuIco(ICO)) {
      const trouvees = new Set<string>();
      for (let i = 0; i < png.data.length; i += 4) {
        trouvees.add(versHexa(png.data[i], png.data[i + 1], png.data[i + 2]));
      }
      expect({ cote, couleurs: [...trouvees].sort() }).toEqual({
        cote,
        couleurs: [declare.couleurs.encre, declare.couleurs.surface].map((c) => c.toUpperCase()).sort(),
      });
    }
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
      return Array.from({ length: grille }, (_, ligne) =>
        Array.from({ length: grille }, (_, colonne) =>
          pixels[Math.floor((ligne + 0.5) * unite)][Math.floor((colonne + 0.5) * unite)] ? '#' : '.',
        ).join(''),
      ).join('|');
    });

    expect(new Set(empreintes).size).toBe(1);
    // Et cette empreinte est bien le dessin de la planche : un fût de 4 sur 6,
    // deux unités de blanc, un point de 4 sur 4, le tout centré.
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
      '......####......',
      '......####......',
      '......####......',
      '......####......',
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
