/**
 * L'état d'un contrôle, annoncé des deux côtés.
 *
 * **`accessibilityState` seul n'arrive jamais au DOM.** Mesuré dans
 * `node_modules`, pas supposé : `createDOMProps` de cette version de React
 * Native Web n'en contient aucune mention. Il lit `aria-checked`,
 * `aria-selected`, `aria-expanded`, `aria-disabled`, `aria-busy` en propriétés
 * de premier rang, et ignore l'objet.
 *
 * Tout ce que l'application annonçait par `accessibilityState` — vingt endroits,
 * c'est-à-dire **tous les gestes à deux états** — n'était donc annoncé à
 * personne sur le web. Un lecteur d'écran lisait « garder en favori » sans dire
 * si c'était fait, « aujourd'hui » sans dire si l'onglet était choisi.
 *
 * **Sur mobile natif rien n'est cassé** : `accessibilityState` y est la seule
 * propriété que React Native connaisse. Le défaut ne se voyait donc que là où
 * l'application est réellement montrée.
 *
 * D'où les deux, posées ensemble et à un seul endroit : les refaire à chaque
 * appel, c'est en oublier un — et un état oublié ne se voit pas, il s'entend
 * chez quelqu'un qui n'est pas là pour le dire.
 *
 * **Ce qui a trouvé le défaut, et ce qui ne pouvait pas.** Les tests unitaires
 * lisaient `props.accessibilityState` : la valeur telle qu'écrite, jamais telle
 * que rendue. Ils passaient donc des deux côtés. C'est un parcours de bout en
 * bout — le seul qui regarde le DOM — qui l'a vu, et il l'a vu par accident, en
 * cherchant un cœur non posé et en les prenant tous. Voir `DECISIONS.md`.
 */
export type EtatAccessible = {
  /** Un interrupteur : le cœur d'un favori, une case, un `Toggle`. */
  checked?: boolean;
  /** Un choix dans un ensemble : un onglet, une pastille, un jour. */
  selected?: boolean;
  /** Un panneau qu'on déplie. */
  expanded?: boolean;
  disabled?: boolean;
  /** Une action en cours : le bouton qui attend le serveur. */
  busy?: boolean;
};

/**
 * À étaler sur le contrôle : `{...etatAccessible({ selected: actif })}`.
 *
 * Les clés absentes ne produisent rien. Poser `aria-checked={undefined}` sur un
 * bouton qui n'est pas un interrupteur ajouterait un attribut vide que certains
 * lecteurs annoncent quand même.
 */
export function etatAccessible(etat: EtatAccessible): Record<string, unknown> {
  const rendu: Record<string, unknown> = { accessibilityState: etat };

  if (etat.checked !== undefined) rendu['aria-checked'] = etat.checked;
  if (etat.selected !== undefined) rendu['aria-selected'] = etat.selected;
  if (etat.expanded !== undefined) rendu['aria-expanded'] = etat.expanded;
  if (etat.disabled !== undefined) rendu['aria-disabled'] = etat.disabled;
  if (etat.busy !== undefined) rendu['aria-busy'] = etat.busy;

  return rendu;
}
