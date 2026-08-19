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

/**
 * La date civile d'un instant, dans le fuseau du commerce.
 *
 * « 2026-08-19 », qui se compare comme une chaîne et se rapproche d'une clé de
 * journée sans traîner d'heure derrière elle. `en-CA` rend cette forme, et
 * c'est le seul usage d'une locale figée dans ce fichier : ce n'est pas une
 * date qu'on montre, c'est une clé qu'on compare.
 *
 * **Sur le fuseau du commerce, jamais celui du téléphone.** Un créneau de 23 h
 * à Miami tombe le lendemain en UTC : le classer sur la date brute le placerait
 * un jour trop loin, et le salon ne le verrait pas où il l'attend.
 */
export function jourCivil(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(
    typeof instant === 'string' ? new Date(instant) : instant,
  );
}

/**
 * Le nom d'un jour, depuis une date nue.
 *
 * **Lue à midi UTC, et c'est indispensable.** `new Date('2026-08-19')` est lu
 * comme minuit UTC : formaté dans un fuseau à l'ouest, le 19 devient le 18, et
 * le mercredi devient mardi. Midi met douze heures de marge de chaque côté.
 *
 * `forme` choisit ce qu'on écrit : `court` pour la bande — « TUE » — et `long`
 * pour une phrase — « Tuesday 19 ».
 */
export function nomDeJour(
  dateNue: string,
  locale: SupportedLocale,
  forme: 'court' | 'long' = 'court',
): string {
  return new Date(`${dateNue}T12:00:00Z`).toLocaleDateString(
    locale,
    forme === 'court'
      ? { weekday: 'short', timeZone: 'UTC' }
      : { weekday: 'long', day: 'numeric', timeZone: 'UTC' },
  );
}

/** Le mois d'une date nue, en toutes lettres. Même précaution de midi. */
export function moisDeLaDate(dateNue: string, locale: SupportedLocale): string {
  return new Date(`${dateNue}T12:00:00Z`).toLocaleDateString(locale, {
    month: 'long',
    timeZone: 'UTC',
  });
}

/** Le quantième d'une date nue. Aucun fuseau : c'est une lecture de chaîne. */
export function quantieme(dateNue: string): number {
  return Number(dateNue.slice(8, 10));
}
