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
 * **Ce que cet écran ne peut pas encore tenir**, écrit dans `TASKS.md` : le
 * serveur accepte toujours un changement de durée par correctif. Ne pas
 * l'offrir est une discipline, et une discipline finit par céder — la règle doit
 * descendre dans la route.
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
 * **Le serveur tient déjà cette moitié** : `delete_item` lève
 * `catalog_item_has_bookings`. L'écran n'a donc pas à deviner — il propose la
 * suppression, et lit le refus comme la réponse qu'il est. Deviner à sa place
 * demanderait un compte de réservations que rien ne sert, et se tromperait au
 * premier écart.
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
 * archive. Voir `TASKS.md`.
 */
export type SuiteDuRefus = 'fermer';

export function suiteDuRefus(code: string | null | undefined): SuiteDuRefus | null {
  return code === REFUS_DE_SUPPRESSION ? 'fermer' : null;
}
