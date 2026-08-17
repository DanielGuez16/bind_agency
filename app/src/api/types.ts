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

/**
 * Le score de fiabilité, et de combien de collaborations il est tiré.
 *
 * **Nul veut dire neutre, pas zéro.** C'est ce null qui distingue « pas encore
 * de score » de « score bas » : deux écrans différents, et répondre zéro au
 * premier ferait d'un débutant quelqu'un de peu fiable.
 */
export type FiabiliteDuCreateur = {
  reliability_score: string | null;
  completed_collabs_count: number;
};

export type VueDesPaliers = {
  creator_id: string;
  is_new_creator: boolean;
  fiabilite: FiabiliteDuCreateur;
  paliers: PalierAccessible[];
};

/** Ce que rend l'ouverture d'une autorisation : où envoyer la personne. */
export type AutorisationDemarree = { authorization_url: string };

/**
 * Les sept genres de notification, et rien d'autre.
 *
 * Fermée comme les codes d'obstacle : les valeurs viennent du serveur, et un
 * genre inconnu n'a pas de libellé à afficher. Un test compare cette union à
 * l'énumération du serveur.
 */
export type GenreDeNotification =
  | 'booking_approved'
  | 'booking_declined'
  | 'booking_cancelled_by_business'
  | 'publication_reminder'
  | 'publication_approved'
  | 'publication_resubmit'
  | 'booking_to_review'
  | 'subscription_grace_ending'
  | 'subscription_ended'
  | 'support_access_started'
  | 'collaboration_opened'
  | 'collaboration_unfulfilled';

/** Sur quoi tourne le terminal. Rendu par l'app, jamais déduit du jeton. */
export type PlateformeDeTerminal = 'ios' | 'android' | 'web';

export type TerminalEnregistre = {
  id: string;
  platform: PlateformeDeTerminal;
  status: 'active' | 'revoked';
  last_seen_at: string;
};

/**
 * Les sept genres et leur état.
 *
 * Toujours les sept, y compris ceux que personne n'a touchés : l'écran de
 * réglages se dessine sans connaître la liste, et une absence ne se lit pas
 * comme un genre inexistant.
 */
export type PreferencesDeNotification = {
  preferences: Record<GenreDeNotification, boolean>;
};

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

/**
 * Ce que la caisse voit après avoir reconnu un code, avant de servir.
 *
 * Déclaré ici et non dans l'écran : `Api` le rend, et un client d'API qui
 * importerait un type depuis un écran inverserait la dépendance.
 */
export type Verification = {
  booking_id: string;
  redemption_code_id: string;
  creator_name: string | null;
  item_name: string;
  item_photo_key: string | null;
  starts_at: string | null;
  valid_until: string;
  status: string;
  par_secours: boolean;
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
  /** Le quartier déclaré par le commerce. `null` hors des quartiers ouverts. */
  neighborhood: Neighborhood | null;
  cover_photo_key: string | null;
  /**
   * La couverture verticale du mur, livrée en 1600 × 2000 (4:5).
   *
   * Un champ à part, jamais un remplacement : la paysage sert encore la fiche
   * et les listes. `null` : le mur retombe sur `cover_photo_key` — un 16:9
   * recadré vaut mieux qu'un monogramme. Le serveur ne recopie pas l'une dans
   * l'autre, sinon les deux ne se distinguent plus le jour où l'une change.
   */
  cover_portrait_key: string | null;
  /**
   * **Et le mur en sert l'original, jamais la vignette.** Celle-ci est bornée à
   * 480 px sur le grand côté : sur un héros de 520 points à fond perdu, elle
   * serait agrandie trois fois. Une seule source pour tous les formats, même là
   * où un triptyque de 158 points s'en contenterait — deux sources donneraient
   * deux cadrages du même salon selon sa position dans le cycle, ce que le mur
   * existe précisément pour éviter.
   */
  distance_metres: number;
  items: ItemDuFil[];
};

