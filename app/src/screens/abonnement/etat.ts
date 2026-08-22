/**
 * Où en est l'abonnement d'un commerce, et ce que cet état lui laisse faire.
 *
 * **C'est la contrepartie de ce qu'on facture.** L'annuaire refuse sur un 402,
 * l'API sait ouvrir un paiement, et rien dans l'application n'y menait : trois
 * méthodes sans appelant. Un commerce qui butait sur le mur n'avait aucun chemin
 * vers l'autre côté.
 *
 * **Le vocabulaire est celui de la conduite, pas celui de Stripe.** « incomplete »
 * ne dit rien à un gérant ; « le paiement n'est pas terminé » dit quoi faire.
 */
import type { Abonnement } from '../../api';

export type EtatDeLAbonnement =
  /** Aucun abonnement : il reste à choisir un plan. */
  | 'aucun'
  /** Souscrit, paiement non terminé — il y a une adresse à rouvrir. */
  | 'paiement-a-finir'
  /** En cours, l'annuaire est ouvert. */
  | 'actif'
  /** Un prélèvement a échoué : l'accès tient encore, mais pas longtemps. */
  | 'impaye'
  /** Résilié. Reprendre est possible, et c'est un nouveau choix de plan. */
  | 'resilie';

export function etatDeLAbonnement(abonnement: Abonnement | null | undefined): EtatDeLAbonnement {
  // Falsy plutôt que `=== null` : « pas d'abonnement » est une réponse valide du
  // serveur, et un décor qui ne pose pas le champ dit la même chose.
  if (!abonnement) return 'aucun';

  switch (abonnement.status) {
    case 'active':
    case 'trialing':
      return 'actif';
    case 'past_due':
      return 'impaye';
    case 'canceled':
      return 'resilie';
    case 'incomplete':
      return 'paiement-a-finir';
    default:
      // **Un statut inconnu ne se devine pas.** Stripe en ajoute ; le traiter
      // comme actif ouvrirait l'annuaire à qui ne paie pas, et le traiter comme
      // résilié fermerait la porte à qui paie. « Le paiement n'est pas
      // terminé » est le seul repli qui ne ment dans aucun des deux sens : il
      // n'affirme aucun accès et propose de rouvrir l'adresse.
      return 'paiement-a-finir';
  }
}

/**
 * L'adresse de paiement, quand il y en a une à rouvrir.
 *
 * Nulle sur un abonnement en cours : rouvrir une page de paiement à qui paie
 * déjà ferait craindre un second prélèvement.
 */
export function adresseDePaiement(abonnement: Abonnement | null | undefined): string | null {
  if (!abonnement?.checkout_url) return null;
  return etatDeLAbonnement(abonnement) === 'paiement-a-finir' ? abonnement.checkout_url : null;
}
