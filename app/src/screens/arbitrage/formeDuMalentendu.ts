/**
 * La forme du malentendu : ce que la répétition d'un motif dit du dossier.
 *
 * **Ce qui doit se voir n'est pas la conversation absente, c'est sa forme.**
 * Rendre visible ce qui n'a pas été dit est bien le travail de cet écran —
 * sinon l'arbitre tranche sur la dernière tentative comme si les deux
 * précédentes n'existaient pas. Mais pas en affichant des notes libres l'une
 * sous l'autre : cela ferait juger un ton, et un arbitre qui lit deux
 * paragraphes se met à arbitrer la politesse.
 *
 * **Ce qui est lisible et décisif, c'est la répétition du motif.** Trois refus
 * pour le même motif ne disent pas qu'une créatrice est de mauvaise foi : ils
 * disent que la demande n'a jamais été comprise, et que la liste fermée de
 * motifs n'a pas su la porter. Trois motifs différents disent l'inverse. C'est
 * le même nombre de pixels et ce n'est pas la même décision.
 */
import type { LigneDeFile } from '../../api';

export type FormeDuMalentendu = {
  /** Combien de reproches ont été formulés. */
  compte: number;
  /**
   * Vrai quand tous les motifs sont le même.
   *
   * **Il vient du serveur.** Le seuil est `collaboration_max_attempts`, qui vit
   * en configuration, et la répétition se compte **de suite** et non en tout :
   * mention, format, mention fait deux occurrences et une seule suite. Compter
   * les occurrences proposerait « fermer sans faute » sur un dossier où deux
   * choses clochaient réellement — c'est-à-dire là où il faut trancher.
   */
  meme: boolean;
  /** Les motifs dans l'ordre, pour la ligne des trois. */
  motifs: string[];
};

export function formeDuMalentendu(
  ligne: Pick<LigneDeFile, 'tentatives' | 'meme_motif_repete'>,
): FormeDuMalentendu {
  // Falsy plutôt que `=== null` : une réponse d'avant le champ, ou un décor qui
  // ne le pose pas, le laisse absent — et « aucune tentative » est alors la
  // bonne réponse, pas une chute.
  const liste = ligne.tentatives ?? [];
  // **Seuls les reproches comptent.** Une tentative sans motif n'en est pas un,
  // et la compter gonflerait le nombre que l'arbitre lit pour décider.
  const motifs = liste.map((tentative) => tentative.motif).filter((motif) => Boolean(motif));

  return {
    compte: motifs.length,
    // **Servi, plus dérivé.** Je comparais l'ensemble des motifs et exigeais
    // qu'ils soient tous identiques ; le serveur compte la **suite** du dernier
    // contre un seuil de configuration. « Format, mention, mention, mention »
    // faisait diverger les deux, et c'est le serveur qui a raison : les trois
    // derniers refus portent bien sur la même chose. Un écran qui écrirait le
    // seuil en dur mentirait au premier ajustement.
    //
    // Absent, on répond faux : sous-proposer « fermer sans faute » est le bon
    // défaut — sur-proposer ferait clore un dossier où il fallait trancher.
    meme: ligne.meme_motif_repete === true,
    motifs,
  };
}

/**
 * Ce que la file écrit dans sa colonne : « 3 · same » ou « 3 · mixed ».
 *
 * Le nombre seul ne suffit pas — deux dossiers à trois tentatives ne demandent
 * pas le même arbitre — et le mot seul ne suffit pas non plus : « same » sur
 * deux tentatives et sur cinq n'appelle pas la même attention.
 */
export function motDeLaForme(forme: FormeDuMalentendu): 'meme' | 'melange' | null {
  if (forme.compte === 0) return null;
  if (forme.compte === 1) return null;
  return forme.meme ? 'meme' : 'melange';
}
