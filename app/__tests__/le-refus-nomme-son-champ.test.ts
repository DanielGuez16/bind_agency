/**
 * Un refus de validation nomme le champ en cause.
 *
 * **Le serveur le nommait, et personne ne le lisait.** Il répond
 * `{"detail":"validation_failed","fields":[{"loc":["body","email"]}]}` ; l'écran
 * affichait « Some information is missing or incorrect » et laissait chercher
 * lequel. C'est le seul refus du produit dont la cause est connue et n'était pas
 * dite.
 */
import { champsEnCause, messageDeRefus } from '../src/i18n/errors';
import { en } from '../src/i18n/en';

/** Le traducteur réel, pour que les clés absentes se voient. */
function t(cle: string, valeurs?: Record<string, unknown>): string {
  const brut = cle
    .split('.')
    .reduce<unknown>((noeud, part) => (noeud as Record<string, unknown>)?.[part], en);
  if (typeof brut !== 'string') return cle;
  return brut.replace(/\{\{(\w+)\}\}/g, (_, nom) => String(valeurs?.[nom] ?? ''));
}

describe('les champs en cause', () => {
  it('garde le dernier segment, jamais « body »', () => {
    // `loc` dit d'où vient le champ **et** lequel il est. Garder le premier
    // segment rendrait « body » pour tout, ce qui ne nomme rien.
    expect(champsEnCause({ fields: [{ loc: ['body', 'email'] }] })).toEqual(['email']);
  });

  it('et n’en garde qu’un exemplaire, un champ pouvant être refusé deux fois', () => {
    expect(
      champsEnCause({ fields: [{ loc: ['body', 'email'] }, { loc: ['body', 'email'] }] }),
    ).toEqual(['email']);
  });

  it('sur une réponse sans champs, la liste est vide plutôt qu’absente', () => {
    expect(champsEnCause({ detail: 'validation_failed' })).toEqual([]);
    expect(champsEnCause(null)).toEqual([]);
  });
});

describe('la phrase du refus', () => {
  it('nomme le champ quand elle sait le nommer', () => {
    const phrase = messageDeRefus(t, 'validation_failed', ['email']);

    expect(phrase).toContain('email address');
    expect(phrase).not.toBe(en.errors.validation_failed);
  });

  it('et les nomme tous quand il y en a plusieurs', () => {
    const phrase = messageDeRefus(t, 'validation_failed', ['email', 'password']);

    expect(phrase).toContain('email address');
    expect(phrase).toContain('password');
  });

  it('mais se tait sur un champ qu’elle ne sait pas nommer', () => {
    // **Le cas qui fait diverger le décor.** Le serveur rend des noms
    // techniques : `photo_key` dans une phrase anglaise ne se lit pas mieux que
    // rien. Une implémentation qui recopierait le nom brut passerait un test
    // écrit sur `email` seul, et écrirait « Check this: photo_key » en
    // production.
    expect(messageDeRefus(t, 'validation_failed', ['photo_key'])).toBe(
      en.errors.validation_failed,
    );
  });

  it('et ne touche pas aux autres refus, qui ont déjà leur phrase', () => {
    // `not_a_member` dit déjà ce qu'il faut ; y coller un champ le rendrait
    // moins clair, pas plus.
    expect(messageDeRefus(t, 'not_a_member', ['email'])).toBe(en.errors.not_a_member);
  });
});
