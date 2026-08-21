/**
 * La fenêtre que le rapport regarde, et d'où part son échelle.
 *
 * **La date de départ vient du serveur, jamais de l'horloge locale.** Le
 * découpage se fait dans le fuseau du salon — « du 1er au 31 » contient le 31,
 * et le mois d'un salon de Miami ne commence pas à 20 h la veille. Un client qui
 * calculerait « aujourd'hui moins 84 jours » sur sa propre horloge décalerait la
 * borne d'un jour à chaque bord de fuseau, et le décalage ne se verrait que sur
 * les rapports de fin de mois.
 *
 * La borne de fin déjà servie sert donc de référence : elle est l'instant que le
 * serveur a retenu pour « maintenant », dans le fuseau qu'il a retenu.
 */

/** Les trois positions du sélecteur. */
export type Periode = 'trenteJours' | 'douzeSemaines' | 'depuisLeDebut';

export const PERIODES: Periode[] = ['trenteJours', 'douzeSemaines', 'depuisLeDebut'];

const JOUR = 86_400_000;

/**
 * Le `depuis` à demander, ou rien pour laisser la fenêtre par défaut.
 *
 * `undefined` sur trente jours : c'est déjà la fenêtre par défaut du serveur, et
 * la recalculer ici ferait deux sources pour une seule règle.
 *
 * `undefined` aussi sur « depuis le début » quand rien ne s'est jamais passé —
 * l'écran a alors changé de nature et ne montre aucun graphique.
 */
export function depuisPour(
  periode: Periode,
  finServie: string,
  premiereSemaine: string | null,
): string | undefined {
  if (periode === 'trenteJours') return undefined;
  if (periode === 'depuisLeDebut') return premiereSemaine ?? undefined;

  const fin = new Date(finServie);
  if (Number.isNaN(fin.getTime())) return undefined;
  // Douze semaines pleines, la semaine en cours comprise.
  return new Date(fin.getTime() - 83 * JOUR).toISOString().slice(0, 10);
}

/**
 * Les positions réellement offertes.
 *
 * **« Depuis le début » n'apparaît que s'il y a un début.** Sans la première
 * semaine, il faudrait inventer une date de départ, et un onglet qui rendrait la
 * même chose que son voisin ferait douter des deux.
 */
export function periodesOffertes(premiereSemaine: string | null): Periode[] {
  return premiereSemaine ? PERIODES : PERIODES.filter((p) => p !== 'depuisLeDebut');
}
