/**
 * Ce que l'API rend, du point de vue de l'app.
 *
 * Écrit à la main plutôt que généré : une génération ferait entrer trois cents
 * types dont l'app n'en lit que trente, et rendrait invisible le seul écart qui
 * compte — celui entre ce que l'écran affiche et ce que le serveur envoie. Un
 * test compare les **routes** appelées au contrat réel (`openapi.json`) ; les
 * champs, eux, se vérifient à l'usage.
 *
 * **Les montants existent dans ces types et ne s'affichent pas.** `price_cents`
 * arrive du fil et de la fiche ; aucun écran créateur ni commerce ne le rend.
 * Le supprimer du type serait mentir sur ce que le serveur envoie ; l'afficher
 * serait enfreindre la règle. Il est là, et il ne sort pas.
 */

// --------------------------------------------------------------------------
// vocabulaire partagé
// --------------------------------------------------------------------------

export type Platform = 'instagram' | 'tiktok' | 'snapchat';
export type ContentFormat = 'story' | 'post' | 'reel';
export type BusinessCategory =
  | 'beauty'
  | 'restaurant'
  | 'museum'
  | 'fitness'
  | 'family_activity'
  | 'other';

export type BookingStatus =
  | 'held'
  /** La créatrice a confirmé, le salon n'a pas encore tranché. */
  | 'awaiting_business'
  | 'confirmed'
  | 'consumed'
  | 'cancelled'
  | 'no_show'
  | 'expired';

export type CollaborationStatus =
  | 'pending'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'resubmit_requested'
  | 'unfulfilled';

export type VerificationStatus = 'verified' | 'needs_review' | 'rejected';
export type SocialAccountStatus = 'active' | 'expired' | 'revoked' | 'disabled';

/**
 * Les codes d'obstacle du serveur, consommés tels quels.
 *
 * Aucune table de correspondance côté client : les codes du serveur font foi.
 * Un code inconnu s'affiche en « détail indisponible », jamais en texte
 * improvisé.
 */
export type RaisonRefus =
  | 'not_enough_followers'
  | 'not_enough_completed_collabs'
  | 'reliability_score_too_low'
  | 'no_metrics'
  | 'metrics_stale'
  | 'account_token_invalid'
  | 'account_under_review'
  | 'account_rejected'
  | 'no_social_account';

export type Obstacle = {
  raison: RaisonRefus;
  requis: string | number | null;
  constate: string | number | null;
  ecart: string | number | null;
  /**
   * La date qui explique l'obstacle, quand il en a une. Un écart en secondes
   * ne s'affiche pas — « il vous manque 431 200 secondes » ne veut rien dire.
   */
  depuis: string | null;
};

// --------------------------------------------------------------------------
// créateur
// --------------------------------------------------------------------------

export type PalierAccessible = {
  tier_id: string;
  platform: Platform;
  content_format: ContentFormat;
  min_followers: number;
  min_completed_collabs: number;
  min_reliability_score: string | null;
  value_ratio_hint: string | null;
  display_order: number;
  accessible: boolean;
  social_account_id: string | null;
  obstacles: Obstacle[];
  /** Ce que le palier ouvre, tous commerces confondus. Zéro est une réponse. */
  offres_disponibles: number;
};

export type VueDesPaliers = {
  creator_id: string;
  is_new_creator: boolean;
  paliers: PalierAccessible[];
};

/** Ce que rend l'ouverture d'une autorisation : où envoyer la personne. */
export type AutorisationDemarree = { authorization_url: string };

/** Les plateformes que le produit sait rattacher. Snapchat n'en est pas. */
export type PlateformeConnectable = 'instagram' | 'tiktok';

export type AudienceDuCompte = {
  social_account_id: string;
  platform: Platform;
  handle: string | null;
  status: SocialAccountStatus;
  verification_status: VerificationStatus;
  followers_count: number | null;
  following_count: number | null;
  media_count: number | null;
  avg_views: number | null;
  engagement_rate: string | null;
  /** Nulle quand aucun relevé n'existe. Un chiffre sans date ment. */
  captured_at: string | null;
  /**
   * Faux quand le compte a été rattaché sous un autre fournisseur : son jeton
   * n'existe chez personne, et aucune reconnexion ne le récupérera.
   */
  reconnectable: boolean;
};

