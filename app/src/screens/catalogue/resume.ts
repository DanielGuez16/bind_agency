import type { ItemDuCatalogue } from '../../api';

/**
 * Ce que le salon a composé, et ce que les créatrices en voient.
 *
 * **« Douze dont trois éteintes n'est pas la même composition que douze
 * visibles, et c'est la moitié qu'on oublie. »** C'était la raison d'être du
 * résumé de composition, sous la table des matières que la v3.1 retire. La
 * fonction reste — dire à un salon ce qui manque avant qu'il apparaisse — et
 * elle se pose au pied de la liste qu'elle compte.
 *
 * **Compté ici plutôt que demandé.** L'écran tient déjà les prestations ; un
 * appel pour un nombre qu'on peut compter serait un second appel pour une
 * donnée qu'on a en main, et deux comptes qui finiraient par diverger. La
 * définition, elle, est recopiée du serveur et non inventée.
 *
 * **Le parent d'une gamme n'est pas une prestation.** Il ne se réserve pas et
 * ne s'affiche jamais seul : le compter donnerait « treize prestations » à un
 * salon qui en propose douze. Même règle que le fil, que le semis et que le
 * service — une seule définition de « prestation », en quatre endroits.
 */
export function resumeDuCatalogue(items: readonly ItemDuCatalogue[]): {
  prestations: number;
  visibles: number;
} {
  const parents = new Set(
    items.map((item) => item.parent_item_id).filter((id): id is string => id !== null),
  );

  // Une archive n'est plus proposée du tout : la compter parmi les prestations
  // ferait grossir un catalogue qu'on vient de réduire.
  const proposees = items.filter((item) => !parents.has(item.id) && !item.archived_at);

  return {
    prestations: proposees.length,
    // **`is_effectively_available` et non `is_available`.** Une variante dont
    // le parent est fermé n'apparaît nulle part, quel que soit son propre
    // interrupteur — et c'est exactement le genre de prestation qu'on croit
    // ouverte.
    visibles: proposees.filter((item) => item.is_effectively_available).length,
  };
}
