/**
 * La locale décide du format, le commerce décide de la devise.
 * Déduire la devise de la langue afficherait des euros à Miami.
 */
import { formatDistance, formatDate, formatMoney, formatNumber } from '../src/format';

describe('formatage', () => {
  it('n’a pas la même écriture selon la langue', () => {
    expect(formatNumber(1234.5, 'en')).not.toBe(formatNumber(1234.5, 'es'));
  });

  it('garde la devise du commerce quelle que soit la langue', () => {
    const enUsd = formatMoney(8000, 'USD', 'en');
    const esUsd = formatMoney(8000, 'USD', 'es');

    // Le format diffère, le montant et la devise non.
    for (const rendu of [enUsd, esUsd]) {
      expect(rendu).toMatch(/80/);
      expect(rendu).not.toMatch(/€/);
    }
  });

  it('traite les montants en centimes entiers', () => {
    expect(formatMoney(8000, 'USD', 'en')).toBe('$80.00');
    expect(formatMoney(1, 'USD', 'en')).toBe('$0.01');
  });

  it('convertit vers le fuseau du commerce et non celui de l’appareil', () => {
    // 2026-01-01T03:00:00Z est encore le 31 décembre à Miami.
    expect(formatDate('2026-01-01T03:00:00Z', 'en', 'America/New_York')).toContain('Dec');
    expect(formatDate('2026-01-01T03:00:00Z', 'en', 'UTC')).toContain('Jan');
  });
});

/**
 * Une distance, dans l'unité qu'on emploie à cette échelle.
 *
 * Deux unités et non une : « 0,3 km » demande une conversion de tête pour une
 * distance qu'on parcourt à pied, et « 1 437 m » une précision que la position
 * d'un téléphone n'a pas.
 */
describe('formatDistance', () => {
  it('donne des mètres sous le kilomètre, arrondis à la dizaine', () => {
    expect(formatDistance(320, 'en')).toBe('320 m');
    // **Arrondi, parce qu'un mètre près serait inventé.** « 317 m » a l'air
    // mesuré alors qu'il ne l'est pas.
    expect(formatDistance(317, 'en')).toBe('320 m');
    expect(formatDistance(0, 'en')).toBe('0 m');
  });

  it('passe au kilomètre avec une décimale, et pas avant', () => {
    // La bascule exacte : 999 m reste en mètres, 1 000 passe en km. Sans ce
    // couple, un seuil décalé d'une unité ne se verrait pas.
    expect(formatDistance(999, 'en')).toBe('1,000 m');
    expect(formatDistance(1000, 'en')).toBe('1.0 km');
    expect(formatDistance(1437, 'en')).toBe('1.4 km');
  });

  it('porte le séparateur décimal de la langue', () => {
    // **Le point anglais devient une virgule espagnole.** Écrit à la main, un
    // « 1.4 km » espagnol se lit comme quatorze — c'est le genre d'erreur qui
    // ne se voit qu'en espagnol, donc jamais.
    expect(formatDistance(1400, 'es')).toBe('1,4 km');
    expect(formatDistance(1400, 'en')).toBe('1.4 km');
  });
});