/**
 * Les quartiers de Miami où BIND ouvre.
 *
 * Une liste fermée, déclarée par le commerce : deux salons qui écriraient
 * « South Beach » et « SoBe » ne se compteraient pas ensemble, et le fil
 * annoncerait deux quartiers là où il y en a un.
 */
export type Neighborhood =
  | 'wynwood'
  | 'brickell'
  | 'south_beach'
  | 'little_havana'
  | 'little_haiti'
  | 'design_district'
  | 'coral_gables'
  | 'midtown'
  | 'edgewater'
  | 'coconut_grove';

/**
 * Un quartier du fil : ses salons, ses prestations, sa distance.
 *
 * La distance est celle du **salon le plus proche**, jamais une moyenne : un
 * quartier se choisit pour s'y rendre, et une moyenne ne désignerait aucun
 * salon existant.
 */
export type CompteParQuartier = {
  quartier: Neighborhood;
  commerces: number;
  prestations: number;
  distance_metres: number;
};

/** Ce qu'une pastille de catégorie ouvrirait, dans le rayon courant. */
export type CompteParCategorie = {
  categorie: BusinessCategory;
  commerces: number;
  prestations: number;
};

/** Ce qu'un élargissement ouvrirait, filtre de catégorie conservé. */
export type CompteParRayon = {
  rayon_metres: number;
  commerces: number;
  prestations: number;
};

