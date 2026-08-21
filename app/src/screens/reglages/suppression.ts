/**
 * Combien de contreparties engagent encore la créatrice.
 *
 * **Le serveur refuse la suppression sans dire combien.** `409
 * deletion_blocked_by_collaboration` porte le code seul : étendre la fabrique
 * d'erreurs pour un compteur aurait coûté un détail structuré à toutes les
 * erreurs du produit, pour une phrase d'un seul écran. L'application liste déjà
 * les réservations de la créatrice, donc elle sait compter.
 *
 * **Ce qui rend ce comptage fragile, et ce qui le rattrape.** Compter ici veut
 * dire tenir la même liste de statuts que `account_deletion.EN_COURS`, dans un
 * autre langage et un autre dépôt de fichiers. Le jour où le serveur en ajoute
 * un, l'écran annoncerait « une contrepartie » là où le serveur en voit deux,
 * et le refus deviendrait incompréhensible. Une garde lit la constante Python
 * et la compare à celle-ci : la dérive casse la suite au lieu de se découvrir
 * sur un écran.
 */
import type { CollaborationStatus, ReservationDuCreateur } from '../../api';

/**
 * Les statuts qui engagent encore quelqu'un.
 *
 * `approved` et `unfulfilled` sont les deux issues, l'une bonne et l'autre
 * non : dans les deux cas le salon sait à quoi s'en tenir et n'attend plus.
 */
export const CONTREPARTIES_EN_COURS: readonly CollaborationStatus[] = [
  'pending',
  'submitted',
  'under_review',
  'resubmit_requested',
];

export function compterLesContreparties(items: readonly ReservationDuCreateur[]): number {
  return items.filter(
    (reservation) =>
      reservation.contrepartie !== null &&
      CONTREPARTIES_EN_COURS.includes(reservation.contrepartie.status),
  ).length;
}

/**
 * Combien on en demande d'un coup.
 *
 * Assez pour couvrir tout historique réel, et surtout **connu du test** : la
 * règle de la page pleine ne s'éprouve qu'en construisant une page pleine.
 */
export const PAGE = 100;

/**
 * Le nombre à annoncer, ou rien.
 *
 * **Nul quand la page est pleine.** Une page qui atteint la limite peut en
 * cacher d'autres, et « il vous reste deux publications » serait alors faux
 * dans le sens qui trompe — trop bas. Mieux vaut la phrase générale du
 * catalogue, qui reste vraie, qu'un chiffre qui fait croire qu'on a fini.
 *
 * Ici et non dans l'écran, parce que c'est une règle et non un rendu : posée
 * dans le composant, elle ne se vérifiait qu'en montant cent réservations.
 */
export function compterOuRien(items: readonly ReservationDuCreateur[]): number | null {
  if (items.length >= PAGE) return null;
  return compterLesContreparties(items);
}
