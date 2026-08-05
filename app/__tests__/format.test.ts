/**
 * La locale décide du format, le commerce décide de la devise.
 * Déduire la devise de la langue afficherait des euros à Miami.
 */
import { formatDate, formatMoney, formatNumber } from '../src/format';

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
