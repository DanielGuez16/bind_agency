/**
 * Traduction des codes d'erreur de l'API en messages affichables.
 *
 * Un code inconnu — backend en avance sur l'app, code oublié au catalogue —
 * donne le message générique. Jamais le code brut à l'écran : `not_a_member`
 * n'a aucun sens pour la personne qui le lit.
 */
import { en } from './en';

const CODES_CONNUS = new Set(Object.keys(en.errors));

/** Extrait le code d'une réponse d'erreur de l'API, quelle qu'en soit la forme. */
export function errorCodeFromResponse(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === 'string' ? detail : null;
}

/**
 * Les champs que le serveur nomme dans un refus de validation.
 *
 * **Une table explicite, et un repli sur le silence.** Le serveur rend le nom
 * technique du champ — `email`, `fichier`, `starts_at` —, qui est le sien et pas
 * celui de l'écran. `fichier` dans une phrase anglaise ne se lit pas, et
 * `starts_at` encore moins.
 *
 * On ne nomme donc le champ que lorsqu'on sait le nommer. Un champ absent de
 * cette table retombe sur la phrase générique, qui est exactement ce que l'écran
 * disait déjà — le message ne devient jamais pire qu'avant, il devient parfois
 * meilleur.
 *
 * Les clés sont écrites en toutes lettres pour que la garde des traductions les
 * voie : une clé composée à l'exécution, elle ne la résout pas.
 */
const CHAMPS_NOMMES: Record<string, string> = {
  email: 'champs.email',
  password: 'champs.password',
  fichier: 'champs.fichier',
  name: 'champs.name',
  address: 'champs.address',
  phone: 'champs.phone',
  price_cents: 'champs.price_cents',
  duration_minutes: 'champs.duration_minutes',
  reason: 'champs.reason',
  motif: 'champs.reason',
  starts_at: 'champs.starts_at',
};

/**
 * Les champs en cause d'un refus, tels que le serveur les nomme.
 *
 * La forme est celle de FastAPI : `fields: [{ loc: ['body', 'email'] }]`. On
 * garde le **dernier** segment — `body` dit d'où vient le champ, pas lequel il
 * est — et on écarte les doublons, un même champ pouvant être refusé deux fois.
 */
/**
 * Les codes de refus portés par les champs d'un 422.
 *
 * **Le serveur nomme enfin ce qu'il refuse.** Il rendait `loc` et `type` seuls,
 * donc l'écran ne pouvait que nommer le champ : « Check this: password ».
 * Six messages écrits dans les deux langues — « Use at least 12 characters »
 * et ses voisins — n'étaient lus par personne, et la garde des traductions ne
 * pouvait pas le dire : elle ne cherche pas les clés devenues orphelines.
 *
 * Rendus dans l'ordre reçu et dédoublonnés, comme les champs. On ne prend que
 * ce que le catalogue sait traduire : un code inconnu vaut mieux tu que rendu
 * brut, et c'est déjà la règle d'`errorMessageKey`.
 */
export function codesEnCause(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const fields = (body as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];

  const codes: string[] = [];
  for (const champ of fields) {
    const code = (champ as { code?: unknown })?.code;
    if (typeof code === 'string' && code.length > 0 && !codes.includes(code)) {
      codes.push(code);
    }
  }
  return codes;
}

export function champsEnCause(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) return [];
  const fields = (body as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];

  const noms: string[] = [];
  for (const champ of fields) {
    const loc = (champ as { loc?: unknown })?.loc;
    if (!Array.isArray(loc) || loc.length === 0) continue;
    const dernier = loc[loc.length - 1];
    if (typeof dernier === 'string' && dernier !== 'body' && !noms.includes(dernier)) {
      noms.push(dernier);
    }
  }
  return noms;
}

/**
 * La phrase d'un refus, en nommant le champ quand c'est possible.
 *
 * **Sans le champ, la phrase ne dit pas quoi corriger.** Le serveur répond
 * `validation_failed` avec `loc: [body, email]` ; l'écran affichait « Some
 * information is missing or incorrect » et laissait chercher. C'est le seul
 * refus du produit dont la cause est connue et n'était pas dite.
 */
export function messageDeRefus(
  t: (key: string, valeurs?: Record<string, unknown>) => string,
  code: string | null | undefined,
  champs: string[],
  /**
   * Les codes que le serveur a portés sur les champs, s'il en a porté.
   *
   * Facultatif : les appelants qui ne les ont pas gardent le comportement
   * d'avant, qui nomme le champ. C'est ce qui permet d'ajouter le transport du
   * code sans réécrire tous les sites d'appel du même coup.
   */
  codes: string[] = [],
): string {
  // **Ce que le serveur refuse, avant le champ où il le refuse.** « Use at
  // least 12 characters » dit quoi corriger ; « Check this: password » dit
  // seulement où regarder. Le premier code connu l'emporte : un refus en porte
  // rarement deux, et les empiler ferait une phrase que personne ne lit.
  const explicite = codes.find((c) => CODES_CONNUS.has(c) && c !== 'generic');
  if (explicite) return t(`errors.${explicite}`);

  const nommables = champs.map((c) => CHAMPS_NOMMES[c]).filter((cle): cle is string => !!cle);
  if (code !== 'validation_failed' || nommables.length === 0) {
    return t(errorMessageKey(code));
  }
  return t('errors.validation_failed_champs', {
    champs: nommables.map((cle) => t(cle)).join(', '),
  });
}

export function errorMessageKey(code: string | null | undefined): string {
  return code && CODES_CONNUS.has(code) && code !== 'generic' ? `errors.${code}` : 'errors.generic';
}

export function translateErrorCode(
  t: (key: string) => string,
  code: string | null | undefined,
): string {
  return t(errorMessageKey(code));
}
