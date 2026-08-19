/**
 * Les routes, déclarées une fois.
 *
 * **Aucun chemin n'est écrit dans un écran.** Un chemin dispersé dans quinze
 * fichiers ne se renomme pas : on en oublie un, et l'oubli ne se voit qu'à
 * l'exécution, chez quelqu'un. Ici, un test compare chacune de ces routes au
 * contrat réel du serveur (`openapi.json`) et tombe si le serveur en renomme
 * une.
 *
 * Les fonctions ne font aucun appel : elles rendent un chemin. C'est ce qui
 * permet au test de les parcourir sans réseau ni serveur.
 */

/** Le préfixe du serveur. Il fait partie du contrat, pas de la configuration. */
export const PREFIXE = '/api/v1';

const chemin = (suffixe: string) => `${PREFIXE}${suffixe}`;

export const routes = {
  // ---- authentification ----
  inscription: () => chemin('/auth/register'),
  connexion: () => chemin('/auth/login'),
  rotation: () => chemin('/auth/refresh'),
  deconnexion: () => chemin('/auth/logout'),

  // ---- créateur ----
  moi: () => chemin('/me'),
  monProfil: () => chemin('/me/profile'),
  mesComptesSociaux: () => chemin('/me/social-accounts'),
  connecterInstagram: () => chemin('/me/social-accounts/instagram/connect'),
  rafraichirLesMetriques: (compteId: string) =>
    chemin(`/me/social-accounts/${compteId}/metrics/refresh`),
  mesPaliers: () => chemin('/me/tiers'),
  offresDuPalier: (tierId: string) => chemin(`/me/tiers/${tierId}/offres`),
  monAudience: () => chemin('/me/audience'),
  maVerification: () => chemin('/me/verification'),
  mesReservations: () => chemin('/me/bookings'),
  mesCommerces: () => chemin('/me/businesses'),

  // ---- notifications ----
  enregistrerUnTerminal: () => chemin('/me/devices'),
  revoquerUnTerminal: (token: string) => chemin(`/me/devices/${encodeURIComponent(token)}`),

  // ---- découverte ----
  fil: () => chemin('/businesses'),
  fichePublique: (businessId: string) => chemin(`/businesses/${businessId}`),
  disponibilite: (businessId: string) => chemin(`/businesses/${businessId}/availability`),
  resumeDeLaBande: (businessId: string) =>
    chemin(`/businesses/${businessId}/availability/summary`),

  // ---- réservation ----
  reserver: () => chemin('/bookings'),
  confirmerLaReservation: (bookingId: string) => chemin(`/bookings/${bookingId}/confirm`),
  annulerLaReservation: (bookingId: string) => chemin(`/bookings/${bookingId}/cancel`),

  // Les trois décisions du commerce. Trois chemins et non un avec un verbe en
  // corps : accepter, refuser et se désister n'ont ni les mêmes exigences ni
  // les mêmes conséquences — se désister ne pénalise pas, `no-show` si.
  accorderLaReservation: (bookingId: string) => chemin(`/bookings/${bookingId}/approve`),
  refuserLaReservation: (bookingId: string) => chemin(`/bookings/${bookingId}/decline`),
  seDesisterDeLaReservation: (bookingId: string) =>
    chemin(`/bookings/${bookingId}/cancel-by-business`),
  marquerAbsent: (bookingId: string) => chemin(`/bookings/${bookingId}/no-show`),
  codeDeRetrait: (bookingId: string) => chemin(`/bookings/${bookingId}/code`),

  // ---- caisse ----
  verifierLeCode: () => chemin('/redemptions/verify'),
  consommerLeCode: () => chemin('/redemptions/consume'),

  // ---- preuve ----
  //
  // Deux temps : demander le droit, puis lire. Une balise d'image ne porte pas
  // d'en-tête d'autorisation ; le droit voyage donc dans l'adresse, et il est
  // court.
  televerserUneCapture: () => chemin('/me/proof-uploads'),
  droitDeLireLaPreuve: (proofId: string) => chemin(`/proofs/${proofId}/access`),

  // ---- contrepartie ----
  contrepartie: (collaborationId: string) => chemin(`/collaborations/${collaborationId}`),
  soumettreLaPreuve: (collaborationId: string) =>
    chemin(`/collaborations/${collaborationId}/proof`),
  deciderCommerce: (collaborationId: string) =>
    chemin(`/business/collaborations/${collaborationId}/decision`),

  // ---- commerce ----
  creerLeCommerce: () => chemin('/business'),
  commerce: (businessId: string) => chemin(`/business/${businessId}`),
  activerLeCommerce: (businessId: string) => chemin(`/business/${businessId}/activate`),
  mettreEnPauseLeCommerce: (businessId: string) => chemin(`/business/${businessId}/pause`),
  annuaireDesCreateurs: (businessId: string) => chemin(`/business/${businessId}/creators`),
  photosDuCommerce: (businessId: string) => chemin(`/business/${businessId}/photos`),
  // La carte du commerce. **Distincte de la galerie** : la galerie montre le
  // lieu, la carte se consulte. Même mécanisme, deux gestes différents.
  carteDuCommerce: (businessId: string) => chemin(`/business/${businessId}/menu`),
  televerserUnePageDeCarte: (businessId: string) => chemin(`/business/${businessId}/menu/uploads`),
  ordreDeLaCarte: (businessId: string) => chemin(`/business/${businessId}/menu/order`),
  retirerUnePageDeCarte: (businessId: string, pageId: string) =>
    chemin(`/business/${businessId}/menu/${pageId}`),
  televerserUnePhoto: (businessId: string) => chemin(`/business/${businessId}/photos/uploads`),
  ordreDesPhotos: (businessId: string) => chemin(`/business/${businessId}/photos/order`),
  retirerUnePhoto: (businessId: string, photoId: string) =>
    chemin(`/business/${businessId}/photos/${photoId}`),
  modifierLeCommerce: (businessId: string) => chemin(`/business/${businessId}`),
  compositionDuCommerce: (businessId: string) => chemin(`/business/${businessId}/composition`),
  reperesDuVoisinage: (businessId: string) => chemin(`/business/${businessId}/neighbourhood`),
  etapesDActivation: (businessId: string) => chemin(`/business/${businessId}/activation`),
  journeeDuCommerce: (businessId: string) => chemin(`/business/${businessId}/bookings`),
  contrepartiesDuCommerce: (businessId: string) =>
    chemin(`/business/${businessId}/collaborations`),
  itemsDuCatalogue: (businessId: string) => chemin(`/business/${businessId}/catalog-items`),
  itemDuCatalogue: (businessId: string, itemId: string) =>
    chemin(`/business/${businessId}/catalog-items/${itemId}`),
  disponibiliteDUnItem: (businessId: string, itemId: string) =>
    chemin(`/business/${businessId}/catalog-items/${itemId}/availability`),
  paliersDuCommerce: (businessId: string) => chemin(`/business/${businessId}/tiers`),
  offresDePalier: (businessId: string) => chemin(`/business/${businessId}/tier-offers`),
  activationDUneOffre: (businessId: string, offreId: string) =>
    chemin(`/business/${businessId}/tier-offers/${offreId}/activation`),
  reporting: (businessId: string) => chemin(`/business/${businessId}/reporting`),
  /** Les médias qui n'appartiennent à aucun commerce : pastilles et accueil. */
  mediasPlateforme: () => chemin('/platform-media'),
  plansSouscriptibles: (businessId: string) => chemin(`/business/${businessId}/plans`),
  abonnement: (businessId: string) => chemin(`/business/${businessId}/subscription`),
  media: (cle: string) => chemin(`/media/${cle}`),
  connecterTikTok: () => chemin('/me/social-accounts/tiktok/connect'),
  reglesDeCapacite: (businessId: string) => chemin(`/business/${businessId}/capacity-rules`),
  regleDeCapacite: (businessId: string, ruleId: string) =>
    chemin(`/business/${businessId}/capacity-rules/${ruleId}`),
  exceptionsDeCapacite: (businessId: string) =>
    chemin(`/business/${businessId}/capacity-exceptions`),
  exceptionDeCapacite: (businessId: string, exceptionId: string) =>
    chemin(`/business/${businessId}/capacity-exceptions/${exceptionId}`),

  // ---- back office ----
  fileDeVerification: () => chemin('/admin/social-accounts/review'),
  deciderVerification: (compteId: string) =>
    chemin(`/admin/social-accounts/${compteId}/verification`),
  fileDArbitrage: () => chemin('/admin/collaborations/review'),
  arbitrer: (collaborationId: string) =>
    chemin(`/admin/collaborations/${collaborationId}/decision`),
  paliersAdmin: () => chemin('/admin/tiers'),
  palierAdmin: (tierId: string) => chemin(`/admin/tiers/${tierId}`),
  plans: () => chemin('/admin/plans'),
  jobsEpuises: () => chemin('/admin/jobs/exhausted'),
  relancerLeJob: (jobId: string) => chemin(`/admin/jobs/${jobId}/retry`),

  // ---- inscription sur le terrain ----
  //
  // Les trois premières sont **publiques** : le salon les appelle sans compte,
  // sur la seule possession du lien. C'est le seul endroit du produit où une
  // route d'écriture se sert sans session, et c'est le jeton qui fait toute
  // l'autorisation.
  apercuDeLaPriseEnMain: (jeton: string) => chemin(`/handover/${encodeURIComponent(jeton)}`),
  prendreEnMain: (jeton: string) => chemin(`/handover/${encodeURIComponent(jeton)}/claim`),
  rattacherLaFiche: (jeton: string) => chemin(`/handover/${encodeURIComponent(jeton)}/attach`),
  fichesPreparees: () => chemin('/admin/prospects'),
  lienDePriseEnMain: (businessId: string) =>
    chemin(`/admin/prospects/${businessId}/handover`),

  // ---- reprise d'un compte commerce ----
  repriseAdmin: (businessId: string) => chemin(`/admin/businesses/${businessId}/support-access`),
  mesReprises: (businessId: string) => chemin(`/business/${businessId}/support-access`),
} as const;

