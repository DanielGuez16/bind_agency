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

/**
 * Sept jours, et c'est le seul délai de ce module.
 *
 * Design l'écrit sur la planche : la confirmation s'efface au bout d'une
 * semaine. Elle ne se compte pas en heures ouvrées ni en jours civils du
 * commerce — c'est un âge, pas un rendez-vous.
 */
export const DUREE_DE_LA_CONFIRMATION_MS = 7 * 24 * 3_600_000;

export type MiseEnLigne =
  | { forme: 'publie' }
  /**
   * Suspendu — et **ce n'est pas une publication en attente**.
   *
   * L'écran disait « il reste deux points avant que les créatrices vous
   * voient » à un salon suspendu, parce que le calcul ne regardait que
   * « actif ou non ». Cocher les deux points n'aurait rien changé : ce qui
   * retient n'est pas la composition, c'est une décision prise sur lui.
   *
   * Et un salon suspendu **doit encore honorer ce qu'il a accepté**. C'est la
   * même règle que la suppression de compte — supprimer ou être suspendu
   * n'annule pas des créneaux promis — et elle n'avait d'écran nulle part.
   */
  | { forme: 'suspendu' }
  /**
   * En ligne depuis peu, et la ligne le dit encore.
   *
   * **Ce que la planche voulait, à moitié.** Elle écrit « you are live · 41
   * creators nearby can book you », et cette seconde moitié n'est toujours pas
   * servie — la portée locale ne vit que sur les rapports. La ligne s'arrête
   * donc à ce qui est vrai : depuis quand. Affirmer un nombre de créatrices à
   * l'estime serait une confirmation fausse, ce qui est pire que pas de
   * confirmation ; ne pas l'écrire n'enlève rien à la date.
   */
  | {
      forme: 'confirme';
      depuis: string;
      /** Combien de créatrices peuvent réserver. **Nul quand le serveur ne l'a
       *  pas servi** — une réponse d'avant le champ. La ligne dit alors la date
       *  seule, ce qu'elle faisait déjà : la moitié vraie vaut mieux que la
       *  moitié inventée. */
      peuvent: number | null;
    }
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

/**
 * Ce que le bandeau a le droit de lire de la vue d'activation : **le statut et
 * les étapes, et rien d'autre**.
 *
 * La date de mise en ligne y est entrée le jour où elle a été servie, et elle
 * ne sert qu'à une chose : décider si la confirmation a encore son âge. Elle
 * ne pèse sur aucune des autres formes — « qu'est-ce qui retient la
 * publication » ne dépend pas de « depuis quand elle a eu lieu ».
 */
type CeQuiRetientLaPublication = Pick<
  VueDActivation,
  'status' | 'etapes' | 'en_ligne_depuis'
> &
  // **Optionnels, et c'est ce que le calcul suppose.** Une réponse d'avant ces
  // deux champs — un serveur pas encore déployé — doit encore produire une
  // ligne : la date seule, ce qu'elle disait déjà. Les rendre obligatoires
  // forcerait les décors à les poser, et masquerait le seul cas où l'absence
  // change quelque chose.
  Partial<Pick<VueDActivation, 'createurs_qui_peuvent_reserver' | 'confirmation_jours'>>;

export function miseEnLigne(
  vue: CeQuiRetientLaPublication | null | undefined,
  /** L'instant de lecture. Passé en paramètre : un test qui fige l'horloge
   *  globale fige aussi tout le reste de l'écran. */
  maintenant: number = Date.now(),
): MiseEnLigne | null {
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

  // **Avant tout le reste.** Un salon suspendu n'a pas d'étape à cocher : la
  // question « qu'est-ce qui retient la publication » ne se pose plus.
  if (vue.status === 'suspended') return { forme: 'suspendu' };

  if (vue.status === 'active') {
    if (invisibles.length > 0) {
      return { forme: 'publie-mais-invisible', manquantes: invisibles };
    }
    // **La confirmation a un âge, et passé sept jours elle n'a plus rien à
    // dire.** Une ligne qui reste après avoir été lue est la définition d'un
    // bandeau dont on ne comprend plus l'objet. Sans date — un salon publié
    // avant que le journal la porte — on retombe sur le silence, qui est ce
    // que le bandeau faisait déjà.
    const depuis = vue.en_ligne_depuis;
    if (depuis === null || depuis === undefined) return { forme: 'publie' };
    const age = maintenant - Date.parse(depuis);
    // **Le délai vient du serveur, qui s'en sert aussi.** Il décide là-bas si la
    // portée locale est calculée ; deux copies d'un même délai finissent par
    // diverger, et le jour où elles le font la ligne montre « depuis 8 jours »
    // sans le nombre qui rassure — le pire des deux états. Le repli sur la
    // constante couvre une réponse d'avant le champ.
    const fenetre = vue.confirmation_jours
      ? vue.confirmation_jours * 24 * 3_600_000
      : DUREE_DE_LA_CONFIRMATION_MS;
    if (Number.isNaN(age) || age > fenetre) return { forme: 'publie' };
    return { forme: 'confirme', depuis, peuvent: vue.createurs_qui_peuvent_reserver ?? null };
  }

  const faites = vue.etapes.filter((etape) => etape.done).length;
  const total = vue.etapes.length;

  return manquantes.length === 0
    ? { forme: 'prete', faites, total }
    : { forme: 'incomplet', manquantes, faites, total };
}
