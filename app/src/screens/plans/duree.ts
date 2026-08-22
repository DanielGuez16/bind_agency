/**
 * La durée d'abonnement, et ce qu'on a le droit d'en dire.
 *
 * **Sept mois pour un plan contre onze pour un autre à prix double dit que le
 * second n'est pas trop cher**, et aucun total ne le disait. C'est la colonne
 * qui manquait le plus à un écran qu'on ouvre pour décider d'un prix.
 *
 * **Mais un nombre seul ment.** « 7 mois » sorti de trois départs se lit comme
 * un fait ; il faut donc l'effectif à côté, et la phrase les porte ensemble.
 * Et si les abonnements en cours écrasent les terminés, la médiane terminée est
 * justement celle à ne pas croire — on ne mesure alors que ceux qui sont
 * partis, c'est-à-dire les mécontents. Le biais est visible sans que personne
 * ait à en juger, ce qui vaut mieux qu'un serveur qui trancherait pour nous.
 */
import type { PlanAdministrateur } from '../../api';

export type DureeLisible = {
  /** Les mois arrondis, pour la ligne. */
  mois: number;
  /** Sur combien d'abonnements terminés elle est calculée. */
  sur: number;
  /**
   * Vrai quand les abonnements encore vivants dépassent ceux qui sont finis.
   *
   * La médiane terminée devient alors une minorité qui parle pour tous, et
   * l'écran doit le dire — pas la cacher, pas la corriger.
   */
  minoritaire: boolean;
  /**
   * La médiane des durées **courues**, quand elle éclaire l'autre.
   *
   * **Un minimum, jamais une durée de vie** : ces abonnements ne sont pas
   * finis. Elle n'est portée que dans le cas minoritaire — c'est là qu'elle
   * sert, en montrant que la médiane terminée parle au nom d'une poignée
   * pendant que la masse court encore.
   */
  enCoursMois: number | null;
  enCours: number;
};

/**
 * Nulle quand rien n'est mesurable : aucun abonnement terminé, ou aucune date.
 *
 * **Nul et non zéro.** « 0 mois » se lirait « ils partent tout de suite », qui
 * est le contraire de ce que dit l'absence de mesure.
 */
export function dureeLisible(plan: PlanAdministrateur): DureeLisible | null {
  const jours = plan.duree_mediane_terminee_jours;
  if (jours === null || jours === undefined) return null;
  // Zéro abonnement terminé avec une médiane servie serait incohérent ; on ne
  // l'affiche pas plutôt que de montrer « sur 0 ».
  if (!plan.abonnements_termines) return null;

  return {
    // **Des mois et non des jours.** « 213 jours » demande une division de tête
    // à quelqu'un qui compare deux plans ; « 7 mois » se compare d'un regard.
    mois: Math.round(jours / 30),
    sur: plan.abonnements_termines,
    minoritaire: (plan.abonnements_en_cours ?? 0) > plan.abonnements_termines,
    enCoursMois:
      plan.duree_mediane_en_cours_jours === null ||
      plan.duree_mediane_en_cours_jours === undefined
        ? null
        : Math.round(plan.duree_mediane_en_cours_jours / 30),
    enCours: plan.abonnements_en_cours ?? 0,
  };
}

/**
 * La part de chaque catégorie, pour la barre.
 *
 * **La plus fournie donne l'échelle, pas le total.** Une barre rapportée au
 * total écraserait les quatre lignes d'un plan où une catégorie domine, et
 * c'est précisément ce plan-là qu'on vient lire.
 */
export function partsParCategorie(
  plan: PlanAdministrateur,
): { categorie: string; abonnes: number; actifs: number; fraction: number }[] {
  const lignes = plan.abonnes_par_categorie ?? [];
  const sommet = Math.max(0, ...lignes.map((ligne) => ligne.abonnes));

  return lignes.map((ligne) => ({
    categorie: ligne.categorie,
    abonnes: ligne.abonnes,
    // **Combien restent, à côté de combien ont souscrit.** C'est l'écart qui
    // porte l'argument : une catégorie qui souscrit peu et part vite dit que le
    // plan est trop cher pour elle ; une qui souscrit massivement et ne part
    // jamais dit qu'il est trop bas. Le seul total ne dirait ni l'un ni l'autre.
    actifs: ligne.abonnes_actifs,
    // Zéro reste zéro : une catégorie qui n'a jamais souscrit garde sa ligne et
    // sa barre vide, parce que « ce plan n'a jamais séduit un salon d'ongles »
    // est exactement ce qu'on vient lire.
    fraction: sommet === 0 ? 0 : ligne.abonnes / sommet,
  }));
}
