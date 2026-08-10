/**
 * Formatage des dates, des nombres et des montants.
 *
 * La locale décide du **format** — séparateurs, ordre des composants, position
 * du symbole. La devise vient du commerce, jamais de la langue : un créateur
 * hispanophone à Miami voit des dollars, pas des euros. C'est pour ça que
 * `currency` est un paramètre obligatoire et non une valeur déduite.
 *
 * Les fuseaux : tout arrive en UTC depuis l'API, la conversion se fait à
 * l'affichage sur le fuseau du commerce, d'où `timeZone` obligatoire aussi.
 */
import type { SupportedLocale } from './i18n';

/** Montant en centimes entiers, jamais en flottant. */
export function formatMoney(
  amountCents: number,
  currency: string,
  locale: SupportedLocale,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amountCents / 100);
}

export function formatNumber(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDateTime(
  isoUtc: string,
  locale: SupportedLocale,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(isoUtc));
}

export function formatDate(isoUtc: string, locale: SupportedLocale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(
    new Date(isoUtc),
  );
}

/**
 * Une date sans heure, en toutes lettres pour le mois.
 *
 * **Sans conversion de fuseau.** `new Date('2026-08-15')` est lu comme minuit
 * UTC : affiché à Miami, le 15 devient le 14. Une date de fermeture n'est pas
 * un instant, c'est une case de calendrier — on la construit en heure locale
 * plutôt que de la faire traverser un fuseau qui n'a rien à y voir.
 */
export function formatJour(isoDate: string, locale: SupportedLocale): string {
  const [annee, mois, jour] = isoDate.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(annee, mois - 1, jour),
  );
}
