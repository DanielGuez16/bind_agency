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

/**
 * Une heure seule, à la minute, dans le fuseau du commerce.
 *
 * Le planning du comptoir n'a pas besoin de la date : toute la colonne est du
 * même jour, et la répéter à chaque ligne noierait l'heure qu'on cherche.
 *
 * **L'horloge suit la langue**, comme partout ailleurs. La journée du comptoir
 * la forçait sur vingt-quatre heures, à côté d'une échéance de publication qui
 * passait par `formatDateTime` et s'écrivait donc en AM/PM : deux horloges sur
 * le même écran, à Miami, où l'on compte en douze.
 */
export function formatHeure(
  isoUtc: string,
  locale: SupportedLocale,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(
    new Date(isoUtc),
  );
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

/**
 * Le mois d'un instant, dans le fuseau du commerce. « AUGUST 2026 ».
 *
 * **Le fuseau, et pas celui du téléphone.** Une réservation du 1er août à
 * 02 h UTC est le 31 juillet à Miami : l'intertitre la rangerait dans le mois
 * suivant, sous les yeux de quelqu'un qui sait très bien quand il y est allé.
 *
 * L'année accompagne le mois. Sans elle, « JANUARY » confond deux janviers
 * consécutifs, et l'historique d'une créatrice fidèle en compte deux avant sa
 * deuxième année.
 */
export function formatMois(isoUtc: string, locale: SupportedLocale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(isoUtc));
}

/**
 * Le repère d'un créneau : aujourd'hui, demain, un jour nommé, ou sa date.
 *
 * **« 08/08/2026, 14:30 » demandait de calculer.** C'est la remarque de la
 * revue, et elle vise le seul endroit du produit où la date arrive avant la
 * décision : « est-ce loin ? » se répond en soustrayant deux dates de tête,
 * pendant qu'on essaie de choisir une prestation.
 *
 * **La fenêtre nommée s'arrête à sept jours.** Au-delà, « mardi » est ambigu —
 * lequel — et la date complète redevient le repère le plus court. En deçà, elle
 * est toujours plus longue à lire que le mot.
 *
 * **Le jour se calcule dans le fuseau du salon, jamais dans celui du
 * téléphone.** Un créneau de 23 h à Miami est encore « aujourd'hui » pour qui
 * réserve depuis Madrid, où il est déjà 5 h du matin le lendemain : le repère
 * décrit le moment où l'on se présente au comptoir. Comparer deux instants
 * suffirait à trouver l'écart en heures, jamais à trouver le jour.
 *
 * Rend la forme et ses morceaux, pas une phrase : c'est l'écran qui choisit sa
 * clé de traduction, l'ordre des mots n'étant pas le même d'une langue à
 * l'autre.
 */
export function repereDuCreneau(
  isoUtc: string,
  locale: SupportedLocale,
  timeZone: string,
  maintenant: Date = new Date(),
): { quand: 'aujourdhui' | 'demain' | 'jour' | 'date'; libelle: string; heure: string } {
  const heure = formatHeure(isoUtc, locale, timeZone);

  // La date **civile** dans le fuseau du salon, en morceaux : `en-CA` rend
  // « 2026-08-08 », qui se compare comme une chaîne et se soustrait comme une
  // date sans traîner d'heure derrière elle.
  const jourCivil = (quand: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(quand);

  const duCreneau = jourCivil(new Date(isoUtc));
  const duJour = jourCivil(maintenant);

  const enJours = (iso: string) => {
    const [a, m, j] = iso.split('-').map(Number);
    return Date.UTC(a, m - 1, j) / 86_400_000;
  };
  const ecart = enJours(duCreneau) - enJours(duJour);

  if (ecart === 0) return { quand: 'aujourdhui', libelle: '', heure };
  if (ecart === 1) return { quand: 'demain', libelle: '', heure };
  if (ecart > 1 && ecart < 7) {
    return {
      quand: 'jour',
      libelle: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone }).format(
        new Date(isoUtc),
      ),
      heure,
    };
  }
  // Au-delà d'une semaine, et **aussi en arrière** : un créneau qui serait dans
  // le passé n'a pas de repère humain, et lui en donner un — « lundi » — le
  // ferait passer pour à venir. La date brute est alors la réponse honnête.
  return { quand: 'date', libelle: formatDate(isoUtc, locale, timeZone), heure };
}
