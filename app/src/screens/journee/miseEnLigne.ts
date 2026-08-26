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
import type { SuspensionReason, VueDActivation } from '../../api';

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
  | {
      forme: 'suspendu';
      /**
       * Pourquoi, quand le serveur le dit. **Nul reste un cas rendu**, et pas
       * un bloc vide : la contrainte de table garantit le motif sur un salon
       * suspendu, mais une garde de base ne traverse pas un cache
       * d'application — ce bandeau se rend sur une réponse qui a pu dormir.
       */
      motif: SuspensionReason | null;
      /** Depuis quand, en ISO. La **dernière** sortie : un salon qui s'est mis
       * en pause deux étés de suite en a deux, et c'est celle d'aujourd'hui qui
       * explique son état. */
      depuis: string | null;
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
  Partial<
    Pick<
      VueDActivation,
      // Le motif et sa date suivent la même règle, et pour la même raison :
      // une réponse plus vieille qu'eux doit continuer de rendre le bandeau
      // sans motif, qui est exactement ce qu'il rendait hier.
      | 'suspension_motif'
      | 'suspendu_depuis'
    >
  >;

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
  if (vue.status === 'suspended') {
    return {
      forme: 'suspendu',
      // **Le motif vient de la colonne, la date du journal**, et les deux ne
      // s'unifient pas : lire un état courant dans un journal d'événements a
      // déjà coûté cher ici. Une date de transition, elle, ne vit nulle part
      // ailleurs. Qui verra deux sources pour un même bloc voudra les
      // rapprocher — c'est ce qu'il ne faut pas faire.
      motif: vue.suspension_motif ?? null,
      depuis: vue.suspendu_depuis ?? null,
    };
  }

  if (vue.status === 'active') {
    if (invisibles.length > 0) {
      return { forme: 'publie-mais-invisible', manquantes: invisibles };
    }
    /**
     * **Publié et complet : rien.** Quatrième reprise de cet écran, et c'est le
     * bandeau « vous êtes en ligne » qui part.
     *
     * Il tenait sept jours après la publication, et son défaut n'était pas sa
     * durée : il **confirmait un état permanent à quelqu'un qui ouvre l'écran
     * pour agir**, en occupant le tiers haut de l'écran le plus ouvert du
     * produit. Un salon publié l'est ; le lui redire chaque matin ne lui apprend
     * rien et repousse plus bas ce qui, lui, attend une décision.
     *
     * Ce que la fenêtre décidait — `confirmation_jours`, la portée locale —
     * n'est plus lu par personne ici ; les deux champs restent servis et sont
     * déclarés comme tels.
     */
    return { forme: 'publie' };
  }

  const faites = vue.etapes.filter((etape) => etape.done).length;
  const total = vue.etapes.length;

  return manquantes.length === 0
    ? { forme: 'prete', faites, total }
    : { forme: 'incomplet', manquantes, faites, total };
}