export type SignalJuge = {
  signal: string;
  verdict: string;
  constate: string | number | null;
  requis: string | number | null;
};

export type VerificationDuCompte = {
  social_account_id: string;
  platform: Platform;
  handle: string | null;
  verification_status: VerificationStatus;
  started_at: string;
  reviewed_at: string | null;
  signaux: SignalJuge[];
};

// --------------------------------------------------------------------------
// découverte
// --------------------------------------------------------------------------

export type ItemDuFil = {
  tier_offer_id: string;
  catalog_item_id: string;
  tier_id: string;
  social_account_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  duration_minutes: number | null;
  requires_booking: boolean;
  photo_key: string | null;
  platform: Platform;
  content_format: ContentFormat;
  value_ratio: string | null;
};

export type CommerceDuFil = {
  business_id: string;
  name: string;
  category: BusinessCategory;
  address: string | null;
  cover_photo_key: string | null;
  distance_metres: number;
  items: ItemDuFil[];
};

export type Fil = {
  commerces: CommerceDuFil[];
  /** Accompagne toujours la réponse, même quand le fil n'est pas vide. */
  obstacles: Obstacle[];
};

export type OffreDeLaFiche = {
  tier_offer_id: string;
  catalog_item_id: string;
  tier_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  duration_minutes: number | null;
  requires_booking: boolean;
  photo_key: string | null;
  platform: Platform;
  content_format: ContentFormat;
  required_mention: string | null;
  required_geotag: boolean;
  value_ratio: string | null;
  accessible: boolean;
  social_account_id: string | null;
  obstacles: Obstacle[];
  prochains_creneaux: string[];
};

export type FichePublique = {
  business_id: string;
  name: string;
  category: BusinessCategory;
  address: string | null;
  timezone: string;
  phone: string | null;
  cover_photo_key: string | null;
  offres: OffreDeLaFiche[];
};

export type Creneau = {
  starts_at: string;
  ends_at: string;
  places_restantes: number;
};

// --------------------------------------------------------------------------
// réservation
// --------------------------------------------------------------------------

export type Booking = {
  id: string;
  status: BookingStatus;
  starts_at: string | null;
  ends_at: string | null;
  valid_until: string;
  hold_expires_at: string | null;
};

export type CodeDeRetrait = {
  /** La charge du QR, **telle que l'API la forme** : `identifiant:chiffres`.
   *
   * Elle n'est pas décorative et ne se recompose pas ici. L'identifiant est
   * celui du **code**, pas celui de la réservation ; l'app assemblait
   * `bookingId:code`, que la vérification ne reconnaissait pas — un QR
   * parfaitement lisible, refusé sans que rien ne dise pourquoi. */
  payload: string;
  /** Les chiffres tournants, pour l'affichage seul : ils ne s'identifient pas
   * sans le code qui les porte, et ne se saisissent donc pas à la caisse. */
  code: string;
  manual_code: string;
  seconds_remaining: number;
  rotation_seconds: number;
};

export type ContrepartieBreve = {
  collaboration_id: string;
  status: CollaborationStatus;
  deadline_at: string;
  attempts_count: number;
  needs_human_review: boolean;
};

export type ReservationDuCreateur = {
  booking_id: string;
  status: BookingStatus;
  starts_at: string | null;
  ends_at: string | null;
  valid_until: string;
  created_at: string;
  business_id: string;
  business_name: string;
  business_category: BusinessCategory;
  business_address: string | null;
  /** L'heure s'affiche dans le fuseau du commerce, pas dans celui du téléphone. */
  business_timezone: string;
  business_cover_photo_key: string | null;
  item_name: string;
  item_photo_key: string | null;
  duration_minutes: number | null;
  platform: Platform;
  content_format: ContentFormat;
  contrepartie: ContrepartieBreve | null;
};

export type HistoriqueDuCreateur = {
  items: ReservationDuCreateur[];
  /** Tous les statuts, à zéro s'il le faut, calculés sur tout l'historique. */
  compteurs: Record<BookingStatus, number>;
};

