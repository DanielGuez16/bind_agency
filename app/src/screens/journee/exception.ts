/**
 * Les places d'aujourd'hui : ce que la semaine dit, et ce que le jour en fait.
 *
 * **La semaine type est le repère, l'exception est l'écart.** Sans le nombre de
 * la semaine à côté de celui du jour, on ne sait pas si l'on regarde une
 * exception déjà posée ou la règle générale — et on la repose, ce qui donne deux
 * lignes pour la même date.
 */
import type { ExceptionDeCapacite, RegleDeCapacite } from '../../api';

export type PlacesDuJour = {
  /** Ce qui s'applique aujourd'hui, exception comprise. */
  places: number;
  /** Ce que la semaine type prévoit pour ce jour de la semaine. */
  dansLaSemaine: number;
  ferme: boolean;
  /** L'exception posée sur cette date, s'il y en a une. */
  exceptionId: string | null;
};

/**
 * Nul quand le jour n'a aucune règle : le salon est fermé ce jour-là dans sa
 * semaine type, et l'exception qui coupe une place n'a rien à couper. Le geste
 * qui vaut alors est d'ouvrir le jour, et il vit dans la semaine type.
 */
export function placesDuJour({
  jour,
  regles,
  exceptions,
  postesEffectifs,
}: {
  jour: string;
  regles: RegleDeCapacite[];
  exceptions: ExceptionDeCapacite[];
  postesEffectifs: number | null;
}): PlacesDuJour | null {
  if (!regles || !exceptions) return null;

  // **Le jour de la semaine se lit sur la date civile, à midi.** Une date nue
  // rendue à minuit bascule d'un jour selon le fuseau de la machine, et le
  // lundi d'un salon de Miami deviendrait un dimanche.
  const dateNue = jour.slice(0, 10);
  const jourDeSemaine = new Date(`${dateNue}T12:00:00Z`).getUTCDay();

  const duJour = regles.filter((regle) => regle.weekday === jourDeSemaine);
  if (duJour.length === 0) return null;

  // Deux plages le même jour — le salon qui ferme entre midi et deux — ne font
  // pas deux capacités : c'est la plus large qui dit combien de créatrices
  // peuvent être servies en même temps.
  const dansLaSemaine = Math.max(...duJour.map((regle) => regle.concurrent_slots));

  const exception = exceptions.find((e) => e.date.slice(0, 10) === dateNue) ?? null;

  return {
    // **Le nombre effectif vient du serveur quand il l'a calculé.** Le déduire
    // ici referait un calcul que la journée porte déjà, et deux calculs de la
    // même chose finissent par diverger.
    places: postesEffectifs ?? exception?.concurrent_slots ?? dansLaSemaine,
    dansLaSemaine,
    ferme: exception?.is_closed === true,
    exceptionId: exception?.id ?? null,
  };
}
