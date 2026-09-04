/**
 * La liste fermée des centres d'intérêt, et ce qu'on en dit.
 *
 * **Un module partagé, et non deux listes recopiées.** Deux écrans la lisent :
 * la créatrice qui déclare les siens, et le salon qui filtre son annuaire
 * dessus. Recopier l'ordre ou les libellés dans chacun ferait diverger les
 * deux — un intérêt proposé à la saisie mais absent du filtre serait
 * invisible, et personne ne s'en apercevrait puisque chaque écran, seul,
 * paraîtrait complet.
 *
 * **L'ordre est celui de la liste serveur**, qui groupe par catégorie de
 * commerce : les quatre de la beauté, les deux de la restauration, puis le
 * reste. Un tri alphabétique le casserait dans une langue et pas dans
 * l'autre, et la rangée de chips n'aurait plus la même forme en anglais et en
 * espagnol.
 */
import type { CentreDInteret } from '../../api';

export const CENTRES_D_INTERET: readonly CentreDInteret[] = [
  'coiffure',
  'ongles',
  'soin_du_visage',
  'massage_et_spa',
  'maquillage',
  'restaurant',
  'cafe_et_brunch',
  'fitness',
  'culture',
  'famille',
] as const;

/**
 * Trois au plus, et la borne est celle du serveur.
 *
 * **Recopiée d'une contrainte de base, donc éprouvée contre elle.** La
 * `CHECK` de `creator_profile` refuse au delà de trois ; une borne cliente
 * qui dériverait laisserait cocher un quatrième intérêt que l'envoi refuse,
 * et l'écran annoncerait un enregistrement qui n'a pas eu lieu.
 */
export const INTERETS_MAXIMUM = 3;

/**
 * Coche ou décoche, sans jamais dépasser la borne.
 *
 * **Le quatrième ne remplace pas le premier.** Faire tourner la sélection
 * serait plus permissif et bien pire : la créatrice verrait un intérêt
 * qu'elle a choisi disparaître sans l'avoir touché. Au dessus de la borne, le
 * geste ne fait rien et la chip reste éteinte, ce que la ligne d'aide
 * explique avant qu'on essaie.
 */
export function basculer(
  choisis: readonly CentreDInteret[],
  valeur: CentreDInteret,
): CentreDInteret[] {
  if (choisis.includes(valeur)) return choisis.filter((autre) => autre !== valeur);
  if (choisis.length >= INTERETS_MAXIMUM) return [...choisis];
  return [...choisis, valeur];
}
