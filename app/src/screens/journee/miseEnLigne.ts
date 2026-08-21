/**
 * Ce qui manque avant que les créatrices voient le salon.
 *
 * **Ce n'était pas un écran, et c'est pourquoi personne ne comprenait à quoi il
 * servait.** « Profil et mise en ligne » était un onglet ; ce qu'il portait est
 * un **état** — une liste de ce qui manque, qui n'a d'utilité que là où le salon
 * regarde déjà, et qui doit disparaître une fois remplie. La transformer en page
 * a produit exactement ce que les testeurs ont dit.
 *
 * **Le bandeau vit donc sur la journée**, l'écran du matin, et s'efface à la
 * publication. Un état n'a pas besoin d'un nom, il a besoin d'être vu au bon
 * moment.
 */
import type { VueDActivation } from '../../api';

export type MiseEnLigne =
  | { forme: 'publie' }
  /**
   * Publié, et pourtant absent des murs.
   *
   * **Le cas que j'ai failli perdre en retirant l'écran.** Les étapes non
   * bloquantes ne retiennent pas la publication mais décident de la visibilité :
   * un salon en ligne sans photo de couverture n'apparaît dans aucun mur, et
   * rien d'autre ne le lui dirait. Ce n'est pas une liste de tâches qui traîne
   * après avoir été remplie — c'est un état non résolu, et il a le droit de
   * rester à l'écran tant qu'il dure.
   */
  | { forme: 'publie-mais-invisible'; manquantes: string[] }
  /** Il reste des étapes bloquantes : le salon ne peut pas encore paraître. */
  | { forme: 'incomplet'; manquantes: string[]; faites: number; total: number }
  /** Tout est fait, la publication reste à demander. */
  | { forme: 'prete'; faites: number; total: number };

export function miseEnLigne(vue: VueDActivation | null | undefined): MiseEnLigne | null {
  // **Falsy, et non `=== null`.** Sixième fois de la série : la nullité est
  // portée par le contrat, l'absence par l'appelant. Sans état d'activation, on
  // ne sait pas si le salon est publié — et un bandeau posé au hasard vaut
  // moins que pas de bandeau.
  if (!vue || !vue.etapes) return null;
  // **Seules les bloquantes retiennent la publication.** Les autres pèsent sur
  // la visibilité une fois publié — les mêler ferait attendre le salon derrière
  // une condition qui ne le retient pas.
  const manquantes = vue.etapes
    .filter((etape) => etape.blocking && !etape.done)
    .map((etape) => etape.cle);
  const invisibles = vue.etapes
    .filter((etape) => !etape.blocking && !etape.done)
    .map((etape) => etape.cle);

  if (vue.status === 'active') {
    return invisibles.length === 0
      ? { forme: 'publie' }
      : { forme: 'publie-mais-invisible', manquantes: invisibles };
  }

  const faites = vue.etapes.filter((etape) => etape.done).length;
  const total = vue.etapes.length;

  return manquantes.length === 0
    ? { forme: 'prete', faites, total }
    : { forme: 'incomplet', manquantes, faites, total };
}
