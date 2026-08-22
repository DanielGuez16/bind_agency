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
  | 'unfulfilled'
  /** Fermée sans faute : le produit n'a pas su transmettre la demande. */
  | 'closed_no_fault';

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
  /**
   * La même grandeur, restreinte au rayon. **`null` n'est pas zéro** : c'est
   * « aucune position n'a été fournie ». Zéro dirait « aucun salon autour de
   * vous », ce qui est faux et décourageant — l'écran tait alors la phrase
   * entière plutôt que d'afficher 0.
   */
  offres_dans_le_rayon: number | null;
  /** Chez combien de salons, dans le rayon. Même règle pour le `null`. */
  commerces_dans_le_rayon: number | null;
};

/**
 * Le score de fiabilité, et de combien de collaborations il est tiré.
 *
 * **Nul veut dire neutre, pas zéro.** C'est ce null qui distingue « pas encore
 * de score » de « score bas » : deux écrans différents, et répondre zéro au
 * premier ferait d'un débutant quelqu'un de peu fiable.
 */
/** Ce qu'un événement fait au score. Trois valeurs, et la troisième compte. */
export type SensDuScore = 'up' | 'down' | 'neutral';

/**
 * Un événement du score, et ce qu'il lui fait.
 *
 * **Le sens, jamais le poids.** L'écran nomme ce qui monte et ce qui descend ;
 * « −25 » ne veut rien dire à qui ne connaît pas l'échelle, et le servir
 * inviterait à faire le calcul plutôt qu'à tenir sa parole.
 */
export type ComposanteDuScore = {
  evenement: string;
  sens: SensDuScore;
};

export type FiabiliteDuCreateur = {
  reliability_score: string | null;
  completed_collabs_count: number;
  /**
   * Ce qui monte, ce qui descend, et ce qui ne fait rien.
   *
   * **Lu, jamais récité.** L'écran de détail portait sa liste en dur : les
   * sens viennent de `reliability_weights`, qui est de la configuration, et un
   * poids inversé en exploitation aurait rendu l'écran faux sans qu'aucun test
   * ne tombe. Les neuf événements arrivent désormais avec le sens du jour.
   *
   * Les neutres en font partie : « ce qui affecte le score » doit pouvoir dire
   * « ceci ne l'affecte pas », sans quoi la liste ment par omission le jour où
   * l'un d'eux redevient non nul.
   */
  composantes: ComposanteDuScore[];
};

/**
 * Une prestation ouverte à un palier, où qu'elle soit.
 *
 * **Sans borne de distance, et c'est tout son intérêt.** Le fil est borné par un
 * rayon par construction ; la bascule « près de vous / les douze » a besoin des
 * objets, pas d'un nombre. L'ordre vient du serveur — par quartier, puis par nom
 * de prestation — et ne se rejoue pas ici : c'est le seul axe que le produit
 * connaît et qui ne classe personne.
 */
export type OffreDuPalier = {
  tier_offer_id: string;
  catalog_item_id: string;
  business_id: string;
  nom: string;
  nom_du_commerce: string;
  neighborhood: Neighborhood | null;
  price_cents: number;
  currency: string;
  duration_minutes: number | null;
  photo_key: string | null;
  /**
   * La distance, quand une position a été fournie.
   *
   * `null` sinon, et ce n'est pas « loin » : c'est « on ne sait pas d'où ». La
   * confondre avec zéro placerait toutes les prestations à vos pieds.
   */
  distance_metres: number | null;
};

/**
 * Le palier fermé le plus proche, et ce qu'il ouvrirait.
 *
 * **Il vivait sur le fil.** L'écran qui le montre lit `mesPaliers` depuis la
 * refonte : le champ était servi à chaque chargement du fil et lu nulle part.
 *
 * Le classement est fait par le serveur — sur le **nombre** de conditions qui
 * manquent, jamais sur leur ampleur — parce que le refaire ici en ferait une
 * seconde vérité, et que comparer un écart d'abonnés à un nombre de
 * collaborations revient à inventer un ordre.
 */
