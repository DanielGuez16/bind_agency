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
import type { Tentative } from '../../api';

export type FormeDuMalentendu = {
  /** Combien de reproches ont été formulés. */
  compte: number;
  /**
   * Vrai quand tous les motifs sont le même.
   *
   * **Faux sur une seule tentative**, et c'est délibéré : un motif unique n'est
   * pas « le même motif répété ». Le dire vrai ferait proposer la clôture sans
   * faute au premier refus, avant même qu'on ait pu se tromper deux fois.
   */
  meme: boolean;
  /** Les motifs dans l'ordre, pour la ligne des trois. */
  motifs: string[];
};

export function formeDuMalentendu(tentatives: Tentative[] | null | undefined): FormeDuMalentendu {
  // Falsy plutôt que `=== null` : une réponse d'avant le champ, ou un décor qui
  // ne le pose pas, le laisse absent — et « aucune tentative » est alors la
  // bonne réponse, pas une chute.
  const liste = tentatives ?? [];
  // **Seuls les reproches comptent.** `par` dit qui a demandé la reprise ; une
  // tentative sans motif n'en est pas un, et la compter gonflerait le nombre
  // que l'arbitre lit pour décider.
  const motifs = liste.map((tentative) => tentative.motif).filter((motif) => Boolean(motif));

  return {
    compte: motifs.length,
    meme: motifs.length > 1 && new Set(motifs).size === 1,
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
