import { Platform } from 'react-native';

/**
 * Ce que le web ajoute au champ, et qu'aucun style en ligne ne peut retirer.
 *
 * **L'autoremplissage peint le fond de l'`input` lui-même.** Chrome et Safari
 * appliquent `background-color` sur `:-webkit-autofill`, une pseudo-classe :
 * elle ne s'exprime pas en style en ligne, donc React Native Web ne peut rien
 * en faire. Le résultat est un aplat jaune dans un champ qui n'en a jamais
 * demandé, et il survit à la frappe tant que le navigateur considère la valeur
 * comme la sienne.
 *
 * **La transition longue plutôt qu'une couleur.** L'astuce courante est une
 * ombre intérieure de la couleur du fond — mais elle demande de connaître ce
 * fond, et un champ posé tantôt sur `bg.surface`, tantôt sur `bg.page`, la
 * ferait mentir sur l'un des deux. Différer la transition de fond indéfiniment
 * empêche la peinture d'arriver, quel que soit ce qu'il y a derrière : on ne
 * corrige pas la couleur, on l'empêche.
 *
 * `-webkit-text-fill-color` est nécessaire en plus : l'encre de
 * l'autoremplissage est posée par la même règle et ne suit pas `color`.
 *
 * **Injecté une fois, au démarrage.** Une feuille par champ monté remplirait la
 * tête du document, et un composant qui écrit dans `document` à chaque rendu
 * est un composant qui fuit.
 */
const REGLE = `
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus,
input:-webkit-autofill:active,
textarea:-webkit-autofill,
select:-webkit-autofill {
  transition: background-color 9999s ease-in-out 0s;
  -webkit-text-fill-color: inherit;
  caret-color: currentColor;
}
`;

const REPERE = 'bind-styles-web';

export function poserLesStylesWeb(): void {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(REPERE)) return;

  const feuille = document.createElement('style');
  feuille.id = REPERE;
  feuille.textContent = REGLE;
  document.head.appendChild(feuille);
}