export type ProchainPalier = {
  tier_id: string;
  platform: Platform;
  content_format: ContentFormat;
  /** Le premier obstacle, celui qu'on affiche. */
  obstacle: Obstacle;
  /**
   * Combien de commerces le proposent à portée. `null` sans position — une
   * absence, jamais un zéro.
   *
   * **Ce n'est plus « de plus ».** Sur le fil, le compte excluait les commerces
   * déjà listés ; hors du fil il n'y a rien à exclure, et garder le mot ferait
   * promettre une soustraction qui n'a plus d'opérande.
   */
  commerces_dans_le_rayon: number | null;
};

export type VueDesPaliers = {
  creator_id: string;
  is_new_creator: boolean;
  fiabilite: FiabiliteDuCreateur;
  paliers: PalierAccessible[];
  prochain_palier: ProchainPalier | null;
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
  /**
   * Quand l'autorisation est tombée, ou tombera.
   *
   * **La carte disait « finie » sans dire quand.** « Expirée il y a trois
   * jours » et « expirée en mars » n'appellent pas la même réaction.
   *
   * Nulle veut dire « on ne sait pas » — plateforme qui ne borne pas ses
   * jetons, compte révoqué dont le jeton a été effacé — jamais « c'est bon ».
   * C'est `status` qui tranche, et lui seul.
   */
  token_expires_at: string | null;
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
  /**
   * Le pseudonyme du compte de cette réservation. **Jamais un nom civil** : la
   * caisse composait « Rebecca Alvarez » depuis le profil, et un salon n'a
   * aucune raison de connaître le nom légal de quelqu'un. Ce n'est pas le nom
   * qui autorise le retrait, c'est le code.
   */
  creator_handle: string | null;
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
  /** Les quartiers du fil rendu, du plus proche au plus lointain. */
  quartiers: CompteParQuartier[];
  /**
   * Le palier le plus proche d'être atteint, et ce qu'il ouvrirait.
   *
   * `null` quand tout est ouvert, qu'aucun n'est atteignable, ou qu'il
   * n'ouvrirait aucun salon dans le rayon — promettre un palier qui n'apporte
   * rien serait pire que se taire, et le pied disparaît alors.
   */
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
  /** Les plages d'ouverture, du lundi au dimanche, en heures locales. */
  horaires: PlageHebdomadaire[];
  offres: OffreDeLaFiche[];
};

export type Creneau = {
  starts_at: string;
  ends_at: string;
  places_restantes: number;
};

/**
 * Un jour de la bande, tel que `/availability/summary` le rend.
 *
 * **Les deux champs, et non le seul compte.** Zéro créneau sur un jour ouvert
 * n'est pas un jour fermé : « complet » invite à regarder le lendemain,
 * « fermé » se grise. Un écran qui n'aurait que le compte peindrait les deux de
 * la même façon, et la personne croirait le salon fermé un jour où il déborde.
 *
 * **`ouvert` connaît les exceptions de capacité**, qui *remplacent* la règle
 * hebdomadaire au lieu de s'y ajouter : un jour férié rend `false` alors que
 * l'horaire hebdomadaire du salon dit le contraire. C'est la raison pour
 * laquelle ce champ ne se déduit pas côté client.
 */
export type JourDeDisponibilite = {
  /** La date **locale** du commerce, « 2026-08-19 ». */
  jour: string;
  /** L'horaire du salon, indépendant de la prestation demandée. */
  ouvert: boolean;
  /**
   * Le jour est-il derrière nous : **vrai dès que sa dernière plage est
   * close**, pas à minuit.
   *
   * Sans lui, à 20 h, aujourd'hui se lit « complet » — le salon ouvre bien
   * aujourd'hui et il ne reste aucun début. C'est l'état le plus fréquent des
   * quatre, puisque tout le monde ouvre l'application le soir, et le pire à
   * peindre en « pris d'assaut » : on renonce au lieu de revenir demain matin.
   *
   * Le quantificateur est `all()` sur les plages du jour, donc un salon qui
   * ferme le midi n'est pas révolu à 13 h.
   */
  revolu: boolean;
  /** Les débuts encore libres pour cet item, ce jour-là. */
  creneaux_libres: number;
};

