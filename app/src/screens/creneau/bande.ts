/**
 * La bande de quatorze jours : ce qu'on en tire, et pourquoi pas une grille.
 *
 * **Le découpage vit hors du rendu.** Ce que la planche promet — « un jour vide
 * garde sa place », « le jour sans place propose les deux ouverts les plus
 * proches » — se vérifie sur des objets, pas sur un arbre de composants. C'est
 * le même partage que le cycle du mur avant lui.
 *
 * **Ce fichier a beaucoup rétréci, et c'est le bon sens.** Il construisait
 * quatorze jours consécutifs, les regroupait sur le fuseau du commerce et
 * devinait leur état depuis le nombre de créneaux libres. Le serveur rend
 * maintenant la bande : quatorze journées locales consécutives, chacune avec
 * son horaire et son compte. Trois de ces quatre choses n'avaient pas à être
 * faites ici, et la quatrième — savoir si le salon **ouvre** — ne *pouvait* pas
 * l'être : une exception de capacité remplace la règle hebdomadaire, et un jour
 * férié se serait lu « complet ».
 *
 * **Pas de grille mensuelle.** Elle serait vide aux trois quarts, et un
 * calendrier vide ne dit pas « tu regardes trop loin », il dit « ce salon n'a
 * rien ». Sept colonnes tiennent en 46 points sur 390 : assez pour un
 * quantième, pas pour un compte — il faudrait donc appuyer sur chaque jour pour
 * savoir, c'est-à-dire tâtonner.
 */
import type { JourDeDisponibilite } from '../../api';

/** La fenêtre de la bande. Le quinzième jour est une issue, pas une case. */
export const JOURS_DE_LA_BANDE = 14;

/**
 * Les deux jours ouverts les plus proches d'un jour donné.
 *
 * **Après d'abord, avant ensuite.** On choisit un jour pour s'y rendre : le
 * proposer en arrière n'a de sens que s'il reste à venir, et l'ordre naturel
 * d'une réservation est vers l'avant. Deux et non trois — au-delà, ce n'est
 * plus une proposition, c'est la bande qu'on vient de quitter.
 *
 * Rend moins de deux quand il n'y en a pas deux, et rien du tout quand il n'y
 * en a aucun : compléter avec des jours sans place ferait des propositions qui
 * ne mènent nulle part, sur l'écran qui vient précisément d'en refuser une.
 */
export function joursProches(
  jours: JourDeDisponibilite[],
  depuis: string,
  combien = 2,
): JourDeDisponibilite[] {
  const rang = jours.findIndex((jour) => jour.jour === depuis);
  if (rang === -1) return [];

  const apres = jours.slice(rang + 1).filter(aDeLaPlace);
  const avant = jours.slice(0, rang).filter(aDeLaPlace).reverse();

  return [...apres, ...avant].slice(0, combien);
}

/**
 * L'état d'un jour, déduit des deux champs servis.
 *
 * **Trois mots, pas un.** « Fermé » se grise, « complet » invite à regarder le
 * lendemain : les peindre pareil ferait croire à un salon fermé un jour où il
 * déborde. La déduction vit ici et non dans le rendu — c'est une règle, et elle
 * s'éprouve sans monter un composant.
 *
 * **Le quatrième état est arrivé, et il était le plus fréquent.** À 20 h, le
 * jour même ouvre bien et n'a plus de début libre : sans `revolu`, il se lisait
 * « complet », c'est-à-dire « pris d'assaut » — et l'on renonce au lieu de
 * revenir demain matin. Il avait été consigné ici comme manquant plutôt que
 * replié en silence ; il se remplace par une ligne, comme prévu.
 *
 * **L'ordre des trois questions n'est pas indifférent.** Fermé l'emporte sur
 * révolu — un salon qui n'ouvre pas aujourd'hui n'a pas de dernière plage à
 * clore — et révolu l'emporte sur complet, sans quoi le cas du soir retombe
 * dans le mot qu'on vient de lui retirer.
 */
export function etatDuJour(
  jour: JourDeDisponibilite,
): 'ouvert' | 'ferme' | 'revolu' | 'complet' {
  if (!jour.ouvert) return 'ferme';
  if (jour.revolu) return 'revolu';
  return jour.creneaux_libres > 0 ? 'ouvert' : 'complet';
}

function aDeLaPlace(jour: JourDeDisponibilite): boolean {
  return etatDuJour(jour) === 'ouvert';
}

/**
 * Le jour sur lequel l'écran s'ouvre.
 *
 * Le premier qui a encore une place : ouvrir sur un jour sans place demanderait
 * un geste avant de voir quoi que ce soit. À défaut — quatorze jours sans une
 * seule place — le premier de la bande, qui dira pourquoi.
 */
export function premierJourUtile(jours: JourDeDisponibilite[]): string | null {
  return jours.find(aDeLaPlace)?.jour ?? jours[0]?.jour ?? null;
}
