/**
 * Y a-t-il la place pour une seconde colonne de `besoin` points ?
 *
 * **Extraite du fournisseur pour que les tests n'en écrivent pas une copie.**
 * Huit suites simulent `useGabarit` avec un objet littéral ; le jour où la
 * forme du gabarit a gagné cette fonction, les huit ont rendu `undefined` et
 * l'appel a levé. Recopier la règle dans chaque double aurait remplacé une
 * panne franche par huit copies qui dérivent en silence — un double qui ne
 * suit plus ce qu'il double éprouve un écran qui n'existe pas.
 *
 * **La barre est comptée déployée, toujours.** Son repli est une préférence
 * d'appareil qui vit ailleurs ; la lire ici coupleraient la mesure à un
 * réglage. Compter le pire fait scinder un peu plus tard qu'il n'aurait été
 * possible — jamais plus tôt qu'il ne faut, seul sens dans lequel l'erreur est
 * sans conséquence.
 */
import { breakpoint } from '../theme';

/** L'écart entre les deux colonnes. `space.6`, comme partout ailleurs. */
export const ECART_DES_COLONNES = 24;

export function placeDisponible(largeur: number, besoin: number): boolean {
  if (largeur < breakpoint.expanded) return false;
  const pourLeContenu = largeur - breakpoint.sidebarWidth - ECART_DES_COLONNES;
  // **Le corps ne doit pas être plus étroit que sa colonne latérale.** C'est le
  // défaut mesuré : au seuil de bascule, un journal fixe de 440 laissait 196
  // points au pavé de code. Rien ne débordait — la colonne fixe tient sa
  // largeur et c'est le corps qui se comprime, ce qui rend le défaut invisible
  // à toute garde qui cherche un dépassement.
  return pourLeContenu >= besoin * 2;
}
