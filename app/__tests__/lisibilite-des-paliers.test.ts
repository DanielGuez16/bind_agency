/**
 * Le libellé d'un badge de palier est lisible, dans les deux thèmes.
 *
 * **Onze points, donc 4,5:1 au minimum.** C'est ce que `components.md` §2 pose,
 * et c'est ce qui fixe la couleur de chaque matière — pas l'inverse.
 *
 * **Ce test existe parce que l'affirmation valait mieux que la mesure.** La
 * section disait « `brand.700` sur `brand.100` passe » ; mesuré, le couple donne
 * 4,19:1. Elle est restée fausse deux versions, et le produit a porté le défaut
 * plus longtemps encore — la copie du dépôt du document n'ayant pas reçu la
 * correction. Aucun œil n'attrape 4,19 contre 4,50 ; une soustraction si.
 */
import { contraste, couleurs, luminance, matiereDePalier, type Palier } from '../src/theme';

/** Le plancher WCAG pour du texte sous 18 px. */
const PLANCHER = 4.5;

const PALIERS: Palier[] = ['story', 'post', 'reel'];

describe('le libellé d’un badge tient le plancher de contraste', () => {
  it('l’arithmétique est celle de WCAG', () => {
    // **Le volume, et l'oracle.** Sans ces deux lignes, une erreur dans le
    // calcul rendrait tout vert et le test ne dirait plus rien.
    expect(PALIERS).toHaveLength(3);
    expect(contraste(luminance('#FFFFFF'), luminance('#000000'))).toBeCloseTo(21, 1);
  });

  it.each(PALIERS)('%s, sur fond clair', (palier) => {
    const m = matiereDePalier(palier, false);
    expect(
      contraste(luminance(couleurs[m.texte]), luminance(couleurs[m.surface])),
    ).toBeGreaterThanOrEqual(PLANCHER);
  });

  it.each(PALIERS)('%s, sur encre', (palier) => {
    // L'autre thème, et il n'est pas dérivé du premier : les trois matières y
    // ont leurs propres couleurs, donc leurs propres couples à mesurer.
    const m = matiereDePalier(palier, true);
    expect(
      contraste(luminance(couleurs[m.texte]), luminance(couleurs[m.surface])),
    ).toBeGreaterThanOrEqual(PLANCHER);
  });
});
