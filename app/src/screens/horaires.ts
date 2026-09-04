/**
 * Ce que les horaires hebdomadaires permettent de dire, et ce qu'ils ne
 * permettent pas.
 *
 * **Le tableau servi est hebdomadaire, exceptions non appliquées**, et c'est un
 * choix argumenté côté serveur : mêler une fermeture ponctuelle au tableau
 * ferait lire « fermé le mardi » à qui regarde un mardi férié. Le tableau dit
 * la règle, pas la journée.
 *
 * **La conséquence est que l'étiquette de la fiche serait fausse un jour
 * d'exception**, et le rattrapage ne coûte aucun appel : les prestations de la
 * fiche portent leurs prochains créneaux, et ceux-là sortent du calcul de
 * capacité réel, exceptions comprises. **Un créneau aujourd'hui prouve que le
 * salon ouvre aujourd'hui.**
 *
 * **La preuve ne va que dans un sens, et c'est ce qui la rend sûre.** Aucun
 * créneau aujourd'hui ne prouve rien — le salon peut être fermé, ou plein.
 * L'étiquette ne se rend alors pas. Un faux négatif cache une information
 * vraie ; un faux positif envoie quelqu'un devant une porte close.
 *
 * **Il reste un cas ouvert, et il est écrit ici plutôt que découvert plus
 * tard** : une journée seulement *raccourcie* — le salon ferme à 17 h au lieu
 * de 19 h — reste ouverte, donc l'étiquette se rend, et elle annonce 19 h. Le
 * remède est un champ, pas un calcul : les horaires du jour, exceptions
 * appliquées. Voir `TASKS.md`.
 */
import type { PlageHebdomadaire } from '../api';

/**
 * L'heure de fermeture d'aujourd'hui, ou `null`.
 *
 * **La fin de la *dernière* plage, jamais de la première.** Un salon qui ferme
 * le midi a deux plages ; annoncer la fin de la première ferait fermer la
 * boutique à 13 h aux yeux de tout le monde.
 *
 * `null` quand le tableau ne connaît pas ce jour — c'est un jour de fermeture
 * hebdomadaire — ou quand rien ne prouve que le salon ouvre aujourd'hui, ce qui
 * couvre les fermetures exceptionnelles que le tableau ignore.
 */
export function fermeAujourdhui(
  horaires: PlageHebdomadaire[],
  timezone: string,
  ouvreAujourdhui: boolean,
  maintenant: Date = new Date(),
): string | null {
  // **Une exception l'emporte sur la règle**, et c'est le seul cas que le
  // croisement sait fermer. Sans lui, un jour férié afficherait l'horaire
  // ordinaire — le salon serait annoncé ouvert jusqu'à 19 h porte close.
  if (!ouvreAujourdhui) return null;

  const dujour = horaires
    .filter((plage) => plage.weekday === jourDeLaSemaine(timezone, maintenant))
    .map((plage) => plage.end_time)
    .sort();

  return dujour.length ? court(dujour[dujour.length - 1]) : null;
}

/**
 * Le jour de la semaine chez le commerce, lundi valant 0.
 *
 * **Chez le commerce et non sur l'appareil.** À 21 h à Miami, il est déjà
 * demain à Paris : une créatrice en déplacement verrait l'horaire du mauvais
 * jour. Et lundi vaut 0 comme partout ailleurs dans le produit, là où
 * `getDay()` fait commencer la semaine le dimanche.
 */
function jourDeLaSemaine(timezone: string, maintenant: Date): number {
  const nom = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    maintenant,
  );
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(nom);
}

/**
 * « 19:00:00 » devient « 19:00 ».
 *
 * Les secondes d'une heure d'ouverture sont toujours nulles et ne disent rien ;
 * elles occupent trois caractères sur une étiquette qui en compte quinze.
 */
function court(heure: string): string {
  return heure.slice(0, 5);
}

/** Les sept jours, lundi en tête — l'ordre de `weekday`, où 0 est lundi. */
export const JOURS_DE_LA_SEMAINE = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Les plages de chaque jour, les sept, dans l'ordre de la semaine.
 *
 * **Sept lignes, toujours les sept.** Un jour fermé ne disparaît pas de la
 * liste : son absence pourrait aussi bien vouloir dire « fermé » que « pas
 * encore renseigné », et ces deux-là n'appellent pas la même conduite. C'est la
 * règle que la grille du commerce s'était déjà donnée.
 *
 * **`filter` et non `find`, et c'est la différence qui compte.** La grille
 * commerce ne garde qu'une plage par jour : un salon qui ferme le midi y perd
 * sa seconde, et personne ne le voit puisqu'il en reste une. Une créatrice qui
 * se présente à 13 h devant une porte close a payé ce raccourci.
 *
 * **Hebdomadaire, exceptions non appliquées** — c'est ce que le serveur sert,
 * et il le dit. Une grille est plus exposée que l'étiquette du jour : celle-ci
 * se tait faute de preuve, celle-là écrirait sept lignes dont une fausse un
 * jour férié. C'est à l'écran de le dire, pas à cette fonction de le deviner.
 */
export function semaineComplete(
  horaires: PlageHebdomadaire[],
): { jour: number; plages: PlageHebdomadaire[] }[] {
  return JOURS_DE_LA_SEMAINE.map((jour) => ({
    jour,
    plages: horaires
      .filter((plage) => plage.weekday === jour)
      .sort((a, b) => a.start_time.localeCompare(b.start_time)),
  }));
}

/** « 09:00 – 19:00 », ou plusieurs séparées, ou rien quand le jour est fermé. */
export function plagesDuJour(plages: PlageHebdomadaire[]): string | null {
  if (plages.length === 0) return null;
  return plages.map((p) => `${court(p.start_time)} – ${court(p.end_time)}`).join(' · ');
}
