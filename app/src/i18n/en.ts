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
    business_already_active: 'This business is already active.',
    business_missing_address: 'Add the business address before going live.',
    business_missing_coordinates: 'Add the business location before going live.',
    catalog_duration_mismatch: 'A bookable item needs a duration, and an item that is not bookable must not have one.',
    catalog_item_not_found: 'This item is not in your catalogue.',
    catalog_item_has_bookings: 'This item has bookings and cannot be deleted. Turn it off instead.',
    catalog_item_locked_by_bookings: 'This item already has bookings, so its type and duration can no longer change. Create a new item instead.',
    catalog_parent_not_found: 'The parent item does not exist in your catalogue.',
    catalog_parent_must_not_be_bookable: 'An item with variants cannot be booked itself. Customers book the variant.',
    catalog_variant_depth_exceeded: 'A variant cannot have variants of its own.',
    capacity_rule_not_found: 'This opening-hours rule no longer exists.',
    capacity_rule_overlap: 'These hours overlap another range on the same day.',
    capacity_exception_not_found: 'This exception no longer exists.',
    capacity_exception_duplicate_date: 'There is already an exception for that date.',
    tier_not_found: 'This tier no longer exists.',
    tier_already_exists: 'A tier already exists for that platform and format.',
    tier_in_use: 'This tier is used by existing offers or collaborations. Turn it off instead of deleting it.',
    tier_offer_not_found: 'This offer no longer exists.',
    tier_offer_already_exists: 'This item is already offered at that tier.',
    tier_offer_parent_not_allowed: 'An item with variants cannot be offered. Offer the variant instead.',
    tier_offer_tier_inactive: 'This tier is not open right now.',
    tier_offer_has_bookings: 'This offer has bookings and cannot be removed. Turn it off instead.',
    creator_profile_not_found: 'We could not find your creator profile.',
    creator_profile_anonymized: 'This profile has been anonymized and can no longer be edited.',
    oauth_state_invalid: 'This connection link is no longer valid. Start again from your account.',
    social_account_taken: 'This social account is already linked to another BIND account.',
    social_provider_unavailable: 'We could not reach the social network. Please try again.',
    social_account_not_found: 'We could not find this social account on your profile.',
    social_account_not_active: 'This social account needs to be reconnected before we can refresh it.',
    social_token_expired: 'Instagram no longer accepts our access to this account. Reconnect it to keep collaborating.',
    metrics_refresh_too_soon: 'Your stats were refreshed recently. Try again a bit later.',
    verification_transition_not_allowed: 'This account is already in that state.',
    job_not_found: 'We could not find this scheduled task.',
    job_not_exhausted: 'This task has not stopped, there is nothing to restart.',
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
