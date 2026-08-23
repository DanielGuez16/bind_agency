/**
 * La place pour une seconde colonne.
 *
 * **Rien n'a été composé entre 390 et 1512 points.** Le seuil `expanded` vaut
 * 900 : à cette largeur exacte, la barre latérale déployée en prend 240 et il
 * reste 660 pour le contenu. Une colonne latérale fixe de 440 — le journal de
 * la caisse — laissait alors **196 points** au pavé de code, c'est-à-dire moins
 * que ce qui l'accompagne.
 *
 * **Rien ne débordait**, et c'est ce qui rendait le défaut invisible : la
 * colonne fixe tient sa largeur, c'est le corps qui se comprime. Aucune garde
 * cherchant un dépassement ne pouvait le voir, et aucun décor ne montait un
 * écran entre les deux largeurs composées.
 */
import { placeDisponible, ECART_DES_COLONNES } from '../src/shell/placeDisponible';
import { breakpoint } from '../src/theme';

/** Les colonnes fixes réelles du produit, avec l'écran qui les porte. */
const COLONNES = [
  { ecran: 'la caisse · journal du jour', besoin: 440 },
  { ecran: 'les paliers · colonne des règles', besoin: 360 },
];

describe('la place pour une seconde colonne', () => {
  it('refuse en dessous du seuil, quelle que soit la colonne', () => {
    for (const { ecran, besoin } of COLONNES) {
      expect({ ecran, place: placeDisponible(breakpoint.expanded - 1, besoin) }).toEqual({
        ecran,
        place: false,
      });
    }
  });

  it('refuse au seuil exact, où le corps serait plus étroit que sa colonne', () => {
    // **Le cas mesuré.** 900 − 240 − 24 = 636 pour deux colonnes dont l'une en
    // prend 440 : il en reste 196. C'est ce que le produit faisait, et ce que
    // « large » seul ne pouvait pas distinguer.
    for (const { ecran, besoin } of COLONNES) {
      expect({ ecran, place: placeDisponible(breakpoint.expanded, besoin) }).toEqual({
        ecran,
        place: false,
      });
    }
  });

  it('accepte dès que le corps vaut au moins sa colonne', () => {
    // La bascule exacte, calculée depuis la règle et non recopiée : le décor
    // dériverait sinon le jour où le seuil bouge.
    for (const { ecran, besoin } of COLONNES) {
      const juste = breakpoint.sidebarWidth + ECART_DES_COLONNES + besoin * 2;
      expect({ ecran, avant: placeDisponible(juste - 1, besoin) }).toEqual({ ecran, avant: false });
      expect({ ecran, a: placeDisponible(juste, besoin) }).toEqual({ ecran, a: true });
    }
  });

  it('laisse passer les largeurs composées', () => {
    // 1512 est la largeur des maquettes : tout doit y tenir, sans quoi la
    // correction aurait déplacé le défaut au lieu de le corriger.
    for (const { ecran, besoin } of COLONNES) {
      expect({ ecran, place: placeDisponible(1512, besoin) }).toEqual({ ecran, place: true });
    }
  });

  it('refuse sous le seuil même quand l’arithmétique suffirait', () => {
    // **La divergence que les colonnes réelles ne montrent pas.** À 360 et 440
    // points, le calcul refuse déjà tout seul sous le seuil : retirer la borne
    // ne changeait rien et la mutation survivait. Une colonne étroite sépare
    // les deux — 700 − 240 − 24 = 436, assez pour deux colonnes de 150, et
    // pourtant on ne scinde pas.
    //
    // Le seuil n'est pas une redondance : il dit qu'en dessous de 900 on est
    // sur un téléphone ou une fenêtre étroite, où deux colonnes ne se lisent
    // pas, quelle que soit la place que le calcul trouve.
    expect(placeDisponible(700, 150)).toBe(false);
    expect(placeDisponible(breakpoint.expanded, 150)).toBe(true);
  });

  it('compte la barre déployée, jamais repliée', () => {
    // Compter le rail de 72 ferait scinder plus tôt qu'il ne faut chez qui a la
    // barre déployée — le cas par défaut. Compter le pire ne se trompe que dans
    // le sens sans conséquence.
    const avecRail = breakpoint.sidebarRailWidth + ECART_DES_COLONNES + 440 * 2;
    expect(placeDisponible(avecRail, 440)).toBe(false);
  });
});
