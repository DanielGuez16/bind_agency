/**
 * La fenêtre de la bande du comptoir.
 *
 * **Quatorze jours, comme chez le créateur** — et cette ligne en disait sept,
 * avec sa raison : « le salon regarde ce qu'il a à faire, et sa semaine est
 * l'horizon de son travail ; quatorze barres demanderaient de défiler pour
 * atteindre le seul jour qui presse ».
 *
 * L'argument valait tant que le jour qui presse était **plus loin que la
 * piste**. Il ne l'est plus : le jour qui presse est le premier, la bande
 * s'ouvre dessus, et les treize suivants ne se gagnent qu'en défilant vers
 * l'avant — allonger la piste n'éloigne donc rien de ce qu'on regardait déjà.
 *
 * Et un créateur réserve à quinze jours. À sept, la moitié de ce qu'un salon a
 * accepté tombait **hors de sa propre bande** : la demande existait, la file la
 * servait, et aucune case ne la portait.
 *
 * Le serveur n'a rien à changer — son agrégat prend le nombre de jours en
 * paramètre et accepte jusqu'à trente et un.
 */
export const JOURS_DE_LA_BANDE = 14;

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
