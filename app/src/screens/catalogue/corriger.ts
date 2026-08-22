/**
 * Ce qu'une prestation laisse corriger, et ce qui demande d'en faire une autre.
 *
 * **La règle vient de ce qu'une réservation raconte.** Douze réservations
 * passées citent une prestation de quarante-cinq minutes ; la passer à
 * soixante-quinze réécrirait leur histoire — quelqu'un lirait, dans son
 * historique, avoir reçu une prestation qu'il n'a pas reçue. La photo,
 * l'orthographe et la description ne racontent rien de ce qui s'est passé :
 * les corriger en place ne touche à aucune réservation.
 *
 * **La durée, le palier et la contrepartie décident donc d'une autre
 * prestation.** L'ancienne s'archive, la nouvelle commence son histoire — et
 * les réservations d'avant continuent de citer celle qu'elles ont eue.
 *
 * **La règle est descendue dans la route**, et n'est donc plus une discipline
 * d'écran : le service refuse un changement de durée ou de nature sur un item
 * réservé, et `/replace` crée la neuve et archive l'ancienne dans la même
 * transaction. L'écran cesse d'être le seul endroit où la règle existe.
 */

/** Ce qui se corrige sans toucher à ce qu'une réservation raconte. */
export const CORRIGEABLES = ['name', 'description', 'photo_key'] as const;

export type ChampCorrigeable = (typeof CORRIGEABLES)[number];

/**
 * Ce qui demande une nouvelle prestation.
 *
 * **Le prix n'y est pas, et il n'est pas non plus corrigeable.** Design ne le
 * range dans aucune des deux listes : il ne réécrit l'histoire d'aucune
 * réservation — le prix est du reporting dans ce produit — mais il déplace le
 * palier suggéré, qui se calcule sur le rang du prix dans le catalogue. La
 * question est posée plutôt que tranchée seule.
 */
export const DEMANDENT_UNE_AUTRE = [
  'duration_minutes',
  'content_format',
  'requires_booking',
] as const;

/**
 * Une prestation jamais réservée se supprime vraiment ; une prestation déjà
 * réservée s'archive et ne se supprime jamais.
 *
 * **Le refus reste lu, et le compte est désormais su.** `delete_item` lève
 * toujours `catalog_item_has_bookings`, et l'écran continue de lire ce code
 * plutôt que son message. Mais `reservations_count` est servi : l'écran n'a
 * plus à proposer un geste pour apprendre qu'il est impossible — il nomme le
 * bon dès le départ, et le refus ne sert plus que de garde-fou si les deux
 * divergent.
 */
export const REFUS_DE_SUPPRESSION = 'catalog_item_has_bookings';

/**
 * Le geste qui reste possible quand la suppression est refusée.
 *
 * **Fermer n'est pas archiver, et l'écran ne prétend pas le contraire.** Un
 * salon ferme une prestation pour l'été et la rouvre en septembre ; il archive
 * celle qu'il ne refera plus. Les deux valent aujourd'hui le même drapeau, et
 * rien ne les distingue — sortir de la liste de travail une prestation
 * saisonnière que le gérant compte rouvrir serait pire que d'y laisser une
 * archive. `archived_at` distingue enfin les deux, et l'écran s'en sert.
 */
export type SuiteDuRefus = 'fermer';

export function suiteDuRefus(code: string | null | undefined): SuiteDuRefus | null {
  return code === REFUS_DE_SUPPRESSION ? 'fermer' : null;
}


/**
 * Lequel des deux gestes une prestation offre — et ce que le bouton doit dire.
 *
 * **Le bouton nomme son écart.** « Archiver » ne se décide pas ; « archiver,
 * douze réservations citent cette prestation » se décide. Le nombre est ce qui
 * fait la différence entre un bouton qu'on presse par habitude et un bouton
 * qu'on presse en sachant ce qu'on déplace.
 *
 * **Et il n'y a jamais les deux.** À zéro réservation la suppression est vraie,
 * et rien ne justifie d'encombrer l'écran d'une archive. Au-delà, la
 * suppression n'existe pas — l'offrir pour la voir refusée apprend à un gérant
 * que l'écran propose des gestes qui échouent.
 *
 * Une prestation déjà archivée n'offre rien : l'archivage ne se rejoue pas, et
 * le serveur le refuse par `catalog_item_already_archived`.
 */
export type GesteDeRetrait =
  | { geste: 'supprimer' }
  | { geste: 'archiver'; reservations: number }
  | { geste: 'aucun' };

export function gesteDeRetrait(item: {
  archived_at?: string | null;
  reservations_count?: number | null;
}): GesteDeRetrait {
  if (item.archived_at) return { geste: 'aucun' };

  // Lu faux plutôt qu'égal à zéro : le champ est neuf, et une réponse d'avant
  // ne le porte pas. `undefined` doit valoir « aucune réservation connue », pas
  // « la prestation en a une ».
  const reservations = item.reservations_count ?? 0;
  return reservations > 0 ? { geste: 'archiver', reservations } : { geste: 'supprimer' };
}
