import type { ReservationDuCreateur } from '../../api/types';

/**
 * Ce qu'une annulation va coûter.
 *
 * **L'issue dépend du délai, pas de l'intention.** Le service le dit sans
 * détour : au-delà de la fenêtre d'annulation libre, annuler une réservation
 * confirmée l'inscrit en `no_show`, et le parcours range `no_show` au passif.
 * Laisser choisir reviendrait à laisser échapper à la pénalité — l'écran
 * n'offre donc pas deux boutons, il en offre un qui dit ce qu'il fait.
 *
 * **Ce qui tranche est le diagramme, pas l'horloge.** `no_show` n'est
 * atteignable que depuis `confirmed` : c'est une propriété de la machine
 * d'états, vraie quelle que soit la valeur du réglage. Une place seulement
 * tenue, ou une réservation que le salon n'a pas encore acceptée, ne peut pas
 * y mener — et l'écran n'a donc rien à faire d'un délai qu'on ne lui sert pas.
 *
 * Ce que l'écran ne peut toujours pas dire est **quand** une confirmée cesse
 * d'être libre. `booking_free_cancellation_seconds` est un réglage et le dépôt
 * interdit de l'écrire ici, à raison : le recopier le ferait dériver au premier
 * ajustement. L'avertissement porte donc la conséquence sans l'heure, ce qui
 * est moins utile que « libre jusqu'à 14 h 30 » et ne ment pas. Le champ est
 * demandé.
 */
export type PorteeDeLAnnulation =
  /** Le diagramme ne mène à aucune pénalité depuis cet état. */
  | 'libre'
  /** Une pénalité est possible, et l'écran ne sait pas si le seuil est passé. */
  | 'peut-couter'
  /** La ligne est close : il n'y a plus rien à annuler. */
  | 'close';

/**
 * Les états d'où l'annulation part, recopiés du diagramme du service.
 *
 * Recopiés et non déduits, comme la table d'oracle côté API : `consumed`,
 * `cancelled`, `no_show` et `expired` sont terminaux, et poser un bouton
 * dessus promettrait un geste que la route refuse.
 */
const ANNULABLES = new Set(['held', 'awaiting_business', 'confirmed']);

export function porteeDeLAnnulation(
  reservation: ReservationDuCreateur,
): PorteeDeLAnnulation {
  if (!ANNULABLES.has(reservation.status)) return 'close';

  // `confirmed` est le seul état d'où part une flèche vers `no_show`. Un
  // créneau proche n'y change rien depuis les deux autres : ce n'est pas
  // l'heure qui ouvre la pénalité, c'est l'état.
  if (reservation.status !== 'confirmed') return 'libre';

  // Sans heure à laquelle ne pas se présenter, `no_show` n'a pas de sens — le
  // service lève plutôt que de l'écrire, et pour la même raison.
  if (reservation.starts_at === null) return 'libre';

  return 'peut-couter';
}
