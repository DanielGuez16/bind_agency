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

export function errorMessageKey(code: string | null | undefined): string {
  return code && CODES_CONNUS.has(code) && code !== 'generic' ? `errors.${code}` : 'errors.generic';
}

export function translateErrorCode(
  t: (key: string) => string,
  code: string | null | undefined,
): string {
  return t(errorMessageKey(code));
}
