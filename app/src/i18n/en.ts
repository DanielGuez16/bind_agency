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
  tiers: {
    title: 'Your tiers',
    newCreatorBadge: 'New creator',
    newCreatorHelp: 'You have no track record yet, so your tiers are based on your audience alone.',
    unlocked: 'Unlocked',
    locked: 'Locked',
    minFollowers: '{{count}} followers',
    valueHint: 'Up to {{ratio}}x the value of your audience',
    empty: 'No tier is available right now.',
    missingFollowers: '{{count}} more followers to go',
  },
  redemption: {
    title: 'Redeem a booking',
    manualLabel: 'Enter the code',
    manualHint: 'Six characters, shown on the creator’s screen.',
    manualSubmit: 'Check code',
    scanTab: 'Scan',
    manualTab: 'Type it',
    scanHint: 'Point the camera at the creator’s screen.',
    cameraDenied: 'Camera access is off. Type the code instead.',
    cameraUnavailable: 'No camera on this device. Type the code instead.',
    verifying: 'Checking…',
    serve: 'Mark as served',
    served: 'Served',
    usedManualCode: 'Checked by typed code',
    creator: 'Creator',
    validUntil: 'Valid until',
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
    catalog_duration_mismatch:
      'A bookable item needs a duration, and an item that is not bookable must not have one.',
    catalog_item_not_bookable:
      'This item does not use time slots. It is valid for a period instead.',
    catalog_item_not_found: 'This item is not in your catalogue.',
    catalog_item_has_bookings: 'This item has bookings and cannot be deleted. Turn it off instead.',
    catalog_item_locked_by_bookings:
      'This item already has bookings, so its type and duration can no longer change. Create a new item instead.',
    catalog_parent_not_found: 'The parent item does not exist in your catalogue.',
    catalog_parent_must_not_be_bookable:
      'An item with variants cannot be booked itself. Customers book the variant.',
    catalog_variant_depth_exceeded: 'A variant cannot have variants of its own.',
    capacity_rule_not_found: 'This opening-hours rule no longer exists.',
    capacity_rule_overlap: 'These hours overlap another range on the same day.',
    capacity_exception_not_found: 'This exception no longer exists.',
    capacity_exception_duplicate_date: 'There is already an exception for that date.',
    tier_not_found: 'This tier no longer exists.',
    tier_already_exists: 'A tier already exists for that platform and format.',
    tier_in_use:
      'This tier is used by existing offers or collaborations. Turn it off instead of deleting it.',
    tier_offer_not_found: 'This offer no longer exists.',
    tier_offer_already_exists: 'This item is already offered at that tier.',
    tier_offer_parent_not_allowed:
      'An item with variants cannot be offered. Offer the variant instead.',
    tier_offer_tier_inactive: 'This tier is not open right now.',
    tier_offer_has_bookings: 'This offer has bookings and cannot be removed. Turn it off instead.',
    creator_profile_not_found: 'We could not find your creator profile.',
    creator_profile_anonymized: 'This profile has been anonymized and can no longer be edited.',
    no_social_account: 'Connect an Instagram account to unlock your tiers.',
    not_enough_followers: 'You need a larger audience for this tier.',
    not_enough_completed_collabs: 'Complete a few more collaborations to reach this tier.',
    reliability_score_too_low: 'Your reliability score is below what this tier requires.',
    no_metrics: 'We have not measured this account yet. Check back shortly.',
    metrics_stale: 'These numbers are too old to use. Reconnect the account to refresh them.',
    account_token_invalid: 'Reconnect this account, our access to it has expired.',
    account_under_review: 'This account is being reviewed. Nothing to do on your side.',
    account_rejected: 'This account cannot be used on BIND. Contact us if you disagree.',
    oauth_state_invalid: 'This connection link is no longer valid. Start again from your account.',
    social_account_taken: 'This social account is already linked to another BIND account.',
    social_provider_unavailable: 'We could not reach the social network. Please try again.',
    social_account_not_found: 'We could not find this social account on your profile.',
    social_account_not_active:
      'This social account needs to be reconnected before we can refresh it.',
    social_token_expired:
      'Instagram no longer accepts our access to this account. Reconnect it to keep collaborating.',
    metrics_refresh_too_soon: 'Your stats were refreshed recently. Try again a bit later.',
    verification_transition_not_allowed: 'This account is already in that state.',
    job_not_found: 'We could not find this scheduled task.',
    job_not_exhausted: 'This task has not stopped, there is nothing to restart.',
    booking_offer_not_bookable: 'This offer is no longer available.',
    booking_tier_not_accessible: 'This account does not unlock this tier yet.',
    booking_name_required: 'Add your first and last name before booking.',
    booking_slot_required: 'Pick a time slot for this item.',
    booking_slot_not_allowed: 'This item has no time slots. It is valid for a period.',
    booking_slot_unavailable: 'That slot was just taken. Pick another one.',
    booking_not_found: 'We could not find this booking.',
    booking_transition_not_allowed: 'This booking cannot move to that state.',
    booking_hold_expired: 'Your hold expired and the slot was released. Book again.',
    booking_no_show_not_applicable: 'This booking has no time slot, so there is no no-show.',
    redemption_code_unknown: 'This code is not valid. Ask the creator to refresh it.',
    redemption_too_many_attempts:
      'Too many failed attempts on this code. Ask the creator for a new booking.',
    redemption_code_already_consumed: 'This code has already been used.',
    redemption_booking_not_redeemable: 'This booking cannot be redeemed right now.',
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
