/**
 * Un onglet reste allumé sur ses sous-pages.
 *
 * **Le défaut était silencieux et total.** Les écrans rangés sous « More » sont
 * des onglets masqués ; la barre allume par index, l'index focalisé désignait un
 * onglet qu'elle ne dessine pas, et **aucune** pastille ne s'allumait. Sur
 * « Your place », les quatre étaient éteintes — on ne savait plus où l'on était.
 *
 * **Les deux sens, et c'est le seul montage qui les sépare.** Un test qui ne
 * montrerait que la redirection passerait aussi bien sur une règle qui allume
 * « More » en permanence : il faut le cas où la destination *est* visible, et
 * où rien ne doit bouger.
 */
import { indexAllume } from '../src/shell/ongletAllume';

const MASQUE = { tabBarItemStyle: { display: 'none' } };
const VISIBLE = { tabBarItemStyle: undefined };

/** La barre du commerce sur téléphone : quatre montrées, cinq rangées. */
const ROUTES = [
  { key: 'k0', name: 'journee' },
  { key: 'k1', name: 'caisse' },
  { key: 'k2', name: 'publications' },
  { key: 'k3', name: 'menu' },
  { key: 'k4', name: 'lieu' },
  { key: 'k5', name: 'prestations' },
  { key: 'k6', name: 'reglages' },
];

const optionsDe = (route: { name: string }) =>
  ['journee', 'caisse', 'publications', 'menu'].includes(route.name) ? VISIBLE : MASQUE;

describe('l’onglet qui s’allume', () => {
  it('une sous-page de « More » allume « More »', () => {
    // `lieu` — « Your place » — est le quatrième écran rangé. Sans la règle,
    // l'index 4 désigne un onglet que la barre ne dessine pas.
    expect(indexAllume(ROUTES, 4, optionsDe)).toBe(3);
    expect(indexAllume(ROUTES, 5, optionsDe)).toBe(3);
    expect(indexAllume(ROUTES, 6, optionsDe)).toBe(3);
  });

  it('et un onglet visible reste lui-même', () => {
    // Sans cette moitié, une règle qui allumerait toujours « More » passerait.
    expect(indexAllume(ROUTES, 0, optionsDe)).toBe(0);
    expect(indexAllume(ROUTES, 1, optionsDe)).toBe(1);
    expect(indexAllume(ROUTES, 3, optionsDe)).toBe(3);
  });

  it('sans groupeur, rien ne se déplace', () => {
    // La créatrice, l'administration et la barre latérale montrent tout ce
    // qu'elles portent : allumer un onglet au hasard mentirait davantage que de
    // n'en allumer aucun.
    const sansMenu = ROUTES.filter((route) => route.name !== 'menu');
    expect(indexAllume(sansMenu, 3, optionsDe)).toBe(3);
  });
});
