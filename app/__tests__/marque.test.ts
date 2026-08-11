/**
 * Les fichiers de la marque.
 *
 * **Une icône absente ne se voit pas en développement.** Expo sert un carré
 * gris et continue ; le manque n'apparaît qu'au dépôt sur les magasins, ou dans
 * l'onglet de quelqu'un d'autre. C'est le genre de fichier qu'on régénère en
 * changeant de machine et qu'on oublie de commiter.
 *
 * **Le seize est un dessin distinct**, pas une réduction du trente-deux : sous
 * 32, un trait rond sur trois pixels devient une bouillie grise. La première
 * version de ce test le « vérifiait » en comparant les octets des deux
 * fichiers — une réduction du trente-deux passait sans broncher, puisqu'elle
 * donne elle aussi des octets différents et un fichier plus léger. Il
 * n'affirmait rien.
 *
 * La propriété est donc rendue **structurelle** : le seize est enregistré en
 * palette de deux couleurs. Un dessin sans lissage n'a aucun pixel
 * intermédiaire et y tient ; une réduction en demanderait des dizaines. Le
 * bloc `PLTE` se lit sans décodeur, et il ne peut pas mentir.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ASSETS = join(__dirname, '..', 'assets');

/**
 * Les dimensions d'un PNG, lues dans son en-tête.
 *
 * `IHDR` est toujours le premier bloc, largeur et hauteur en gros-boutiste aux
 * octets 16 à 24. Aucune dépendance pour lire huit octets.
 */
function dimensions(fichier: string): { largeur: number; hauteur: number } {
  const octets = readFileSync(join(ASSETS, fichier));
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

describe('les fichiers de la marque', () => {
  it.each([
    ['marque-16.png', 16],
    ['marque-32.png', 32],
    ['marque-64.png', 64],
    ['marque-180.png', 180],
  ])('%s fait exactement %i pixels de côté', (fichier, cote) => {
    expect(existsSync(join(ASSETS, fichier))).toBe(true);
    expect(dimensions(fichier)).toEqual({ largeur: cote, hauteur: cote });
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

  it('le seize ne tient qu’en deux couleurs, donc n’est pas une réduction', () => {
    // Une réduction du trente-deux étale le trait en gris sur les bords : elle
    // ne tiendrait pas dans deux entrées de palette. Le `PLTE` est la preuve
    // que le dessin est franc.
    const seize = readFileSync(join(ASSETS, 'marque-16.png'));
    const palette = seize.indexOf('PLTE');
    expect(palette).toBeGreaterThan(0);
    // Trois octets par couleur : deux couleurs, six octets.
    expect(seize.readUInt32BE(palette - 4)).toBe(6);

    // Et les grandes tailles, elles, gardent leurs dégradés de bord : leur
    // imposer deux couleurs escalierait les arcs.
    expect(readFileSync(join(ASSETS, 'marque-32.png')).indexOf('PLTE')).toBe(-1);
  });
});
