/**
 * Un refus de validation nomme le champ en cause.
 *
 * **Le serveur le nommait, et personne ne le lisait.** Il répond
 * `{"detail":"validation_failed","fields":[{"loc":["body","email"]}]}` ; l'écran
 * affichait « Some information is missing or incorrect » et laissait chercher
 * lequel. C'est le seul refus du produit dont la cause est connue et n'était pas
 * dite.
 */
import { champsEnCause, codesEnCause, messageDeRefus } from '../src/i18n/errors';
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

/**
 * Ce que le serveur refuse, et non seulement où il le refuse.
 *
 * **Six messages étaient morts.** `passwords.py` lève `password_too_short` ;
 * le schéma le reconvertit ; le handler 422 gardait `loc` et `type` et jetait
 * `msg`, qui portait le code. L'écran affichait donc « Check this: password »
 * pendant que « Use at least 12 characters » attendait dans les deux
 * catalogues. Aucune garde ne pouvait le voir : celle des traductions ne
 * cherche pas les clés que plus personne n'appelle, et elle le dit d'elle-même.
 */
describe('le code du refus', () => {
  it('remonte des champs du 422', () => {
    expect(
      codesEnCause({
        detail: 'validation_failed',
        fields: [{ loc: ['body', 'password'], type: 'value_error', code: 'password_too_short' }],
      }),
    ).toEqual(['password_too_short']);
  });

  it("ignore un champ qui n'en porte pas, et déduplique", () => {
    // Le pendant : une implémentation qui inventerait un code, ou qui les
    // empilerait, ne rendrait pas ce tableau-là.
    expect(
      codesEnCause({
        fields: [
          { loc: ['body', 'email'], type: 'missing' },
          { loc: ['body', 'password'], type: 'value_error', code: 'password_too_short' },
          { loc: ['body', 'confirmation'], type: 'value_error', code: 'password_too_short' },
        ],
      }),
    ).toEqual(['password_too_short']);
    expect(codesEnCause({ fields: [] })).toEqual([]);
    expect(codesEnCause(null)).toEqual([]);
  });

  it('dit quoi corriger, et non seulement où regarder', () => {
    const avec = messageDeRefus(t, 'validation_failed', ['password'], ['password_too_short']);

    expect(avec).toBe(en.errors.password_too_short);
    // **Le cas qui fait diverger les deux implémentations.** Sans le code, la
    // phrase nomme le champ — c'est ce que le produit faisait, et ce n'est pas
    // faux, seulement moins utile. Les deux doivent différer, sinon ce test
    // passerait aussi bien sur la version qu'on vient de remplacer.
    const sans = messageDeRefus(t, 'validation_failed', ['password'], []);
    expect(sans).not.toBe(avec);
    expect(sans).toContain('password');
  });

  it("retombe sur le champ quand le code n'est pas au catalogue", () => {
    // Un code que le serveur inventerait ne doit pas s'afficher brut : c'est
    // déjà la règle d'`errorMessageKey`, et elle vaut ici aussi.
    expect(messageDeRefus(t, 'validation_failed', ['email'], ['code_invente'])).toBe(
      messageDeRefus(t, 'validation_failed', ['email'], []),
    );
  });
});
