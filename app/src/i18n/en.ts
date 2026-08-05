/**
 * Catalogue anglais. Langue de repli.
 *
 * Les clés `errors.*` reprennent exactement les valeurs de `ErrorCode` côté API
 * (`api/app/core/errors.py`). Un test vérifie que ce catalogue et l'espagnol
 * ont le même jeu de clés ; un test côté API refuse tout code renvoyé par une
 * route qui ne serait pas au catalogue.
 *
 * Aucun contenu saisi par un commerce n'apparaît ici : les noms et descriptions
 * d'items restent dans leur langue d'origine et ne sont jamais traduits.
 */
export const en = {
  common: {
    appName: 'BIND',
    retry: 'Check again',
    loading: 'Loading…',
    language: 'Language',
  },
  health: {
    title: 'Backend status',
    reachable: 'API reachable',
    unreachable: 'API unreachable',
    missingApiUrl: 'No API address configured',
    dependencyOk: 'available',
    dependencyDown: 'unavailable',
  },
  errors: {
    generic: 'Something went wrong. Please try again.',
    authentication_required: 'Please sign in to continue.',
    invalid_credentials: 'Incorrect email address or password.',
    account_not_active: 'This account has been closed.',
    invalid_refresh_token: 'Your session has expired. Please sign in again.',
    email_already_used: 'This email address is already registered.',
    insufficient_role: 'Your account cannot access this.',
    not_a_member: 'You do not belong to this business.',
    validation_failed: 'Some information is missing or incorrect.',
    not_found: 'We could not find what you were looking for.',
    internal_error: 'Something went wrong on our side.',
  },
} as const;

/**
 * Structure du catalogue, valeurs élargies à `string`.
 *
 * `as const` sur `en` fige chaque valeur en type littéral : sans cet
 * élargissement, l'espagnol devrait contenir les phrases anglaises mot pour
 * mot. Les clés, elles, restent contraintes — une clé manquante ou en trop dans
 * `es.ts` est une erreur de compilation.
 */
type MemeFormeMaisDuTexte<T> = {
  [K in keyof T]: T[K] extends string ? string : MemeFormeMaisDuTexte<T[K]>;
};

export type Catalogue = MemeFormeMaisDuTexte<typeof en>;
