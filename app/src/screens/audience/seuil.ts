/**
 * Ce qu'un nombre d'abonnés ouvre, et ce qu'il lui manque pour l'ouvrir.
 *
 * **Aucun nombre n'apparaît seul.** C'est la correction de fond de la planche
 * v3, et elle est structurelle plutôt que graphique : l'écran portait des
 * chiffres qui décrivent une créatrice sans jamais lui dire quoi en faire.
 * « 7 600 » ne se lit pas ; « 7 600 sur 10 000, il en manque 2 400 pour ouvrir
 * le palier post » se lit et se vise.
 *
 * **Trois conditions, et chacune a coûté une erreur d'affichage ailleurs.**
 *
 * La première est le réseau. Le palier fermé le plus proche peut être sur
 * TikTok pendant qu'on regarde la carte Instagram : poser son seuil dans cette
 * carte ferait compter les abonnés d'un compte vers un palier qui n'en dépend
 * pas. C'est le même défaut que `no_social_account` corrigé sur les obstacles —
 * un message vrai en soi, faux là où il était posé.
 *
 * La deuxième est la nature de l'obstacle. Un palier peut être fermé pour un
 * score trop bas ou un relevé périmé ; une barre d'abonnés sous un obstacle de
 * score promet un levier qui ne débloque rien.
 *
 * La troisième est la source. Le seuil, l'écart **et** le constat viennent tous
 * les trois de l'obstacle, jamais du compte : mélanger les deux sources donne
 * une barre qui contredit sa phrase le jour où elles divergent. Le grand chiffre
 * de la carte reste celui du compte — c'est « vos abonnés » —, la barre est
 * celle du palier.
 */
import type { AudienceDuCompte, ProchainPalier } from '../../api';

export type SeuilDesAbonnes = {
  /** Le nombre d'abonnés que le palier demande. */
  requis: number;
  /** Ce que le serveur a constaté pour ce palier. */
  constate: number;
  /** Ce qu'il manque, tel que le serveur le compte. */
  ecart: number;
  /** De zéro à un, pour la barre. Jamais au-delà : un palier ouvert n'est pas
   * le palier suivant, mais une valeur aberrante ne doit pas déborder. */
  fraction: number;
  /** Le format que ce palier ouvre — « post », « reel ». */
  format: string;
};

function nombre(valeur: string | number | null): number | null {
  if (valeur === null) return null;
  const n = typeof valeur === 'number' ? valeur : Number(valeur);
  return Number.isFinite(n) ? n : null;
}

export function seuilDesAbonnes(
  compte: Pick<AudienceDuCompte, 'platform'>,
  prochain: ProchainPalier | null,
): SeuilDesAbonnes | null {
  // **Falsy, et non `=== null`.** Une réponse plus ancienne, ou un décor qui
  // ne pose pas le champ, le laisse absent : `undefined !== null` aurait lu
  // `platform` sur rien. Le même défaut avait été pris la veille sur le motif
  // de reprise ; il se répète parce que la nullité y est portée par le contrat
  // et l'absence par l'appelant.
  if (!prochain) return null;
  if (prochain.platform !== compte.platform) return null;
  if (prochain.obstacle.raison !== 'not_enough_followers') return null;

  const requis = nombre(prochain.obstacle.requis);
  const constate = nombre(prochain.obstacle.constate);
  const ecart = nombre(prochain.obstacle.ecart);
  if (requis === null || constate === null || ecart === null) return null;
  // Un seuil nul ou négatif ne se divise pas, et ne veut rien dire non plus.
  if (requis <= 0) return null;

  return {
    requis,
    constate,
    ecart,
    fraction: Math.min(1, Math.max(0, constate / requis)),
    format: prochain.content_format,
  };
}
