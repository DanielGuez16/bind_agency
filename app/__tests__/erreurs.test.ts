/**
 * Un code d'erreur ne doit jamais atteindre l'écran tel quel.
 * `not_a_member` n'a aucun sens pour la personne qui le lit.
 */
import { en } from '../src/i18n/en';
import { errorCodeFromResponse, errorMessageKey, translateErrorCode } from '../src/i18n/errors';

const t = (cle: string): string =>
  cle.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en) as string;

describe('traduction des codes d’erreur', () => {
  it('rend le message correspondant à un code connu', () => {
    expect(translateErrorCode(t, 'not_a_member')).toBe(en.errors.not_a_member);
  });

  it('rend le message générique pour un code inconnu', () => {
    expect(translateErrorCode(t, 'code_invente_par_le_backend')).toBe(en.errors.generic);
  });

  it.each([null, undefined, '', 'generic'])('rend le générique pour %p', (code) => {
    expect(errorMessageKey(code as string | null)).toBe('errors.generic');
  });

  it('n’affiche jamais le code brut', () => {
    const code = 'code_invente_par_le_backend';
    expect(translateErrorCode(t, code)).not.toContain(code);
  });

  it('extrait le code d’une réponse d’API', () => {
    expect(errorCodeFromResponse({ detail: 'invalid_credentials' })).toBe('invalid_credentials');
  });

  it.each([{ detail: [{ loc: ['body'] }] }, {}, null, 'texte'])(
    'ne tire aucun code de %p',
    (corps) => {
      expect(errorCodeFromResponse(corps)).toBeNull();
    },
  );
});
