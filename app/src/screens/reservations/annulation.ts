import type { ReservationDuCreateur } from '../../api/types';

/**
 * Ce qu'annuler coûte, et à partir de quand.
 *
 * **Passé la fenêtre, on arrête de parler du score.** C'est l'asymétrie que la
 * règle contenait déjà et que l'écran ne voyait pas : au-delà du seuil, annuler
 * et ne pas venir coûtent la même chose — une absence dans les deux cas. Le
 * score ne départage donc rien, et le mentionner ne fait qu'une chose, donner à
 * croire qu'on peut encore l'éviter.
 *
 * Ce qui diffère est ailleurs : **la place repart, et le salon sait**. Un salon
 * prévenu à 11 h peut remplir 14 h 30 ; un salon qui l'apprend à 14 h 45 a perdu
 * son créneau et son après-midi. C'est tout ce que l'écran a à dire, et c'est
 * pourquoi ce module ne rend jamais de quoi écrire « ça coûtera à ton score ».
 *
 * **Deux sources, et elles ne se contredisent pas.** Le diagramme dit *si* une
 * annulation peut coûter — `no_show` n'est atteignable que depuis `confirmed`,
 * et il n'y a rien à manquer sans créneau. L'instant servi dit *quand*. Le
 * second ne se recalcule pas ici : le seuil est un réglage, et l'horloge d'un
 * terminal n'est pas une preuve.
 */
export type PorteeDeLAnnulation =
  /** Annuler ne coûtera rien, à aucune heure. Il n'y a pas d'échéance à nommer. */
  | 'libre'
  /** L'échéance est servie et encore devant. */
  | 'dans-la-fenetre'
  /** L'échéance est servie et franchie. */
  | 'passe-la-fenetre'
  /**
   * Une annulation qui peut coûter, sans qu'on sache à partir de quand.
   *
   * Le champ est neuf : une réponse d'avant lui, un cache, un décor écrit sans
   * lui. Se rabattre sur « libre » annoncerait gratuit sur une annulation qui
   * coûte ; nommer une heure qu'on n'a pas serait pire. L'écran dit alors ce
   * qu'il sait, sans heure.
   */
  | 'sans-echeance'
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
  maintenant = Date.now(),
): PorteeDeLAnnulation {
  if (!ANNULABLES.has(reservation.status)) return 'close';

  // `confirmed` est le seul état d'où part une flèche vers `no_show`, et sans
  // heure à laquelle ne pas se présenter l'absence n'a pas de sens. Ce n'est
  // pas l'heure qui ouvre la pénalité, c'est l'état.
  if (reservation.status !== 'confirmed') return 'libre';
  if (!reservation.starts_at) return 'libre';

  const echeance = reservation.annulation_sans_frais_jusqu_a;
  if (!echeance) return 'sans-echeance';

  const instant = new Date(echeance).getTime();
  // Une échéance illisible ne vaut pas « franchie » : elle vaut « on ne sait
  // pas ». Annoncer que la fenêtre s'est fermée sur une date qu'on n'a pas su
  // lire ferait renoncer quelqu'un qui pouvait encore annuler librement.
  if (Number.isNaN(instant)) return 'sans-echeance';

  return instant > maintenant ? 'dans-la-fenetre' : 'passe-la-fenetre';
}

/**
 * Ce qui reste avant le créneau, en heures et minutes.
 *
 * **C'est le seul nombre que cet écran affiche**, et il n'est pas le coût. Le
 * coût ne se chiffre jamais — « tu perdras huit points » transforme une
 * décision en calcul, et un calcul se reporte à demain. Ce délai-ci est
 * l'argument inverse : il dit ce que prévenir donne au salon.
 *
 * Rendu comme un fait et non comme une promesse. « Trois heures leur suffisent
 * pour la remplir » est vrai à trois heures et faux à cinq minutes ; « ça leur
 * laisse trois heures » est vrai aux deux, et le nombre porte l'argument tout
 * seul. Le seuil qui aurait départagé les deux phrases n'existe pas — et
 * l'écrire en dur ici serait un délai de plus dans le code.
 */
export function delaiAvantLeCreneau(
  starts_at: string | null | undefined,
  maintenant = Date.now(),
): { heures: number; minutes: number } | null {
  if (!starts_at) return null;

  const debut = new Date(starts_at).getTime();
  if (Number.isNaN(debut)) return null;

  const restant = debut - maintenant;
  if (restant <= 0) return null;

  return {
    heures: Math.floor(restant / 3_600_000),
    minutes: Math.floor((restant % 3_600_000) / 60_000),
  };
}
