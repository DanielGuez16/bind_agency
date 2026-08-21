/**
 * Ce que la journée du commerce annonce d'elle-même, avant de lister.
 *
 * **« On ne comprend même pas à quoi sert cette page » est la remarque la plus
 * grave de la revue**, et la seule qui ne se corrige pas en déplaçant des
 * blocs. L'écran s'appelait « Aujourd'hui » et listait des réservations par
 * heure : un inventaire. Il ne disait pas qu'on y décide.
 *
 * Le titre compte donc ce qui attend une réponse. Le jour, qui était tout ce
 * que la barre disait, descend en sous-ligne : il situe, il ne convoque pas.
 */
import { jourCivil } from '../../format';
import type { SupportedLocale } from '../../i18n';

/**
 * Le jour, en toutes lettres et dans l'ordre de la langue.
 *
 * **Midi et non minuit.** Une date nue rendue à minuit bascule d'un jour selon
 * le fuseau de la machine ; à midi, aucun décalage réel ne la fait changer de
 * quantième. La même précaution que `nomDeJour`, pour la même raison.
 */
export function jourEnToutesLettres(jourNu: string, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${jourNu.slice(0, 10)}T12:00:00Z`));
}

/**
 * La demande dont la limite tombe aujourd'hui, et qui porte donc le contour.
 *
 * **Le contour dit « répondez aujourd'hui », pas « c'est urgent ».** La limite
 * est double côté serveur — vingt-quatre heures, ou l'heure du créneau si elle
 * arrive avant — et l'écran n'écrit jamais la règle, seulement l'heure. Ce que
 * le contour ajoute est le seul fait qui change la conduite de la journée :
 * cette réponse-là ne peut pas attendre demain.
 *
 * **Une limite déjà passée ne le porte pas.** Il n'y a plus rien à faire
 * aujourd'hui qui n'aurait pas dû être fait hier ; le bandeau de dépassement
 * dit alors ce qu'il en est, et un contour d'appel par-dessus ferait espérer
 * une action qui n'existe plus.
 *
 * **Le jour est celui du salon.** Une limite à 23 h à Miami tombe le lendemain
 * en temps universel : lue sur le fuseau de la machine, elle cesserait d'être
 * « aujourd'hui » pour la personne qui est au comptoir.
 */
export function limiteTombeAujourdhui(
  echeance: string | null,
  timezone: string,
  maintenant: Date = new Date(),
): boolean {
  if (!echeance) return false;
  const limite = new Date(echeance);
  if (Number.isNaN(limite.getTime())) return false;
  if (limite.getTime() <= maintenant.getTime()) return false;
  return jourCivil(limite, timezone) === jourCivil(maintenant, timezone);
}
