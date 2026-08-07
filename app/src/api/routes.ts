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
  monAudience: () => chemin('/me/audience'),
  maVerification: () => chemin('/me/verification'),
  mesReservations: () => chemin('/me/bookings'),

  // ---- découverte ----
  fil: () => chemin('/businesses'),
  fichePublique: (businessId: string) => chemin(`/businesses/${businessId}`),
  disponibilite: (businessId: string) => chemin(`/businesses/${businessId}/availability`),

  // ---- réservation ----
  reserver: () => chemin('/bookings'),
  confirmerLaReservation: (bookingId: string) => chemin(`/bookings/${bookingId}/confirm`),
  annulerLaReservation: (bookingId: string) => chemin(`/bookings/${bookingId}/cancel`),
  marquerAbsent: (bookingId: string) => chemin(`/bookings/${bookingId}/no-show`),
  codeDeRetrait: (bookingId: string) => chemin(`/bookings/${bookingId}/code`),

  // ---- caisse ----
  verifierLeCode: () => chemin('/redemptions/verify'),
  consommerLeCode: () => chemin('/redemptions/consume'),

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
  etapesDActivation: (businessId: string) => chemin(`/business/${businessId}/activation`),
  journeeDuCommerce: (businessId: string) => chemin(`/business/${businessId}/bookings`),
  contrepartiesDuCommerce: (businessId: string) =>
    chemin(`/business/${businessId}/collaborations`),
  itemsDuCatalogue: (businessId: string) => chemin(`/business/${businessId}/catalog-items`),
  offresDePalier: (businessId: string) => chemin(`/business/${businessId}/tier-offers`),
  activationDUneOffre: (businessId: string, offreId: string) =>
    chemin(`/business/${businessId}/tier-offers/${offreId}/activation`),
  reporting: (businessId: string) => chemin(`/business/${businessId}/reporting`),
  plansSouscriptibles: (businessId: string) => chemin(`/business/${businessId}/plans`),
  abonnement: (businessId: string) => chemin(`/business/${businessId}/subscription`),
  media: (cle: string) => chemin(`/media/${cle}`),
  connecterTikTok: () => chemin('/me/social-accounts/tiktok/connect'),
  reglesDeCapacite: (businessId: string) => chemin(`/business/${businessId}/capacity-rules`),
  exceptionsDeCapacite: (businessId: string) =>
    chemin(`/business/${businessId}/capacity-exceptions`),

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
    monAudience: ['GET'],
    maVerification: ['GET'],
    mesReservations: ['GET'],

    fil: ['GET'],
    fichePublique: ['GET'],
    disponibilite: ['GET'],

    reserver: ['POST'],
    confirmerLaReservation: ['POST'],
    annulerLaReservation: ['POST'],
    marquerAbsent: ['POST'],
    codeDeRetrait: ['GET'],

    verifierLeCode: ['POST'],
    consommerLeCode: ['POST'],

    contrepartie: ['GET'],
    soumettreLaPreuve: ['POST'],
    deciderCommerce: ['POST'],

    creerLeCommerce: ['POST'],
    commerce: ['GET', 'PATCH'],
    activerLeCommerce: ['POST'],
    etapesDActivation: ['GET'],
    journeeDuCommerce: ['GET'],
    contrepartiesDuCommerce: ['GET'],
    itemsDuCatalogue: ['POST'],
    offresDePalier: ['GET', 'POST'],
    activationDUneOffre: ['PUT'],
    reporting: ['GET'],
    plansSouscriptibles: ['GET'],
    abonnement: ['GET', 'POST', 'DELETE'],
    media: ['GET'],
    connecterTikTok: ['POST'],
    reglesDeCapacite: ['GET', 'POST'],
    exceptionsDeCapacite: ['GET', 'POST'],

    fileDeVerification: ['GET'],
    deciderVerification: ['POST'],
    fileDArbitrage: ['GET'],
    arbitrer: ['POST'],
    paliersAdmin: ['GET', 'POST'],
    palierAdmin: ['GET', 'PATCH', 'DELETE'],
    plans: ['GET'],
    jobsEpuises: ['GET'],
    relancerLeJob: ['POST'],
  };