export type ReservationDuCommerce = {
  booking_id: string;
  status: BookingStatus;
  starts_at: string | null;
  ends_at: string | null;
  valid_until: string;
  creator_id: string;
  creator_first_name: string | null;
  creator_last_name: string | null;
  creator_handle: string | null;
  item_name: string;
  duration_minutes: number | null;
  platform: Platform;
  content_format: ContentFormat;
  contrepartie: ContrepartieBreve | null;
};

export type JourneeDuCommerce = {
  jour: string;
  timezone: string;
  debut: string;
  fin: string;
  items: ReservationDuCommerce[];
  /**
   * Ce qui attend une décision, **toutes dates confondues**.
   *
   * Hors de la journée : une réservation à trancher pour après-demain
   * n'apparaîtrait dans aucune journée qu'on ouvre.
   */
  a_trancher: ReservationDuCommerce[];
};

// --------------------------------------------------------------------------
// contrepartie
// --------------------------------------------------------------------------

export type Preuve = {
  id: string;
  submitted_at: string;
  capture_method: 'api' | 'url_fetch' | 'upload';
  content_hash: string;
  source_url: string | null;
  platform_published_at: string | null;
};

export type Collaboration = {
  id: string;
  booking_id: string;
  tier_id: string;
  required_format: ContentFormat;
  required_mention: string | null;
  required_geotag: boolean;
  deadline_at: string;
  status: CollaborationStatus;
  attempts_count: number;
  needs_human_review: boolean;
  approved_at: string | null;
  proofs: Preuve[];
};

export type DerniereSoumission = {
  proof_id: string;
  submitted_at: string;
  capture_method: 'api' | 'url_fetch' | 'upload';
  source_url: string | null;
  media_key: string | null;
  screenshot_key: string | null;
  platform_published_at: string | null;
};

/** Où regarder une preuve, et combien de temps l'adresse vaut. */
export type DroitDeLecture = { url: string; expires_in: number };

export type LigneDeFile = {
  collaboration_id: string;
  booking_id: string;
  status: CollaborationStatus;
  required_format: ContentFormat;
  required_mention: string | null;
  required_geotag: boolean;
  deadline_at: string;
  attempts_count: number;
  needs_human_review: boolean;
  created_at: string;
  business_id: string;
  business_name: string;
  creator_id: string;
  creator_first_name: string | null;
  creator_last_name: string | null;
  creator_handle: string | null;
  platform: Platform;
  item_name: string;
  dernier_motif: string | null;
  /** Chaque demande de nouvelle soumission, dans l'ordre. C'est la répétition
   *  qui justifie l'escalade ; le seul dernier motif ne la montre pas. */
  tentatives: Tentative[];
  derniere_soumission: DerniereSoumission | null;
};

/** Une demande de nouvelle soumission, telle que le journal l'a écrite. */
export type Tentative = {
  /** Un code du vocabulaire fermé — ou, pour les plus anciennes, une phrase. */
  motif: string;
  demandee_le: string;
  par: 'system' | 'creator' | 'business_member' | 'admin';
};

/** Les trois onglets du commerce. Facultatif : sans lui, la liste rend tout. */
export type FiltreDeContrepartie = 'to_review' | 'expected' | 'approved';

/** Le vocabulaire du commerce, plus l'issue qui n'est qu'à l'arbitre. */
export type IssueDArbitrage = 'approve' | 'resubmit' | 'unfulfilled';

// --------------------------------------------------------------------------
// commerce et back office
// --------------------------------------------------------------------------

export type EtapeActivation = {
  cle: 'address' | 'coordinates' | 'cover_photo' | 'catalog_item' | 'tier_offer' | 'capacity_rule';
  done: boolean;
  /** Bloquante : l'activation est refusée. Non bloquante : la visibilité l'est. */
  blocking: boolean;
};

/**
 * Les étapes, **et où en est le commerce**.
 *
 * Le statut manquait : l'écran voyait six étapes faites et proposait « ouvrir
 * mon commerce » à un commerce ouvert depuis des semaines.
 */
export type VueDActivation = {
  status: 'onboarding' | 'active' | 'suspended';
  etapes: EtapeActivation[];
};

export type PlanAdministrateur = {
  plan_id: string;
  name: string;
  category: BusinessCategory;
  price_cents: number;
  currency: string;
  billing_interval: 'monthly' | 'yearly';
  features: Record<string, unknown>;
  is_active: boolean;
  subscriptions_count: number;
  active_subscriptions_count: number;
  mrr_cents: number;
};

