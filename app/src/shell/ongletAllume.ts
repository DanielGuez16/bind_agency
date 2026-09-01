/**
 * Quel onglet doit paraître actif, quand la destination n'en est pas un.
 *
 * **Un onglet reste allumé sur ses sous-pages.** Sur téléphone, la barre du bas
 * ne porte que quatre destinations ; les autres restent des onglets à part
 * entière mais masqués, et le menu « More » les groupe. Ouvrir « Your place »
 * depuis ce menu rendait donc actif un onglet **invisible** — et la barre
 * n'allumait plus rien du tout. On ne savait plus où l'on était, ni comment on
 * y était arrivé.
 *
 * **La règle se lit sur ce que la barre montre, elle ne se recopie pas.** Un
 * tableau « cet écran appartient à cet onglet » aurait fallu tenir à jour à
 * chaque écran ajouté, et le premier oubli aurait éteint la barre en silence.
 * Ici la question posée est celle qu'on veut : *la destination est-elle
 * visible ?* Sinon, c'est le groupeur qui s'allume.
 *
 * **Le groupeur est nommé par convention, et il est facultatif.** Un navigateur
 * sans onglet `menu` — la créatrice, l'administration, la barre latérale de
 * bureau, qui montrent tout — n'a rien à rediriger : la fonction rend alors la
 * route focalisée, et rien ne change.
 */

/** Le nom de l'onglet qui groupe ce que la barre ne montre pas. */
export const ONGLET_GROUPEUR = 'menu';

type Route = { key: string; name: string };

/**
 * Vrai quand la barre ne montre pas cette destination.
 *
 * `ongletHorsBarre` pose `display: 'none'` ; c'est ce que la barre lit pour ne
 * pas la dessiner, donc c'est ce qu'on interroge. Lire la même chose que ce qui
 * décide de l'affichage est ce qui empêche les deux de diverger.
 */
function masque(style: unknown): boolean {
  return (
    typeof style === 'object' &&
    style !== null &&
    (style as { display?: string }).display === 'none'
  );
}

/**
 * L'index de l'onglet à allumer, celui de la route focalisée par défaut.
 *
 * Rendu en index et non en nom : les deux barres comparent déjà par index, et
 * leur faire comparer des noms demanderait de toucher leur boucle de rendu.
 */
export function indexAllume(
  routes: readonly Route[],
  index: number,
  optionsDe: (route: Route) => { tabBarItemStyle?: unknown } | undefined,
): number {
  const focalisee = routes[index];
  if (!focalisee) return index;
  if (!masque(optionsDe(focalisee)?.tabBarItemStyle)) return index;

  const groupeur = routes.findIndex((route) => route.name === ONGLET_GROUPEUR);
  // Pas de groupeur : on ne déplace rien. Allumer un onglet au hasard mentirait
  // davantage que de n'en allumer aucun.
  return groupeur === -1 ? index : groupeur;
}
