/**
 * Comment nommer la créatrice d'un dossier, partout pareil.
 *
 * **Trois replis coexistaient, et aucun ne disait la vérité.** Le contrôle des
 * publications finissait sur une chaîne vide, l'arbitrage sur un tiret à deux
 * endroits et sur une chaîne vide au troisième. Les trois répondaient à la même
 * question — que met-on quand il n'y a pas de nom — et les trois y répondaient
 * autrement, ce qui est la définition d'une règle qui n'existe pas.
 *
 * **Un tiret et « partie » ne veulent pas dire la même chose.** Le tiret dit
 * « on ne sait pas », et un arbitre qui le lit croit à une donnée manquante :
 * il tranche un dossier en pensant qu'une créatrice attend derrière, alors
 * qu'elle a quitté BIND et que son compte est anonymisé. Ce n'est pas un défaut
 * d'affichage, c'est une erreur sur ce qu'il arbitre.
 *
 * Le repli vide reste pour le cas qui n'est ni l'un ni l'autre : un compte sans
 * pseudonyme, qui existe encore. Rare, et ce n'est pas à cette fonction de
 * l'inventer.
 *
 * **Le prénom a disparu du repli parce qu'il a disparu de la réponse.** Un
 * salon voit un pseudonyme, jamais un état civil : il n'a aucune raison de
 * connaître le nom légal de quelqu'un. Le repli qui allait le chercher n'était
 * pas un filet, c'était la porte par laquelle le nom sortait.
 */
import type { LigneDeFile } from '../api';

export function nomDuCreateur(
  ligne: Pick<LigneDeFile, 'creator_partie' | 'creator_handle'>,
  t: (cle: string) => string,
  /** Ce qu'on écrit quand il n'y a ni départ ni nom. Vide en ligne, `—` en tableau. */
  absent = '',
): string {
  if (ligne.creator_partie) return t('commerce.creatricePartie');
  return ligne.creator_handle ?? absent;
}
