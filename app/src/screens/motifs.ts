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

/**
 * L'écart que l'approbation accepte, nommé dans le bouton.
 *
 * **Le défaut relevé en campagne, et il était grave.** « Approve » seul ne
 * disait pas ce qu'on approuvait. Dans une file où l'on tranche vingt dossiers
 * à la chaîne, un verbe seul finit par vouloir dire « suivant » — et cette
 * décision-là est la seule du produit qui ne se rouvre pas.
 *
 * **Le dernier motif est ce qui décide du libellé**, parce que c'est lui qui a
 * mis le dossier là. Il vient du journal, il est déjà codé dans le vocabulaire
 * fermé, et il n'y a donc rien à déduire d'une preuve : on nomme ce que
 * quelqu'un a reproché, pas ce qu'on croit voir.
 *
 * **Quand il n'y a rien à excuser, le bouton redevient simple.** L'écart
 * n'existe que s'il y en a un ; annoncer « sans la mention » sur un dossier
 * conforme ferait douter de l'approbation elle-même.
 */
const ECARTS: Record<MotifDeDecision, string> = {
  missing_mention: 'admin.issueApproveSansMention',
  missing_location: 'admin.issueApproveSansLieu',
  wrong_format: 'admin.issueApproveMalgreFormat',
  low_quality: 'admin.issueApproveMalgreQualite',
};

export function libelleDApprobation(t: (cle: string) => string, dernierMotif: string | null): string {
  if (dernierMotif !== null && dernierMotif in ECARTS) {
    return t(ECARTS[dernierMotif as MotifDeDecision]);
  }
  // Un motif inconnu — une phrase écrite avant le vocabulaire fermé — ne se
  // met pas dans un bouton : il ne se traduit pas, et il n'a pas de longueur
  // bornée. L'écart reste alors lisible dans l'historique, juste au-dessus.
  return t('admin.issueApprove');
}
