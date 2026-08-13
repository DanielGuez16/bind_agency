/**
 * Le jeton de prise en main lu dans l'adresse d'ouverture.
 *
 * **Pourquoi ce fichier existe.** Le lien remis au salon doit atterrir quelque
 * part, et l'application n'a qu'une adresse : `?handover=<jeton>` est ce qui
 * transforme cette adresse unique en une entrée particulière, sans inventer un
 * routeur web dont rien d'autre n'a besoin.
 *
 * **Lu une fois, à l'ouverture.** Un jeton relu à chaque rendu ferait revenir
 * l'écran de prise en main par-dessus l'application du gérant qui vient de s'y
 * connecter.
 *
 * **Il n'existe que sur le web.** Sur un téléphone, le lien ouvre le navigateur,
 * et c'est le bon comportement : le gérant n'a pas l'application, il n'a qu'un
 * message. Lui demander d'installer quelque chose avant de pouvoir dire oui
 * remettrait au comptoir la friction qu'on vient d'en retirer.
 */

const PARAMETRE = 'handover';

/**
 * Le jeton présent dans l'adresse, ou `null`.
 *
 * Rend `null` hors du web, et hors d'une page qui en porte un. Aucune erreur :
 * l'absence est le cas normal — c'est ainsi que s'ouvre l'application tous les
 * autres jours.
 */
export function jetonDePriseEnMain(): string | null {
  if (typeof window === 'undefined' || !window.location?.search) return null;

  const jeton = new URLSearchParams(window.location.search).get(PARAMETRE);
  return jeton && jeton.trim().length > 0 ? jeton : null;
}

/**
 * Retire le paramètre de la barre d'adresse, sans recharger.
 *
 * **Un jeton consommé ne doit pas rester dans l'historique.** Il ne vaut plus
 * rien — il est à usage unique — mais il traînerait dans les suggestions du
 * navigateur d'un gérant, et un rafraîchissement le renverrait sur l'écran
 * « ce lien n'est plus valide » alors qu'il vient précisément de s'en servir.
 */
export function oublierLeJeton(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;

  const adresse = new URL(window.location.href);
  adresse.searchParams.delete(PARAMETRE);
  window.history.replaceState({}, '', adresse.toString());
}