/**
 * Une plage d'ouverture hebdomadaire. Lundi vaut 0.
 *
 * Heures **locales du commerce** : un salon ouvre à 9 h chez lui, pas à 9 h
 * chez vous, et convertir une heure d'ouverture n'a pas de sens.
 *
 * **Les exceptions ne sont pas appliquées ici, et c'est délibéré côté
 * serveur** : mêler une fermeture ponctuelle au tableau hebdomadaire ferait
 * lire « fermé le mardi » à qui regarde un mardi férié. La conséquence pour
 * l'écran est écrite là où l'étiquette se compose.
 */
export type PlageHebdomadaire = {
  weekday: number;
  start_time: string;
  end_time: string;
};

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

/**
 * Un réseau rattaché, tel que le salon le voit sur une demande.
 *
 * **L'absence est une information** : savoir qu'il n'y a pas de TikTok fait
 * partie de la décision autant que le nombre d'abonnés Instagram. Le compte
 * absent reste donc affiché, en encre douce et sans action.
 */
export type CompteDeLaCreatrice = {
  platform: Platform;
  handle: string | null;
  /** Nul quand aucun relevé n'existe. Zéro serait un chiffre, et faux. */
  followers: number | null;
  /**
   * Le taux d'engagement du dernier relevé, en pourcentage.
   *
   * **Le second chiffre de la décision** : cent mille abonnés à 0,4 % valent
   * moins qu'un compte de huit mille à 6 %, et un salon qui ne lit que le
   * volume choisit mal.
   */
  engagement_rate: string | null;
  /** Les vues moyennes du dernier relevé. Nul sur les réseaux qui ne les
   * rendent pas : l'absence de la mesure n'est pas l'absence de vues. */
  avg_views: number | null;
};