export type Jetons = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

// --------------------------------------------------------------------------
// reporting commerce
// --------------------------------------------------------------------------

export type LigneDePalier = {
  tier_id: string;
  platform: Platform;
  content_format: ContentFormat;
  publications: number;
  valeur_offerte_cents: number;
};

export type LigneDItem = {
  catalog_item_id: string;
  name: string;
  reservations: number;
  consommations: number;
  publications: number;
  valeur_offerte_cents: number;
};

export type Reporting = {
  business_id: string;
  currency: string;
  debut: string;
  fin: string;
  timezone: string;
  reservations: number;
  consommations: number;
  annulations: number;
  absences: number;
  publications: number;
  publications_attendues: number;
  non_honorees: number;
  /**
   * Ce que le commerce a **donné**, pas ce qu'il a gagné. C'est le seul montant
   * qu'un commerce voit, et il ne s'affiche pas comme un revenu.
   */
  valeur_offerte_cents: number;
  /** Ordre de grandeur, jamais une audience atteinte. */
  portee_approximative: number;
  /** Nul quand rien n'a été servi : zéro sur zéro n'est pas zéro. */
  taux_d_honoration: number | null;
  par_palier: LigneDePalier[];
  par_item: LigneDItem[];
};

export type Abonnement = {
  id: string;
  plan_id: string;
  status: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled';
  current_period_end: string | null;
  checkout_url: string | null;
};

export type PlanSouscriptible = {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_interval: 'monthly' | 'yearly';
  features: Record<string, unknown>;
};

// --------------------------------------------------------------------------
// composition du commerce : catalogue, paliers offerts, horaires
// --------------------------------------------------------------------------

export type ItemDuCatalogue = {
  id: string;
  business_id: string;
  parent_item_id: string | null;
  name: string;
  description: string | null;
  price_cents: number;
  /** Sans elle, aucun calcul de capacité n'est possible. Le formulaire l'exige. */
  duration_minutes: number | null;
  requires_booking: boolean;
  photo_key: string | null;
  source: 'manual' | 'menu_import';
  /** L'interrupteur propre à l'item, celui que le commerce manipule. */
  is_available: boolean;
  /** Calculé : un parent fermé ferme ses variantes sans toucher leur interrupteur. */
  is_effectively_available: boolean;
  created_at: string;
  updated_at: string;
};

/** Un palier tel qu'un commerce le voit pour composer. Actifs seulement. */
export type PalierOffrable = {
  id: string;
  platform: Platform;
  content_format: ContentFormat;
  min_followers: number;
  min_completed_collabs: number;
  min_reliability_score: string | null;
  value_ratio_hint: string | null;
  display_order: number;
  is_active: boolean;
};

export type OffreDePalier = {
  id: string;
  business_id: string;
  tier_id: string;
  catalog_item_id: string;
  platform: Platform;
  content_format: ContentFormat;
  item_name: string;
  is_active: boolean;
  is_effectively_offered: boolean;
  created_at: string;
};

/**
 * Une plage d'ouverture et le nombre de postes en parallèle.
 *
 * Horaires et capacité sont une seule règle : des horaires sans postes
 * n'ouvrent rien, et des postes sans horaires n'ouvrent nulle part.
 */
export type RegleDeCapacite = {
  id: string;
  business_id: string;
  /** 0 = lundi, conformément à la contrainte de base. */
  weekday: number;
  start_time: string;
  end_time: string;
  concurrent_slots: number;
};

/** Une journée qui remplace la règle du jour — jamais qui s'y ajoute. */
export type ExceptionDeCapacite = {
  id: string;
  business_id: string;
  date: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  concurrent_slots: number | null;
};

/**
 * Ce qu'il faut pour publier une prestation.
 *
 * `duration_minutes` est obligatoire ici alors que l'API l'accepte nulle :
 * sans durée, aucun calcul de capacité n'est possible, et une prestation
 * publiée sans elle n'ouvrirait jamais un créneau.
 */
export type NouvelItem = {
  name: string;
  price_cents: number;
  duration_minutes: number;
  description?: string | null;
  requires_booking?: boolean;
  photo_key?: string | null;
};