/**
 * Chaque route avec la méthode qu'elle sert. Sert au test de contrat.
 *
 * Déclaré à part plutôt que porté par chaque fonction : une fonction qui
 * rendrait `{chemin, methode}` obligerait tous les appelants à déballer, pour
 * une information dont seul le test a besoin.
 */
export const METHODES: Record<keyof typeof routes, ('GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE')[]> =
  {
    inscription: ['POST'],
    connexion: ['POST'],
    rotation: ['POST'],
    deconnexion: ['POST'],

    moi: ['GET', 'PATCH'],
    monProfil: ['GET', 'PATCH'],
    mesComptesSociaux: ['GET'],
    connecterInstagram: ['POST'],
    rafraichirLesMetriques: ['POST'],
    mesPaliers: ['GET'],
    offresDuPalier: ['GET'],
    monAudience: ['GET'],
    maVerification: ['GET'],
    mesReservations: ['GET'],
    mesCommerces: ['GET'],

    enregistrerUnTerminal: ['PUT'],
    revoquerUnTerminal: ['DELETE'],

    fil: ['GET'],
    fichePublique: ['GET'],
    disponibilite: ['GET'],
    resumeDeLaBande: ['GET'],

    reserver: ['POST'],
    confirmerLaReservation: ['POST'],
    accorderLaReservation: ['POST'],
    refuserLaReservation: ['POST'],
    seDesisterDeLaReservation: ['POST'],
    annulerLaReservation: ['POST'],
    marquerAbsent: ['POST'],
    codeDeRetrait: ['GET'],

    verifierLeCode: ['POST'],
    consommerLeCode: ['POST'],

    televerserUneCapture: ['POST'],
    droitDeLireLaPreuve: ['GET'],
    contrepartie: ['GET'],
    soumettreLaPreuve: ['POST'],
    deciderCommerce: ['POST'],

    creerLeCommerce: ['POST'],
    commerce: ['GET', 'PATCH'],
    activerLeCommerce: ['POST'],
    mettreEnPauseLeCommerce: ['POST'],
    annuaireDesCreateurs: ['GET'],
    photosDuCommerce: ['GET', 'POST'],
    carteDuCommerce: ['GET', 'POST'],
    televerserUnePageDeCarte: ['POST'],
    ordreDeLaCarte: ['PUT'],
    retirerUnePageDeCarte: ['DELETE'],
    televerserUnePhoto: ['POST'],
    ordreDesPhotos: ['PUT'],
    retirerUnePhoto: ['DELETE'],
    modifierLeCommerce: ['GET', 'PATCH'],
    compositionDuCommerce: ['GET'],
    reperesDuVoisinage: ['GET'],
    etapesDActivation: ['GET'],
    journeeDuCommerce: ['GET'],
    contrepartiesDuCommerce: ['GET'],
    itemsDuCatalogue: ['GET', 'POST'],
    itemDuCatalogue: ['GET', 'PATCH', 'DELETE'],
    disponibiliteDUnItem: ['PUT'],
    paliersDuCommerce: ['GET'],
    offresDePalier: ['GET', 'POST'],
    activationDUneOffre: ['PUT'],
    reporting: ['GET'],
    mediasPlateforme: ['GET'],
    plansSouscriptibles: ['GET'],
    abonnement: ['GET', 'POST', 'DELETE'],
    media: ['GET'],
    connecterTikTok: ['POST'],
    reglesDeCapacite: ['GET', 'POST'],
    regleDeCapacite: ['PATCH', 'DELETE'],
    exceptionsDeCapacite: ['GET', 'POST'],
    exceptionDeCapacite: ['DELETE'],

    fileDeVerification: ['GET'],
    deciderVerification: ['POST'],
    fileDArbitrage: ['GET'],
    arbitrer: ['POST'],
    paliersAdmin: ['GET', 'POST'],
    palierAdmin: ['GET', 'PATCH', 'DELETE'],
    plans: ['GET'],
    jobsEpuises: ['GET'],

    apercuDeLaPriseEnMain: ['GET'],
    prendreEnMain: ['POST'],
    rattacherLaFiche: ['POST'],
    fichesPreparees: ['GET', 'POST'],
    lienDePriseEnMain: ['POST', 'DELETE'],
    repriseAdmin: ['GET', 'POST', 'DELETE'],
    mesReprises: ['GET'],
    relancerLeJob: ['POST'],
  };
