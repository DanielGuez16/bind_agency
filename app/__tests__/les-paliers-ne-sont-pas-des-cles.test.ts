/**
 * Les paliers viennent de `tier.order`, jamais des clés de la section.
 *
 * **Le défaut, vu en production sur l'écran d'arbitrage.** `PALIERS` valait
 * `Object.keys(tierTokens)`, et la section porte autre chose que des paliers :
 * de la documentation — `$pourquoi`, `$delai` —, la liste ordonnée elle-même
 * (`order`) et les règles de dessin (`rules`). L'écran rendait donc sept
 * filtres, dont « $POURQUOI », « ORDER », « RULES » et « $DELAI ».
 *
 * La liste existait à côté depuis le début : c'est exactement ce qu'`order` est.
 */
import { PALIERS } from '../src/components';
import { tierTokens } from '../src/theme';

it('ne contient que les trois paliers, dans l’ordre du jeton', () => {
  expect(PALIERS).toEqual(['story', 'post', 'reel']);
});

it('n’expose aucune clé de documentation ni de métadonnée', () => {
  // **Le pendant, et il porte le test.** Une liste écrite à la main passerait
  // le cas d'à côté ; celui-ci part de la section réelle et exige que tout ce
  // qui n'est pas un palier en soit absent — y compris ce qu'on y ajoutera.
  const dansLaSection = Object.keys(tierTokens);
  expect(dansLaSection).toContain('$pourquoi');
  expect(dansLaSection).toContain('rules');

  for (const clef of dansLaSection) {
    const estUnPalier = PALIERS.includes(clef as (typeof PALIERS)[number]);
    const seraitDuBruit = clef.startsWith('$') || clef === 'order' || clef === 'rules';
    expect(estUnPalier).toBe(!seraitDuBruit);
  }
});

it('chaque palier porte son mot dans les deux langues', () => {
  // Ce qui rendait `palier.toUpperCase()` acceptable en anglais et faux en
  // espagnol : le libellé anglais est la clé en majuscules, l'espagnol non.
  for (const palier of PALIERS) {
    const label = tierTokens[palier].label;
    expect(typeof label.en).toBe('string');
    expect(typeof label.es).toBe('string');
  }
  expect(tierTokens.post.label.es).not.toBe('POST');
});
