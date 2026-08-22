import type { RepriseDuCompte } from '../../api';

/**
 * Ce qu'une reprise de compte est devenue, et laquelle court encore.
 *
 * **Une reprise échue n'est pas une reprise fermée**, et c'est la distinction
 * qui porte tout le sens. Le service l'écrit sans détour : `ended_at` ne se
 * remplit que si quelqu'un a refermé ; l'expiration éteint sans rien écrire.
 * Dans une liste, « refermée à 15 h 12 » et « expirée toute seule » ne se
 * lisent pas pareil — et c'est la seconde qui devrait gêner. Les confondre
 * effacerait exactement ce que le salon a besoin de remarquer.
 *
 * **`ended_at` se lit faux, jamais différent de nul.** Une réponse d'avant le
 * champ, ou un décor écrit sans lui, rend `undefined` — et `!== null` dirait
 * alors « refermée » d'une reprise que personne n'a refermée. Sixième fois sur
 * ce projet.
 */
export type EtatDeLaReprise = 'en-cours' | 'refermee' | 'expiree';

export function etatDeLaReprise(
  reprise: Pick<RepriseDuCompte, 'expires_at' | 'ended_at'>,
  maintenant = Date.now(),
): EtatDeLaReprise {
  if (reprise.ended_at) return 'refermee';

  const echeance = new Date(reprise.expires_at).getTime();
  // Une échéance illisible ne vaut pas « expirée » : elle vaut « on ne sait
  // pas », et éteindre un bandeau sur une date qu'on n'a pas su lire cacherait
  // une reprise en cours.
  if (Number.isNaN(echeance)) return 'en-cours';

  return echeance <= maintenant ? 'expiree' : 'en-cours';
}

/**
 * La reprise qui court, s'il y en a une.
 *
 * **Une seule peut courir à la fois par administrateur**, mais rien n'interdit
 * à deux administrateurs d'être entrés — le service ne refuse que la seconde
 * du *même*. La plus récemment ouverte est celle que le bandeau porte : c'est
 * la phrase la plus fraîche, et c'est celle qui explique ce qui bouge à
 * l'écran maintenant.
 */
export function repriseEnCours(
  reprises: readonly RepriseDuCompte[] | null | undefined,
  maintenant = Date.now(),
): RepriseDuCompte | null {
  // **`Array.isArray` et non une longueur**, bien que le type l'affirme. Le
  // type est une déclaration sur le serveur, pas une garantie sur ce qui
  // arrive : un mandataire qui rend une page d'erreur, une réponse tronquée, et
  // `.filter` lève. Ce bandeau vit sur l'écran le plus ouvert du produit — le
  // faire tomber pour une réponse malformée coûterait la journée entière au
  // salon, là où se taire ne coûte qu'un bandeau.
  if (!Array.isArray(reprises) || reprises.length === 0) return null;

  const ouvertes = reprises.filter(
    (reprise) => etatDeLaReprise(reprise, maintenant) === 'en-cours',
  );
  if (ouvertes.length === 0) return null;

  return ouvertes.reduce((plusRecente, reprise) =>
    new Date(reprise.started_at).getTime() > new Date(plusRecente.started_at).getTime()
      ? reprise
      : plusRecente,
  );
}
