/**
 * La fenêtre de la bande du comptoir.
 *
 * **Sept jours, et non quatorze comme chez le créateur.** Les deux bandes ont
 * la même forme et pas la même question : la créatrice cherche *quand elle
 * peut venir* et regarde loin, le salon regarde *ce qu'il a à faire* et sa
 * semaine est l'horizon de son travail. Quatorze barres de décisions
 * demanderaient de défiler pour atteindre le seul jour qui presse.
 */
export const JOURS_DE_LA_BANDE = 7;

import { jourCivil } from '../../format';
import type { ReservationDuCommerce } from '../../api';

/**
 * Les décisions que porte le jour qu'on lit.
 *
 * **La file du serveur est servie toutes dates confondues, et c'était juste.**
 * Sans bande, filtrer par jour aurait fait disparaître une demande pour
 * après-demain : elle n'était dans aucune journée qu'on ouvre, et personne ne
 * l'aurait tranchée. La bande lève exactement cette condition — les autres
 * jours portent leur compte et s'ouvrent d'un geste.
 *
 * Ce qui restait sinon est pire que le défaut d'origine : la barre annonçait
 * deux décisions mardi, on ouvrait mardi, et la même liste s'affichait quel que
 * soit le jour. **Un compteur qui n'affiche pas ce qu'il compte est un défaut**,
 * et c'est la deuxième fois sur ce produit.
 *
 * **Les demandes sans créneau se lisent le jour même, et seulement là.** Elles
 * ne tombent aucun jour — un droit à fenêtre de validité se présente n'importe
 * quand — donc aucune date ne les réclame. Les répéter sur les sept barres
 * ferait sept fois le même rappel ; les taire les rendrait introuvables. Le
 * jour même est le seul où le geste est immédiat, et c'est la vue par défaut.
 *
 * Le serveur compte selon la même règle : la barre et la liste ne peuvent donc
 * pas se contredire.
 */
export function decisionsDuJour(
  file: ReservationDuCommerce[],
  jour: string,
  timezone: string,
  aujourdhui: string,
): ReservationDuCommerce[] {
  return file.filter((reservation) =>
    reservation.starts_at === null
      ? jour === aujourdhui
      : jourCivil(reservation.starts_at, timezone) === jour,
  );
}