/** Une plage d'ouverture du jour. Vide veut dire fermé. */
export type PlageDuJour = {
  debut: string;
  fin: string;
  postes: number;
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
  creator_handle: string | null;
  /**
   * L'adresse du profil, sur le réseau de cette demande.
   *
   * Dérivée côté serveur du pseudonyme et de la plateforme, jamais stockée :
   * la fabriquer ici ferait deux vérités, et c'est celle qu'on ne rafraîchit
   * pas qui vieillirait. `null` quand la plateforme n'a pas d'adresse publique
   * connue — on n'affiche alors aucun lien plutôt qu'un lien mort.
   */
  creator_profil_url: string | null;
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
  /**
   * Tous les réseaux de la créatrice, pas seulement celui de cette demande.
   *
   * La planche les pose côte à côte sur le panneau : celui qui a un relevé
   * porte son chiffre et mène au profil, celui qui manque reste affiché sans
   * action. Un salon qui décide regarde les deux.
   */
  comptes: CompteDeLaCreatrice[];
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
  /**
   * Les plages d'ouverture de ce jour, exceptions comprises.
   *
   * **Vide veut dire fermé**, et c'est une information : une journée sans
   * réservation ne se lit pas pareil selon qu'on était fermé ou que personne
   * n'est venu. À ne pas confondre avec `debut` et `fin`, qui sont les bornes
   * de la journée **comptée** — c'est en les prenant pour des horaires que la
   * sous-ligne aurait annoncé « de 00:00 à 00:00 ».
   */
  horaires: PlageDuJour[];
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
  /**
   * Le code du dernier refus, quand il y en a eu un. `null` avant toute
   * demande de nouvelle soumission.
   *
   * **Un code fermé, jamais une phrase** — les valeurs sont celles de `MOTIFS`.
   * Le repli sur une phrase existe encore pour les motifs écrits avant le
   * vocabulaire fermé, qui dorment dans le journal. Relu de la même source que
   * `LigneDeFile.dernier_motif` côté commerce : deux lecteurs, une vérité.
   */
  dernier_motif: string | null;
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
  creator_handle: string | null;
  /**
   * La créatrice a supprimé son compte, et l'anonymisation est passée.
   *
   * **Le commerce ne voit jamais un compte anonymisé, il voit une créatrice
   * partie.** Les trois champs de nom sont alors nuls, et l'écran qui les
   * enchaînait en `??` finissait sur une chaîne vide : une ligne sans personne,
   * qu'on lit comme un bug du produit. Ce booléen dit la différence entre « on
   * ne sait pas qui » et « elle n'est plus là ».
   */
  creator_partie: boolean;
  platform: Platform;
  item_name: string;
  dernier_motif: string | null;
  /** Chaque demande de nouvelle soumission, dans l'ordre. C'est la répétition
   *  qui justifie l'escalade ; le seul dernier motif ne la montre pas. */
  tentatives: Tentative[];
  derniere_soumission: DerniereSoumission | null;
  /**
   * Combien de fois **de suite** le dernier motif a été opposé.
   *
   * De suite et non en tout : un dossier refusé pour la mention, puis pour le
   * format, puis de nouveau pour la mention n'est pas un dossier où la mention
   * n'a jamais été comprise.
   */
  repetitions_du_dernier_motif: number;
  /**
   * Vrai quand le même motif revient assez de fois de suite.
   *
   * **Servi et non déduit, et c'est une correction.** Je le dérivais côté écran
   * en exigeant que *tous* les motifs soient identiques : « format, mention,
   * mention, mention » y échappait, alors que les trois derniers refus portent
   * bien sur la même chose. Et le seuil est en configuration — un écran qui
   * écrirait trois en dur mentirait au premier ajustement.
   */
  meme_motif_repete: boolean;
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
/**
 * Ce qu'un arbitre peut décider.
 *
 * **`close_no_fault` est la quatrième, et elle existe pour un cas précis.**
 * Quand le même motif revient assez de fois, ni approuver ni refuser n'est
 * juste : le produit a échoué à transmettre une demande, et la trancher comme
 * une faute la met au débit de la mauvaise personne. Elle ferme le dossier et
 * ne touche pas au score.
 */
export type IssueDArbitrage = 'approve' | 'resubmit' | 'unfulfilled' | 'close_no_fault';

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

/**
 * Qui a souscrit un plan, par catégorie de commerce.
 *
 * **À ne pas confondre avec `PlanAdministrateur.category`**, qui dit à quelle
 * catégorie le plan *s'adresse*. Celle-ci dit qui a souscrit, et l'écart entre
 * les deux est l'argument chiffré de la tarification par catégorie : un prix
 * unique pour un salon d'ongles et un musée n'est pas un prix, c'est une
 * moyenne — et la moyenne se voit dans les chiffres.
 */
export type AbonnesParCategorie = {
  categorie: BusinessCategory;
  /** Tous statuts confondus : une catégorie partie a quelque chose à dire. */
  abonnes: number;
  abonnes_actifs: number;
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
  /**
   * La médiane des abonnements **terminés**, en jours.
   *
   * **La question a été tranchée en ne la tranchant pas**, et c'est mieux que ce
   * que je demandais. Une durée terminée est un fait, une durée courue est un
   * minimum : les mélanger rendrait un nombre dont personne ne peut dire ce
   * qu'il mesure. Les deux sont donc servies séparément, chacune avec son
   * effectif, et l'écran dit laquelle il affiche.
   *
   * Nulle tant qu'aucun abonnement n'est fini — jamais zéro, qui se lirait
   * « ils partent tout de suite ».
   */
  duree_mediane_terminee_jours: number | null;
  /**
   * Sur combien d'abonnements elle est calculée.
   *
   * **Sans lui, « 7 mois » se lit comme un fait quand il sort de trois
   * départs.** Il dit aussi combien on a réellement mesuré : la table n'avait
   * aucune date d'ouverture ni de fin, et les deux colonnes reprises du journal
   * ne valent que pour les commerces qui n'ont souscrit qu'une fois.
   */
  abonnements_termines: number;
  /** La médiane des durées courues des abonnements vivants. Un minimum,
   * jamais une durée de vie. Elle rend visible le biais vers le bas de
   * l'autre : on ne mesure là que ceux qui sont partis. */
  duree_mediane_en_cours_jours: number | null;
  abonnements_en_cours: number;
  /** Vide quand personne n'a souscrit : une liste de zéros par catégorie ne se
   * lit pas, et ferait croire à un échantillon là où il n'y a rien. */
  abonnes_par_categorie: AbonnesParCategorie[];
};

export type Jetons = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

// --------------------------------------------------------------------------
// reporting commerce

/**
 * Qui est autour du salon, et qui peut déjà réserver chez lui.
 *
 * **Le seul chiffre de l'écran vide qui ne parle pas du salon lui-même**, et
 * c'est ce qui rend les quatre points au-dessus dignes d'être faits. La question
 * que le gérant se pose vraiment à ce moment-là n'est pas « comment vais-je ? »,
 * c'est « est-ce qu'il y a quelqu'un ? ».
 */
export type PorteeLocale = {
  /** Créatrices dans le rayon, avec au moins un réseau rattaché. */
  createurs: number;
  /**
   * Parmi elles, celles qui ouvrent au moins un palier du salon. Jamais plus
   * grand que `createurs` : c'est la même population, filtrée. Zéro sur un
   * total non nul dit que les paliers sont trop hauts, pas que le quartier est
   * vide.
   */
  peuvent_reserver: number;
  /** « 12 créatrices » ne veut rien dire sans « dans 10 km ». */
  rayon_metres: number;
  /**
   * Les paliers **fermés**, et ce que chacun ajouterait.
   *
   * **Un gain, jamais un total** — et c'est la faute qu'il faut ne pas
   * commettre en le rendant. Les paliers déjà ouverts n'y figurent pas, et une
   * créatrice qui peut déjà réserver n'est comptée dans aucun gain : les
   * populations se recouvrent largement, une créatrice qui ouvre le reel ouvre
   * le story. La phrase de la planche — « ouvrir le post porterait ce chiffre
   * à 103 » — se compose donc `peuvent_reserver + createurs_en_plus`, jamais
   * `createurs_en_plus` seul.
   */
  gains_par_palier: GainDePalier[];
};

/** Un palier fermé, et combien de créatrices son ouverture atteindrait. */
export type GainDePalier = {
  tier_id: string;
  /** Rendus avec l'identifiant, pour écrire « le palier post » sans recharger
   *  la grille des paliers. */
  platform: Platform;
  content_format: ContentFormat;
  createurs_en_plus: number;
};
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
  /**
   * La semaine où quelque chose s'est passé pour la première fois.
   *
   * **Sans elle, l'échelle du graphique ne peut pas commencer là**, et
   * « depuis le début » demanderait d'inventer une date de départ. Nulle quand
   * rien ne s'est jamais passé — et l'écran a alors changé de nature.
   */
  premiere_semaine: string | null;
  portee_locale: PorteeLocale;
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
  /**
   * La photo, **par sa clé** — servie par `GET /media/{cle}`, jamais l'adresse
   * de la plateforme, qui expire.
   *
   * Servi par le serveur depuis l'ouverture de la route, et absent de ce type
   * jusqu'ici : l'annuaire rendait des fiches sans visage alors que la donnée
   * arrivait dans la réponse.
   */
  avatar_key: string | null;
  /**
   * Le profil public, dérivé du pseudonyme.
   *
   * Nul sur une plateforme qu'on ne sait pas rattacher, ou sans pseudonyme —
   * un lien qui mène à une page d'erreur est pire qu'un lien absent. C'est le
   * seul geste que l'annuaire propose vers une créatrice, et il sort du
   * produit : on va voir son travail chez elle.
   */
  profil_url: string | null;
};

