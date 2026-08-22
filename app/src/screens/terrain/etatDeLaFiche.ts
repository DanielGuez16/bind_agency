/**
 * Où en est une fiche préparée, et ce que cet état appelle comme conduite.
 *
 * **La colonne d'état existe pour décider d'un geste**, pas pour décrire. Ce qui
 * la rend utile est qu'elle sépare des situations qui appellent des conduites
 * opposées : un lien jamais vu se **revisite**, un lien vu puis abandonné se
 * **relance**.
 *
 * **Et c'est précisément ce que le serveur ne permet pas encore de faire.**
 * `GET /handover/{jeton}` rend l'aperçu sans rien écrire : rien n'enregistre
 * qu'un lien a été ouvert. Un lien jamais vu et un lien vu puis abandonné
 * rendent la même ligne. L'état `remis` couvre donc les deux, et il ne prétend
 * pas les distinguer — un écran qui écrirait « jamais ouvert » sur cette base
 * enverrait quelqu'un refaire une visite là où un message aurait suffi.
 * `opened_at` est demandé ; voir `TASKS.md`.
 */
import type { FichePreparee } from '../../api';

export type EtatDeLaFiche =
  /** Préparée, pas encore remise. La visite reste à faire. */
  | 'brouillon'
  /** Remise et reprise : le salon existe pour les créatrices. */
  | 'activee'
  /** Remise, retirée avant d'être reprise. */
  | 'revoquee'
  /** Remise, jamais reprise, et le lien ne vaut plus. */
  | 'expiree'
  /** Remise, le lien vaut encore, personne ne l'a reprise. */
  | 'remis';

export function etatDeLaFiche(
  fiche: Pick<FichePreparee, 'issued_at' | 'used_at' | 'revoked_at' | 'expires_at'>,
  maintenant: Date = new Date(),
): EtatDeLaFiche {
  // **L'ordre décide, et il va du plus définitif au plus ouvert.** Une fiche
  // reprise puis dont le lien expire reste reprise : l'expiration d'un lien
  // déjà consommé ne dit rien. Poser l'expiration avant la reprise afficherait
  // « expirée » sur un salon qui travaille depuis un mois.
  if (fiche.used_at) return 'activee';
  if (fiche.revoked_at) return 'revoquee';
  if (!fiche.issued_at) return 'brouillon';

  if (fiche.expires_at) {
    const fin = new Date(fiche.expires_at).getTime();
    if (!Number.isNaN(fin) && fin <= maintenant.getTime()) return 'expiree';
  }
  return 'remis';
}
