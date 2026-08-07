/**
 * Comment un obstacle se dit.
 *
 * **L'écart chiffré n'apparaît qu'à partir de 60 % du seuil.** En dessous, le
 * palier est un horizon : on annonce le seuil, on promet une notification à
 * l'approche, et on ne projette **aucun délai**. « Il te manque 47 000
 * abonnés » à quelqu'un qui en a 3 000 ne l'aide pas à agir, cela lui apprend
 * seulement que ce n'est pas pour lui — et « environ trois ans à ce rythme »
 * serait pire encore.
 *
 * **Les codes viennent du serveur et ne se traduisent pas en interne.** Il
 * n'existe aucune table de correspondance ici : le code sert de clé au
 * catalogue, directement. Un code inconnu — serveur en avance sur l'app — donne
 * « détail indisponible », jamais un texte improvisé.
 *
 * **Un écart en secondes ne s'affiche pas, une date si.** `metrics_stale` et
 * `account_token_invalid` portent leur date dans `depuis` ; c'est elle qui se
 * lit, pas les 431 200 secondes de son `ecart`.
 */
import type { Obstacle } from '../api';

/** Le seuil de proximité, au-delà duquel on chiffre. */
export const PART_POUR_CHIFFRER = 0.6;

/** Les obstacles dont la date explique quelque chose. */
const OBSTACLES_DATES = new Set([
  'metrics_stale',
  'account_token_invalid',
  'account_under_review',
]);

export type FormeDObstacle =
  | { forme: 'ecart'; manque: number; requis: number }
  | { forme: 'horizon'; requis: number }
  | { forme: 'date'; depuis: string }
  | { forme: 'simple' };

function nombre(valeur: string | number | null): number | null {
  if (valeur === null) return null;
  const n = typeof valeur === 'number' ? valeur : Number(valeur);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ce qu'il faut dire de cet obstacle, sans encore le dire.
 *
 * La décision est séparée du rendu pour qu'elle se teste sans écran : c'est
 * une règle produit, pas une mise en page.
 */
export function formeDe(obstacle: Obstacle): FormeDObstacle {
  if (OBSTACLES_DATES.has(obstacle.raison) && obstacle.depuis) {
    return { forme: 'date', depuis: obstacle.depuis };
  }

  const requis = nombre(obstacle.requis);
  const constate = nombre(obstacle.constate);

  // Sans seuil, il n'y a ni écart ni horizon à annoncer : `no_metrics` ou
  // `no_social_account` disent seulement qu'il manque quelque chose.
  if (requis === null || requis <= 0) return { forme: 'simple' };

  // Constaté nul avec un seuil : on connaît la cible, pas la position. C'est
  // un horizon, pas un écart de la taille du seuil — annoncer « il te manque
  // 10 000 » à quelqu'un qu'on n'a pas mesuré serait une invention.
  if (constate === null) return { forme: 'horizon', requis };

  if (constate / requis >= PART_POUR_CHIFFRER) {
    // L'écart se recalcule plutôt que de faire confiance à `ecart` : les deux
    // doivent coïncider, et si un jour ils divergent c'est la soustraction qui
    // a raison sur l'écran.
    return { forme: 'ecart', manque: Math.max(0, requis - constate), requis };
  }

  return { forme: 'horizon', requis };
}

/**
 * La phrase à afficher.
 *
 * `t` est la fonction du catalogue. Les clés sont dérivées du code serveur, ce
 * qui interdit toute reformulation locale : ajouter un code sans son message
 * fait apparaître la clé brute, et le test de catalogue tombe avant.
 */
export function messageDObstacle(
  t: (cle: string, params?: Record<string, unknown>) => string,
  obstacle: Obstacle,
  codesConnus: ReadonlySet<string>,
): string {
  if (!codesConnus.has(obstacle.raison)) return t('etats.detailIndisponible');

  const base = t(`errors.${obstacle.raison}`);
  const forme = formeDe(obstacle);

  switch (forme.forme) {
    case 'ecart':
      return `${base} ${t('obstacles.ecart', { manque: forme.manque, requis: forme.requis })}`;
    case 'horizon':
      // Le seuil, et rien d'autre. Aucune projection de rythme.
      return `${base} ${t('obstacles.horizon', { requis: forme.requis })}`;
    case 'date':
      return `${base} ${t('obstacles.depuis', { date: new Date(forme.depuis).toLocaleDateString() })}`;
    case 'simple':
      return base;
  }
}