/**
 * Ce qu'un salon abonné voit d'une créatrice.
 *
 * **Aucun score de fiabilité, et c'est une promesse tenue.** Le produit dit à la
 * créatrice, sur son écran, qu'il n'est « jamais comparé entre créatrices,
 * jamais montré à un commerce ». Le palier ouvert porte la même information sans
 * la livrer : un score dégradé la plafonnerait à un palier plus bas.
 */
/**
 * L'annuaire, et le compte qui le précède.
 *
 * **Une enveloppe, et non plus une liste nue.** À deux mille créatrices, un
 * salon ne cherche pas : il ne connaît aucun nom, donc il n'a rien à taper. Ce
 * qu'il lit d'abord est le compte. La liste seule ne pouvait porter aucun
 * total, d'où le changement de forme.
 */
export type AnnuaireDuCommerce = {
  portee: PorteeLocale;
  /**
   * Triés **par le serveur** : accès d'abord, proximité ensuite.
   *
   * Le tri ne se rejoue pas ici, et ce n'est pas une paresse : une liste
   * paginée triée dans le client se réordonne à chaque page, puisque chaque
   * page n'a que ses propres lignes à comparer. Une créatrice s'y retrouverait
   * deux fois ou jamais.
   */
  createurs: CreateurDeLAnnuaire[];
  /**
   * Combien il y en a en tout dans le rayon.
   *
   * « 20 sur 128 » demande de le savoir : une page pleine ne dit pas s'il en
   * reste, et sans ce nombre l'écran ne peut ni le dire ni s'arrêter.
   */
  total: number;
};

