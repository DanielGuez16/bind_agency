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
const declare = JSON.parse(readFileSync(join(ASSETS, 'marque.json'), 'utf-8')) as {
  mot: string;
  couleurs: Record<string, string>;
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
  ['favicon.png', ASSETS],
  ['icon.png', ASSETS],
  ['splash-icon.png', ASSETS],
  ['android-icon-background.png', ASSETS],
  ['android-icon-foreground.png', ASSETS],
  ['android-icon-monochrome.png', ASSETS],
  ['apple-touch-icon.png', PUBLIC],
];

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

  it('le favicon et l’icône d’application existent et sont carrés', () => {
    for (const fichier of ['favicon.png', 'icon.png']) {
      const { largeur, hauteur } = dimensions(fichier);
      expect(largeur).toBe(hauteur);
      // Un favicon de 16 serait flou partout ailleurs que dans l'onglet ;
      // les navigateurs réduisent mieux qu'ils n'agrandissent.
      expect(largeur).toBeGreaterThanOrEqual(64);
    }
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
      ['favicon.png', ASSETS],
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