export type Fil = {
  commerces: CommerceDuFil[];
  /** Accompagne toujours la réponse, même quand le fil n'est pas vide. */
  obstacles: Obstacle[];
  /** Le rayon réellement appliqué : c'est lui qui s'écrit dans « rayon 3 km ». */
  rayon_metres: number;
  total_prestations: number;
  /**
   * Les catégories qui mènent quelque part, **filtre en vigueur ignoré**.
   *
   * C'est ce qui permet d'écrire « Retirer le filtre Spa · 34 salons » depuis
   * l'écran filtré sur Spa, et de n'afficher que les pastilles qui ouvrent sur
   * quelque chose. Une catégorie absente n'a rien de réservable ici.
   */
  categories: CompteParCategorie[];
  /**
   * Les élargissements possibles, du plus étroit au plus large, avec leur gain.
   *
   * Ne contient jamais un rayon plus étroit que celui en vigueur : rétrécir
   * n'est pas une issue à un fil vide. Vide quand on est déjà au plus large.
   */
  rayons: CompteParRayon[];
  /**
   * Le palier suivant, et ce qu'il ouvrirait.
   *
   * **Nul quand il n'y en a pas** — tout est déjà ouvert, ou aucun n'est
   * atteignable. Le pied du mur disparaît alors, plutôt que de promettre un
   * palier qui n'existe pas. Ce n'est pas un repli défensif : c'est un état que
   * le produit atteint, et qui s'éprouve.
   */
  prochain_palier: {
    tier_id: string;
    content_format: ContentFormat;
    /** Combien de commerces de plus ce palier ouvrirait. */
    commerces_de_plus: number;
    obstacle: Obstacle;
  } | null;
  /** Les quartiers du fil rendu, du plus proche au plus lointain. */
  quartiers: CompteParQuartier[];
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
  /**
   * La prestation laisse-t-elle un choix au créateur. Vrai : il choisira sur
   * place, et c'est la carte qui lui dit quoi — l'écran a alors une raison de
   * mettre l'accès à la carte en avant.
   */
  leaves_choice: boolean;
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
  /** La galerie, dans l'ordre choisi par le commerce. Elle montre le lieu. */
  photos: string[];
  /**
   * Les pages de la carte, dans l'ordre où elle se lit. **Un accès à part de la
   * galerie** : montrer le lieu et consulter une carte sont deux gestes.
   */
  menu_pages: string[];
  /**
   * L'adresse de la carte en ligne.
   *
   * Quand `menu_pages` est vide et que celle-ci est renseignée, l'écran doit
   * **dire qu'on sortira de l'application** avant d'ouvrir le lien : un lien
   * qui s'ouvre sans prévenir, au milieu d'un parcours de réservation, fait
   * perdre le fil à qui revient.
   */
  menu_url: string | null;
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
  /**
   * Jusqu'à quand le commerce peut accepter ou refuser. `null` hors d'attente.
   *
   * Rendue par le serveur plutôt que déduite ici : le délai est un réglage, et
   * le recopier côté écran le ferait dériver au premier ajustement. C'est aussi
   * ce qui fait lire **la même heure** aux deux côtés, au lieu de deux comptes
   * à rebours calculés séparément.
   */
  approval_expires_at: string | null;
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
  /**
   * Ce que la réservation a produit, une fois consommée.
   *
   * **C'est là et nulle part ailleurs que le créateur lit ses obligations.**
   * Les critères y sont figés à la création de la contrepartie ; ceux de
   * l'offre suivent le commerce et changeraient sous ses pieds.
   */
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
  /**
   * Jusqu'à quand le commerce peut accepter ou refuser. `null` hors d'attente.
   *
   * Rendue par le serveur plutôt que déduite ici : le délai est un réglage, et
   * le recopier côté écran le ferait dériver au premier ajustement. C'est aussi
   * ce qui fait lire **la même heure** aux deux côtés, au lieu de deux comptes
   * à rebours calculés séparément.
   */
  approval_expires_at: string | null;
  creator_id: string;
  creator_first_name: string | null;
  creator_last_name: string | null;
  creator_handle: string | null;
  item_name: string;
  duration_minutes: number | null;
  platform: Platform;
  content_format: ContentFormat;
  /** Ce que la publication devra porter. Le comptoir le vérifiera. */
  required_mention: string | null;
  required_geotag: boolean;
  contrepartie: ContrepartieBreve | null;
  /**
   * Quand le bouton « signaler une absence » s'ouvre. `null` : jamais — un item
   * sans créneau n'a pas d'heure à laquelle ne pas se présenter.
   *
   * Rendu par le serveur plutôt que déduit ici : le délai est un réglage, et le
   * recopier côté écran le ferait dériver au premier ajustement. L'écran s'en
   * sert pour ouvrir le bouton et pour dire à quelle heure il s'ouvre ; c'est le
   * serveur qui refuse, jamais l'horloge du téléphone.
   */
  absence_signalable_a: string | null;
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
  /**
   * Vraie quand les quatre conditions de `SPEC.md` sont réunies. **Nulle** sur
   * une preuve de niveau 2 ou 3 : la question ne s'est pas posée, ce qui n'est
   * pas la même chose qu'une vérification qui a échoué. Les deux se disent
   * autrement — « attestée » d'un côté, « ne correspond pas » de l'autre.
   */
  verifiee: boolean | null;
  raisons_de_non_verification: string[];
  id: string;
  submitted_at: string;
  capture_method: 'api' | 'url_fetch' | 'upload';
  content_hash: string;
  source_url: string | null;
  platform_published_at: string | null;
  /**
   * Ce que le créateur a écrit en soumettant. **Rendu tel quel, jamais
   * traduit** : c'est du contenu saisi, comme le nom d'un item de catalogue.
   */
  note: string | null;
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
  /** Ce que le créateur a écrit. Se lit au même endroit que sa preuve. */
  note: string | null;
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
  /**
   * Ce que l'auteur a ajouté au code. **Rendu tel quel, jamais traduit** :
   * c'est du contenu saisi. Le code, à côté, porte le sens que l'interface
   * sait traduire — c'est ce qui permet à la note d'exister sans rouvrir le
   * trou que `SPEC.md` §4.2 craignait.
   */
  note: string | null;
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
/**
 * L'état d'un commerce.
 *
 * `draft` est **une fiche préparée sur le terrain que personne n'assume
 * encore** : aucun membre, invisible du fil, et qui refuse de s'ouvrir. Elle
 * n'apparaît que dans le suivi du démarchage.
 */
export type StatutDuCommerce = 'draft' | 'onboarding' | 'active' | 'suspended';

export type VueDActivation = {
  status: StatutDuCommerce;
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
  /**
   * Signalements de déplacement pour rien **retenus par l'arbitrage**.
   *
   * Les signalements en attente n'y figurent pas : une allégation n'est pas un
   * fait, et l'afficher au salon lui ferait contester ce que personne n'a
   * encore examiné.
   */
  deplacements_pour_rien: number;
  publications: number;
  publications_attendues: number;
  non_honorees: number;
  /**
   * Ce que le commerce a **donné**, en centimes.
   *
   * **Le client ne l'affiche plus.** La règle de la carte d'API est qu'aucun
   * montant ne figure dans une réponse destinée aux applications créateur et
   * commerce ; la réponse en porte encore un, et le client l'ignore. Ce n'est
   * pas cosmétique : ce qui convainc un salon se dit en prestations, en
   * publications et en délais tenus, et c'est plus juste — un salon ne compare
   * pas des euros, il compare ce qu'il a donné à ce qu'il a reçu.
   */
  valeur_offerte_cents: number;
  /**
   * Le temps de fauteuil donné, en minutes, qui remplace le montant.
   *
   * **Annoncé, pas encore servi.** Il se calcule à partir de la durée des
   * prestations consommées, sans jamais toucher à un prix. Absent n'est pas
   * zéro : « 0 heure donnée » à un salon qui a servi quatre-vingt-huit
   * prestations serait faux, et c'est exactement le chiffre qui doit le
   * convaincre.
   */
  temps_de_fauteuil_minutes?: number | null;
  /** Ordre de grandeur, jamais une audience atteinte. */
  portee_approximative: number;
  /** Nul quand rien n'a été servi : zéro sur zéro n'est pas zéro. */
  taux_d_honoration: number | null;
  par_palier: LigneDePalier[];
  par_item: LigneDItem[];
  /** L'évolution, semaine par semaine. Un total ne dit pas s'il a été atteint
   *  régulièrement ou d'un seul coup. */
  par_semaine: LigneDeSemaine[];
};

export type LigneDeSemaine = {
  /** Le lundi de la semaine, en date locale du commerce. */
  debut: string;
  publications: number;
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
  /**
   * La prestation laisse-t-elle un choix au créateur. Vrai : il choisira sur
   * place, et c'est la carte qui lui dit quoi — l'écran a alors une raison de
   * mettre l'accès à la carte en avant.
   */
  leaves_choice: boolean;
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


/** Les médias de la plateforme : les pastilles de catégorie et l'accueil. */
export type MediasPlateforme = {
  categories: { category: BusinessCategory; photo_key: string | null }[];
  /**
   * Les quatre médias de l'accueil, chacun pouvant manquer séparément.
   *
   * Deux orientations parce que l'écran est en plein écran : une vidéo 16:9 sur
   * un téléphone tenu droit ne peut donner que des bandes noires ou un
   * recadrage qui coupe le sujet.
   */
  home: {
    video_key: string | null;
    poster_key: string | null;
    video_portrait_key: string | null;
    poster_portrait_key: string | null;
  };
};

/**
 * Où en est la composition d'un commerce : les trois nombres du menu.
 *
 * **`en_ligne_depuis` nulle n'est pas une mise en pause.** Jamais mis en ligne
 * et retiré du fil sont deux états différents, et le menu ne doit pas les
 * confondre : le premier attend un premier geste, le second en attend un autre.
 */
/**
 * Une page de la carte du commerce. Jumelle d'une photo de galerie, et distincte
 * par ce qu'elle sert : la galerie montre le lieu, la carte se consulte.
 */
export type PageDeLaCarte = {
  id: string;
  storage_key: string;
  position: number;
  alt_text: string | null;
};

export type EtatDeLaComposition = {
  business_id: string;
  prestations: number;
  prestations_masquees: number;
  jours_ouverts: number;
  en_ligne_depuis: string | null;
  status: 'onboarding' | 'active' | 'paused' | 'suspended';
};

/** La moitié centrale du voisinage. Jamais ses extrêmes. */
export type Fourchette = { bas: number; haut: number };

/**
 * Ce que font les salons d'à côté, pour les états vides du commerce.
 *
 * **Les deux fourchettes sont nulles sous cinq salons alentour**, et `commerces`
 * est rendu quand même : l'écran écrit alors « pas encore assez de salons autour
 * de vous » plutôt qu'un vide qu'on prendrait pour une panne.
 *
 * `rayon_metres` s'écrit : « les salons dans 2 km » situe le repère, « votre
 * quartier » serait un découpage que le modèle n'a pas.
 */
export type ReperesDuVoisinage = {
  rayon_metres: number;
  commerces: number;
  prestations_publiees: Fourchette | null;
  places_par_jour: Fourchette | null;
  palier_le_plus_offert: { platform: Platform; content_format: ContentFormat } | null;
};

// --------------------------------------------------------------------------
// annuaire des créateurs
// --------------------------------------------------------------------------

export type CompteVuParLeCommerce = {
  platform: Platform;
  handle: string | null;
  /** Nul quand aucun relevé n'existe. Zéro serait un chiffre, et faux. */
  followers: number | null;
};

/**
 * Ce qu'un salon abonné voit d'une créatrice.
 *
 * **Aucun score de fiabilité, et c'est une promesse tenue.** Le produit dit à la
 * créatrice, sur son écran, qu'il n'est « jamais comparé entre créatrices,
 * jamais montré à un commerce ». Le palier ouvert porte la même information sans
 * la livrer : un score dégradé la plafonnerait à un palier plus bas.
 */
export type CreateurDeLAnnuaire = {
  creator_id: string;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  bio: string | null;
  comptes: CompteVuParLeCommerce[];
  paliers_ouverts: ContentFormat[];
  audience_totale: number;
};

/** Une photo de la galerie d'un commerce. La clé, jamais une adresse. */
export type PhotoDuCommerce = {
  id: string;
  storage_key: string;
  position: number;
  alt_text: string | null;
};

// --------------------------------------------------------------------------
// inscription sur le terrain
// --------------------------------------------------------------------------

/**
 * Ce que le salon voit d'une fiche préparée pour lui, avant de s'engager.
 *
 * **Des nombres, pas des listes.** Le gérant a besoin de reconnaître son salon
 * — son nom, son adresse, « douze prestations relevées de votre carte » — pas
 * de lire sa fiche entière depuis un lien qui circule dans un SMS.
 */
export type ApercuDeLaFiche = {
  business_name: string;
  address: string | null;
  phone: string | null;
  prestations_preparees: number;
  plages_preparees: number;
  /** À renvoyer telle quelle : un lien ouvert la semaine dernière montre les
   *  conditions de la semaine dernière. */
  terms_version: string;
};

/** Le lien remis, rendu **une seule fois**. La base n'en garde que l'empreinte. */
export type LienRemis = {
  business_id: string;
  url: string;
  expires_at: string;
  channel: 'qr' | 'email';
};

/** Une fiche préparée et où elle en est. La mesure du démarchage physique. */
export type FichePreparee = {
  business_id: string;
  name: string;
  status: StatutDuCommerce;
  address: string | null;
  prepared_at: string;
  issued_at: string | null;
  expires_at: string | null;
  used_at: string | null;
  revoked_at: string | null;
  channel: 'qr' | 'email' | null;
};

/** Une reprise du compte par l'administration, telle que le salon la lit. */
export type RepriseDuCompte = {
  id: string;
  business_id: string;
  admin_user_id: string;
  reason: string;
  started_at: string;
  expires_at: string;
  /** Nulle quand personne n'a refermé : une reprise échue n'est pas une
   *  reprise fermée, et les deux ne se lisent pas pareil. */
  ended_at: string | null;
};
