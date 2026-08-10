/**
 * Le vocabulaire des refus, partagé par le commerce et l'arbitre.
 *
 * **Un code, pas une phrase.** Le motif voyageait en texte libre : le commerce
 * écrivait sa raison, elle traversait le journal telle quelle et ressortait sur
 * l'écran de l'arbitre dans la langue de celui qui l'avait écrite — « Le format
 * n'est pas celui attendu » au milieu d'une interface en anglais. Une phrase ne
 * se traduit pas à l'affichage.
 *
 * **La même liste des deux côtés.** L'arbitre tranche dans le vocabulaire du
 * commerce ; deux listes finiraient par diverger, et il devrait traduire pour
 * comprendre la décision qu'il révise.
 */

/** Les quatre motifs. Les valeurs sont celles que l'API accepte, et rien d'autre. */
export const MOTIFS = [
  'missing_mention',
  'missing_location',
  'wrong_format',
  'low_quality',
] as const;

export type MotifDeDecision = (typeof MOTIFS)[number];

const CLES: Record<MotifDeDecision, string> = {
  missing_mention: 'commerce.motifMention',
  missing_location: 'commerce.motifLieu',
  wrong_format: 'commerce.motifFormat',
  low_quality: 'commerce.motifQualite',
};

/**
 * Le motif dans la langue de qui regarde.
 *
 * Le repli rend la valeur telle quelle. Il ne sert pas à couvrir un code
 * inconnu — l'API n'en accepte plus — mais les motifs écrits avant ce
 * changement, qui dorment dans le journal sous forme de phrases. Une phrase se
 * lit ; un blanc ferait disparaître la raison d'une escalade.
 */
export function libelleDuMotif(t: (cle: string) => string, motif: string): string {
  return motif in CLES ? t(CLES[motif as MotifDeDecision]) : motif;
}
