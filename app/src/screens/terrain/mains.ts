/**
 * Qui a préparé, et qui a remis.
 *
 * **Deux gestes et non un.** Préparer quarante fiches au bureau et en remettre
 * vingt en tournée ne sont pas la même chose : sur une tournée à deux
 * personnes, c'est ce qui permet de comparer les méthodes. Le serveur sert donc
 * deux champs, et l'écran ne les confond pas.
 *
 * **Mais il ne les répète pas non plus.** Quand la même personne a fait les
 * deux — le cas courant —, écrire son adresse deux fois sur la même ligne
 * n'ajoute rien et allonge une liste qu'on parcourt. La seconde main n'apparaît
 * que lorsqu'elle diffère de la première, et c'est précisément là qu'elle
 * apprend quelque chose.
 */
import type { FichePreparee } from '../../api';

export type MainsDeLaFiche = {
  /** Qui a préparé. Nulle quand le serveur ne le sait pas. */
  preparee: string | null;
  /**
   * Qui a remis, **quand ce n'est pas la même personne**. Nulle sinon — y
   * compris quand quelqu'un a remis, si c'est celui qui avait préparé.
   */
  remiseParUnAutre: string | null;
};

export function mainsDeLaFiche(
  fiche: Pick<FichePreparee, 'prepared_by' | 'remis_par'>,
): MainsDeLaFiche {
  const preparee = fiche.prepared_by ?? null;
  const remise = fiche.remis_par ?? null;

  return {
    preparee,
    // **Comparé, pas supposé.** Une fiche remise sans préparateur connu doit
    // dire qui l'a remise : c'est la seule main qu'on ait.
    remiseParUnAutre: remise && remise !== preparee ? remise : null,
  };
}