/** Le meilleur palier qu'une créatrice ouvre **chez ce salon**. */
export type PalierAccessibleIci = {
  tier_id: string;
  platform: Platform;
  content_format: ContentFormat;
};

export type CreateurDeLAnnuaire = {
  creator_id: string;
  /**
   * **Aucun nom d'état civil, et c'est un retrait du serveur.** L'annuaire
   * titrait « Léa Martel » — l'identité de cent vingt-huit personnes chez un
   * salon qui ne les a jamais rencontrées. Le pseudonyme est l'identité de cet
   * écran ; le nom arrive à la réservation, quand une créatrice a choisi ce
   * salon.
   */
  city: string | null;
  bio: string | null;
  comptes: CompteVuParLeCommerce[];
  paliers_ouverts: ContentFormat[];
  /**
   * Vrai quand au moins un palier de **ce salon** lui est accessible.
   *
   * Premier critère du tri, avant la distance : un créateur qui ne peut pas
   * réserver ici n'a aucune valeur pour ce salon, quel que soit son volume.
   */
  peut_reserver_ici: boolean;
  palier_accessible: PalierAccessibleIci | null;
  /**
   * Distance au salon, en mètres.
   *
   * **Nulle veut dire « on ne sait pas », jamais « loin ».** Elle passe en fin
   * de tri sans être écartée, et l'écran tait la distance plutôt que d'écrire
   * un tiret qui se lirait comme une absence de proximité.
   */
  distance_metres: number | null;
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
/**
 * Où en est une fiche préparée, du point de vue de la tournée.
 *
 * **Le vocabulaire est celui de la conduite, pas celui de la base.** Ce que le
 * démarcheur lit doit lui dire quoi faire, pas quel champ est nul — et les trois
 * états d'une fiche non activée commandent trois conduites différentes.
 */
export type EtatDeLaTournee =
  /** Préparée, jamais remise. Il reste à passer. */
  | 'prepared'
  /** Remise, jamais ouverte. **Revisiter** : une relance s'adresserait à un
   * lien que personne ne regarde. */
  | 'never_opened'
  /** Ouverte, abandonnée en route. **Relancer** : quelqu'un a regardé. */
  | 'opened_not_claimed'
  /** Ouverte, arrêtée sur l'engagement. Ni l'un ni l'autre : c'est le produit
   * qui coince, et le démarchage n'y peut rien. */
  | 'blocked_on_commitment'
  /** Assumée. La tournée a porté. */
  | 'claimed';

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
  /** Première ouverture du lien. Nulle : personne ne l'a jamais vu. */
  opened_at: string | null;
  /** Dernière prise en main tentée et refusée. */
  blocked_at: string | null;
  /**
   * L'état servi, et **jamais dérivé ici**.
   *
   * Je le calculais sur les dates ; le serveur le fait mieux et l'ordre y est
   * délicat — une fiche bloquée puis assumée est **assumée**, et regarder
   * `blocked_at` avant `used_at` afficherait « bloquée » pour toujours sur un
   * salon qui travaille. Deux dérivations de la même chose finissent par
   * diverger, et c'est celle de l'écran qui aurait tort.
   */
  etat: EtatDeLaTournee;
  /**
   * Qui a préparé la fiche.
   *
   * **Une adresse et non un nom** : un compte d'équipe n'en a pas. Les noms
   * vivent sur le profil créateur, et cet écran est interne.
   */
  prepared_by: string | null;
  /**
   * Qui a remis le lien. Nulle tant que rien n'a été remis, et **distincte de
   * la précédente** : préparer quarante fiches au bureau et en remettre vingt
   * en tournée sont deux gestes.
   */
  remis_par: string | null;
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
