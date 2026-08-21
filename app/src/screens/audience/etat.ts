/**
 * L'état d'un compte rattaché, en un mot.
 *
 * **Trois mots, aucun en rouge.** Une autorisation qui expire est un fait de la
 * plateforme, pas un manquement de la créatrice : c'est la même règle que
 * l'avertissement sans teinte du système. « PAUSED » plutôt qu'« EXPIRED »
 * parce que c'est Instagram qui redemande, et que la nuance n'est pas de
 * politesse — elle dit à qui revient le geste.
 *
 * **L'ordre compte, et un test le tient.** Un compte dont l'autorisation est
 * tombée n'a par construction plus de relevé récent : demander « lit-on ? »
 * avant « l'autorisation tient-elle ? » afficherait « READING » sur un compte
 * que personne ne lit plus, ce qui est la seule des trois réponses qui soit un
 * mensonge.
 */
import type { AudienceDuCompte } from '../../api';

export type EtatDuCompte = 'suspendu' | 'premiere-lecture' | 'a-jour';

export function etatDuCompte(
  compte: Pick<AudienceDuCompte, 'status' | 'captured_at'>,
): EtatDuCompte {
  // Tout ce qui n'est pas actif se dit de la même façon : révoqué, désactivé ou
  // expiré, le compte ne se lit plus et le geste est le même. Trois mots pour
  // trois causes qui appellent la même action feraient chercher la différence.
  if (compte.status !== 'active') return 'suspendu';
  if (compte.captured_at === null) return 'premiere-lecture';
  return 'a-jour';
}

/**
 * Depuis quand l'autorisation est tombée — et rien quand elle ne l'est pas.
 *
 * **La carte disait « finie » sans dire quand.** « Expirée il y a trois jours »
 * et « expirée en mars » n'appellent pas la même réaction : la première se
 * répare d'un geste, la seconde explique pourquoi plus rien ne s'ouvre depuis
 * des mois.
 *
 * **Une date à venir ne se rend pas ici.** Un compte peut être révoqué avant
 * l'échéance de son jeton : la date existe alors et elle est dans le futur.
 * Écrire « expire le 3 octobre » sous « il faut réautoriser » dirait le
 * contraire du bloc qui la porte. Le serveur le dit aussi à sa façon — une
 * date absente veut dire « on ne sait pas », jamais « c'est bon », et c'est
 * `status` qui tranche.
 */
export function tombeeLe(
  tokenExpiresAt: string | null | undefined,
  maintenant: Date = new Date(),
): string | null {
  if (!tokenExpiresAt) return null;
  const quand = new Date(tokenExpiresAt);
  if (Number.isNaN(quand.getTime())) return null;
  return quand.getTime() <= maintenant.getTime() ? tokenExpiresAt : null;
}
