/**
 * Le client d'API, tel que les écrans le voient.
 *
 * **Un écran ne construit jamais une requête.** Il appelle une méthode nommée,
 * qui rend un type. C'est ce qui permet de renommer une route côté serveur en
 * touchant un seul fichier, et de vérifier par un test que toutes les routes
 * appelées existent réellement.
 *
 * **Un écran ne traduit jamais une erreur lui-même.** `useApi().messageDErreur`
 * prend ce qui a été levé et rend une phrase — code du catalogue, message
 * générique pour un code inconnu, message de réseau pour une panne de
 * transport. Aucun écran n'a à connaître la forme d'une réponse d'erreur.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useI18n } from '../i18n';
import { translateErrorCode } from '../i18n/errors';
import { ApiClient, ApiError, NetworkError, type CoffreDeJetons, type Jetons } from './client';
import { routes } from './routes';
import type {
  Abonnement,
  AudienceDuCompte,
  AutorisationDemarree,
  Booking,
  BusinessCategory,
  CodeDeRetrait,
  Collaboration,
  GenreDeNotification,
  PlateformeDeTerminal,
  PreferencesDeNotification,
  TerminalEnregistre,
  Creneau,
  DroitDeLecture,
  EtapeActivation,
  VueDActivation,
  FichePublique,
  Fil,
  FiltreDeContrepartie,
  HistoriqueDuCreateur,
  IssueDArbitrage,
  JourneeDuCommerce,
  LigneDeFile,
  PlanAdministrateur,
  PlanSouscriptible,
  PlateformeConnectable,
  ExceptionDeCapacite,
  ItemDuCatalogue,
  NouvelItem,
  OffreDePalier,
  PalierOffrable,
  RegleDeCapacite,
  Reporting,
  VerificationDuCompte,
  VueDesPaliers,
  CreateurDeLAnnuaire,
  PhotoDuCommerce,
  EtatDeLaComposition,
  BookingStatus,
  MediasPlateforme,
  ApercuDeLaFiche,
  FichePreparee,
  LienRemis,
  RepriseDuCompte,
  StatutDuCommerce,
} from './types';

export * from './types';
export { ApiClient, ApiError, NetworkError, type CoffreDeJetons, type Jetons } from './client';
export { PREFIXE, routes } from './routes';

const CLE_JETONS = 'bind.tokens';

/** Le coffre par défaut : le stockage local de l'appareil. */
export const coffreAsyncStorage: CoffreDeJetons = {
  async lire() {
    const brut = await AsyncStorage.getItem(CLE_JETONS);
    if (!brut) return null;
    try {
      return JSON.parse(brut) as Jetons;
    } catch {
      // Un stockage corrompu vaut une absence de session, pas un plantage au
      // démarrage : on repart d'une connexion.
      return null;
    }
  },
  async ecrire(jetons) {
    if (jetons === null) await AsyncStorage.removeItem(CLE_JETONS);
    else await AsyncStorage.setItem(CLE_JETONS, JSON.stringify(jetons));
  },
};

/**
 * L'API du produit, méthode par méthode.
 *
 * Chaque méthode dit ce qu'elle rend. Les paramètres portent le nom de ce
 * qu'ils sont, pas celui du champ de requête : `autourDe` plutôt que
 * `longitude/latitude` séparés, `statuts` plutôt que `status` répété.
 */
export class Api {
  constructor(private readonly client: ApiClient) {}

  // ---- session ----

  connecter(email: string, motDePasse: string) {
    return this.client.connecter(email, motDePasse);
  }

  deconnecter() {
    return this.client.deconnecter();
  }

  // ---- créateur ----

  mesPaliers(signal?: AbortSignal) {
    return this.client.request<VueDesPaliers>(routes.mesPaliers(), { signal });
  }

  monAudience(signal?: AbortSignal) {
    return this.client.request<AudienceDuCompte[]>(routes.monAudience(), { signal });
  }

  /**
   * Ouvre une autorisation et rend l'adresse où envoyer la personne.
   *
   * Deux routes déclarées côté serveur plutôt qu'une route générique : une
   * route par plateforme dit exactement ce qui est branché, et Snapchat ne
   * l'est pas. Le choix se fait donc ici, pas dans une chaîne de caractères.
   */
  /**
   * `retour` est l'adresse à laquelle le serveur renverra une fois le compte
   * rattaché. Sans elle, le parcours se termine sur la réponse du rappel, dans
   * le navigateur — ce qui convient au web et à rien d'autre.
   */
  connecterUnReseau(plateforme: PlateformeConnectable, retour?: string, signal?: AbortSignal) {
    const chemin =
      plateforme === 'instagram' ? routes.connecterInstagram() : routes.connecterTikTok();
    return this.client.request<AutorisationDemarree>(chemin, {
      methode: 'POST',
      corps: { return_url: retour ?? null },
      signal,
    });
  }

  maVerification(signal?: AbortSignal) {
    return this.client.request<VerificationDuCompte[]>(routes.maVerification(), { signal });
  }

  mesReservations(
    options: { statuts?: BookingStatus[]; avant?: string; limite?: number } = {},
    signal?: AbortSignal,
  ) {
    return this.client.request<HistoriqueDuCreateur>(routes.mesReservations(), {
      // `status` répétable : un onglet « à venir » couvre `held` et
      // `confirmed`, et deux appels obligeraient l'app à fusionner deux pages
      // triées séparément.
      query: { status: options.statuts, avant: options.avant, limite: options.limite },
      signal,
    });
  }

  // ---- découverte ----

  fil(
    autourDe: { longitude: number; latitude: number },
    options: { rayonMetres?: number; categorie?: string } = {},
    signal?: AbortSignal,
  ) {
    return this.client.request<Fil>(routes.fil(), {
      query: {
        longitude: autourDe.longitude,
        latitude: autourDe.latitude,
        rayon_metres: options.rayonMetres,
        categorie: options.categorie,
      },
      signal,
    });
  }

  fichePublique(businessId: string, signal?: AbortSignal) {
    return this.client.request<FichePublique>(routes.fichePublique(businessId), { signal });
  }

  disponibilite(businessId: string, catalogItemId: string, signal?: AbortSignal) {
    return this.client.request<Creneau[]>(routes.disponibilite(businessId), {
      query: { catalog_item_id: catalogItemId },
      signal,
    });
  }

  // ---- réservation ----

  reserver(demande: {
    tier_offer_id: string;
    social_account_id: string;
    starts_at?: string | null;
  }) {
    return this.client.request<Booking>(routes.reserver(), {
      methode: 'POST',
      corps: demande,
    });
  }

  confirmerLaReservation(bookingId: string) {
    return this.client.request<Booking>(routes.confirmerLaReservation(bookingId), {
      methode: 'POST',
    });
  }

  /** Le commerce accepte. Aucun motif : il n'y a rien à justifier à dire oui. */
  accorderLaReservation(bookingId: string) {
    return this.client.request<Booking>(routes.accorderLaReservation(bookingId), {
      methode: 'POST',
    });
  }

  /** Le commerce refuse. Le motif est lu par la créatrice, il est obligatoire. */
  refuserLaReservation(bookingId: string, motif: string) {
    return this.client.request<Booking>(routes.refuserLaReservation(bookingId), {
      methode: 'POST',
      corps: { reason: motif },
    });
  }

  /**
   * Le commerce se désiste d'une réservation déjà acceptée.
   *
   * Distincte de l'absence, et ce n'est pas une nuance de vocabulaire : celle-ci
   * ne pénalise jamais la créatrice.
   */
  seDesisterDeLaReservation(bookingId: string, motif: string) {
    return this.client.request<Booking>(routes.seDesisterDeLaReservation(bookingId), {
      methode: 'POST',
      corps: { reason: motif },
    });
  }

  annulerLaReservation(bookingId: string) {
    return this.client.request<Booking>(routes.annulerLaReservation(bookingId), {
      methode: 'POST',
    });
  }

  codeDeRetrait(bookingId: string, signal?: AbortSignal) {
    return this.client.request<CodeDeRetrait>(routes.codeDeRetrait(bookingId), { signal });
  }

  /**
   * Soumet la preuve, une fois la capture déposée.
   *
   * Deux appels et non un : le téléversement échoue pour des raisons qui n'ont
   * rien à voir avec la contrepartie — réseau, poids, format — et les mêler
   * ferait remonter « preuve refusée » pour une image trop lourde.
   */
  soumettreLaPreuve(
    collaborationId: string,
    corps: { screenshot_key?: string; source_url?: string; note?: string },
  ) {
    return this.client.request<Collaboration>(routes.soumettreLaPreuve(collaborationId), {
      methode: 'POST',
      corps,
    });
  }

  /**
   * Dépose une capture et rend sa clé.
   *
   * Passe par `FormData` et non par le corps JSON du client : une image ne
   * s'encode pas en JSON sans la faire grossir d'un tiers, sur un réseau qui
   * est souvent celui d'un salon.
   */
  televerserUneCapture(uri: string) {
    const corps = new FormData();
    // La forme attendue par React Native pour un fichier local. Le nom et le
    // type sont indicatifs : le serveur lit les premiers octets, il ne les
    // croit pas.
    corps.append('fichier', {
      uri,
      name: 'capture.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);

    return this.client.request<{ screenshot_key: string }>(routes.televerserUneCapture(), {
      methode: 'POST',
      corpsBrut: corps,
    });
  }

  /**
   * Le droit de regarder une preuve, pour quelques minutes.
   *
   * L'adresse rendue est relative : elle est complétée ici, comme celle d'un
   * média, pour qu'une balise d'image puisse l'ouvrir directement.
   */
  async droitDeLireLaPreuve(proofId: string, signal?: AbortSignal) {
    const droit = await this.client.request<DroitDeLecture>(
      routes.droitDeLireLaPreuve(proofId),
      { signal },
    );
    return { ...droit, url: this.client.urlComplete(droit.url) };
  }

  // ---- contrepartie ----

  contrepartie(collaborationId: string, signal?: AbortSignal) {
    return this.client.request<Collaboration>(routes.contrepartie(collaborationId), { signal });
  }

  /**
   * Approuver, ou redemander avec un motif — et, facultativement, une note.
   *
   * **La note ne remplace jamais le motif.** Le serveur refuse une note seule,
   * jusque dans une contrainte de base ; le type le dit à sa façon en gardant
   * `reason` là où il était.
   */
  deciderCommerce(
    collaborationId: string,
    decision: { approuve: boolean; reason?: string; note?: string },
  ) {
    return this.client.request<Collaboration>(routes.deciderCommerce(collaborationId), {
      methode: 'POST',
      corps: decision,
    });
  }

  // ---- commerce ----

  journeeDuCommerce(businessId: string, jour?: string, signal?: AbortSignal) {
    return this.client.request<JourneeDuCommerce>(routes.journeeDuCommerce(businessId), {
      query: { jour },
      signal,
    });
  }

  contrepartiesDuCommerce(
    businessId: string,
    filtre?: FiltreDeContrepartie,
    signal?: AbortSignal,
  ) {
    return this.client.request<LigneDeFile[]>(routes.contrepartiesDuCommerce(businessId), {
      // Sans filtre, la liste rend tout — `unfulfilled` compris, qu'aucun
      // onglet ne couvre.
      query: { filtre },
      signal,
    });
  }

  /** Les commerces dont l'appelant est membre. Une liste, jamais un objet. */
  mesCommerces(signal?: AbortSignal) {
    return this.client.request<{ id: string; name: string }[]>(routes.mesCommerces(), {
      signal,
    });
  }

  /**
   * Crée le commerce et en fait l'appelant propriétaire, d'un seul tenant.
   *
   * La route existait depuis la première phase et **rien ne l'appelait** : un
   * membre qui venait de s'inscrire tombait sur un onglet d'attente sans issue,
   * et le seul moyen d'obtenir un commerce était qu'on le lui prépare depuis le
   * mode terrain. C'était un produit à une seule porte d'entrée.
   */
  creerMonCommerce(corps: {
    name: string;
    category: BusinessCategory;
    currency: string;
    address: string | null;
    phone: string | null;
  }) {
    return this.client.request<{ id: string; name: string }>(routes.creerLeCommerce(), {
      methode: 'POST',
      corps,
    });
  }

  // ---- notifications ----

  /**
   * Inscrit ou réactive ce terminal. **Idempotent, et rappelé à chaque
   * démarrage** : un jeton Expo change quand l'application est réinstallée,
   * et une route qui créerait une ligne par appel en accumulerait une par
   * ouverture. D'où le `PUT`.
   */
  enregistrerUnTerminal(corps: { token: string; platform: PlateformeDeTerminal }) {
    return this.client.request<TerminalEnregistre>(routes.enregistrerUnTerminal(), {
      methode: 'PUT',
      corps,
    });
  }

  revoquerUnTerminal(token: string) {
    return this.client.request<void>(routes.revoquerUnTerminal(token), { methode: 'DELETE' });
  }

  mesPreferencesDeNotification(signal?: AbortSignal) {
    return this.client.request<PreferencesDeNotification>(
      routes.mesPreferencesDeNotification(),
      { signal },
    );
  }

  reglerUnePreference(genre: GenreDeNotification, enabled: boolean) {
    return this.client.request<PreferencesDeNotification>(routes.reglerUnePreference(genre), {
      methode: 'PUT',
      corps: { enabled },
    });
  }

  // ---- inscription sur le terrain ----

  /**
   * Ce qui a été préparé pour ce salon. **Sans session** : il n'a pas encore de
   * compte, et le jeton fait toute l'autorisation.
   */
  apercuDeLaPriseEnMain(jeton: string, signal?: AbortSignal) {
    return this.client.request<ApercuDeLaFiche>(routes.apercuDeLaPriseEnMain(jeton), {
      signal,
      publique: true,
    });
  }

  /**
   * Le salon crée son compte et devient propriétaire de sa fiche.
   *
   * Il ne repart pas connecté : la réponse est la fiche, pas une session. C'est
   * voulu — un lien qui ouvrirait une session serait un mot de passe.
   */
  prendreEnMain(
    jeton: string,
    donnees: {
      email: string;
      motDePasse: string;
      versionDesConditions: string;
      langue?: 'en' | 'es';
    },
  ) {
    return this.client.request<{ id: string; name: string; status: StatutDuCommerce }>(routes.prendreEnMain(jeton), {
      methode: 'POST',
      corps: {
        email: donnees.email,
        password: donnees.motDePasse,
        terms_version: donnees.versionDesConditions,
        ...(donnees.langue ? { locale: donnees.langue } : {}),
      },
      publique: true,
    });
  }

  /** Un compte commerce qui existe déjà assume la fiche. Le deuxième salon. */
  rattacherLaFiche(jeton: string, versionDesConditions: string) {
    return this.client.request<{ id: string; name: string; status: StatutDuCommerce }>(routes.rattacherLaFiche(jeton), {
      methode: 'POST',
      corps: { terms_version: versionDesConditions },
    });
  }

  /** Les fiches préparées et l'état de leur lien. La mesure du démarchage. */
  fichesPreparees(signal?: AbortSignal) {
    return this.client.request<FichePreparee[]>(routes.fichesPreparees(), { signal });
  }

  preparerUneFiche(corps: Record<string, unknown>) {
    return this.client.request<{ id: string; name: string; status: StatutDuCommerce }>(routes.fichesPreparees(), {
      methode: 'POST',
      corps,
    });
  }

  /** Émet le lien, et **ferme le précédent**. L'adresse n'est rendue qu'ici. */
  emettreLeLien(businessId: string, canal: 'qr' | 'email', destination?: string) {
    return this.client.request<LienRemis>(routes.lienDePriseEnMain(businessId), {
      methode: 'POST',
      corps: { channel: canal, ...(destination ? { destination } : {}) },
    });
  }

  revoquerLeLien(businessId: string) {
    return this.client.request<void>(routes.lienDePriseEnMain(businessId), {
      methode: 'DELETE',
    });
  }

  // ---- reprise d'un compte commerce ----

  /** Ce que **le salon** lit des reprises faites chez lui. */
  mesReprises(businessId: string, signal?: AbortSignal) {
    return this.client.request<RepriseDuCompte[]>(routes.mesReprises(businessId), { signal });
  }

  ouvrirUneReprise(businessId: string, motif: string) {
    return this.client.request<RepriseDuCompte>(routes.repriseAdmin(businessId), {
      methode: 'POST',
      corps: { reason: motif },
    });
  }

  fermerLaReprise(businessId: string) {
    return this.client.request<void>(routes.repriseAdmin(businessId), { methode: 'DELETE' });
  }

  reporting(
    businessId: string,
    options: { depuis?: string; jusquA?: string } = {},
    signal?: AbortSignal,
  ) {
    return this.client.request<Reporting>(routes.reporting(businessId), {
      query: { depuis: options.depuis, jusqu_a: options.jusquA },
      signal,
    });
  }

  /** Les pastilles de catégorie et les médias d'accueil, en un appel. */
  mediasPlateforme(signal?: AbortSignal) {
    return this.client.request<MediasPlateforme>(routes.mediasPlateforme(), { signal });
  }

  abonnement(businessId: string, signal?: AbortSignal) {
    // `null` est une réponse valide : ne pas être abonné est un état normal du
    // commerce, pas une ressource absente.
    return this.client.request<Abonnement | null>(routes.abonnement(businessId), { signal });
  }

  plansSouscriptibles(businessId: string, signal?: AbortSignal) {
    return this.client.request<PlanSouscriptible[]>(routes.plansSouscriptibles(businessId), {
      signal,
    });
  }

  souscrire(businessId: string, planId: string) {
    return this.client.request<Abonnement>(routes.abonnement(businessId), {
      methode: 'POST',
      corps: { plan_id: planId },
    });
  }

  /**
   * L'adresse complète d'une photo déposée.
   *
   * Absolue, parce qu'un composant `Image` ne connaît pas la base de l'API.
   * Publique, parce qu'il ne sait pas non plus porter un en-tête
   * d'autorisation. Jamais celle d'une preuve : la route refuse tout préfixe
   * autre que `photos/`.
   */
  urlDuMedia(cle: string | null): string | undefined {
    return cle ? this.client.urlComplete(routes.media(cle)) : undefined;
  }

  annuaireDesCreateurs(businessId: string, signal?: AbortSignal) {
    return this.client.request<CreateurDeLAnnuaire[]>(routes.annuaireDesCreateurs(businessId), {
      signal,
    });
  }

  /** Le commerce lui-même. Lu ici pour sa couverture, qui marque la galerie. */
  commerce(businessId: string, signal?: AbortSignal) {
    return this.client.request<{ cover_photo_key: string | null }>(routes.commerce(businessId), {
      signal,
    });
  }

  photosDuCommerce(businessId: string, signal?: AbortSignal) {
    return this.client.request<PhotoDuCommerce[]>(routes.photosDuCommerce(businessId), { signal });
  }

  /**
   * Dépose le fichier, puis l'ajoute à la galerie. Deux appels, pas un.
   *
   * Le téléversement peut échouer pour des raisons qui n'ont rien à voir avec
   * la galerie — réseau, poids, format — et les mêler ferait remonter
   * « galerie pleine » pour une image trop lourde. Le serveur les sépare, le
   * client suit la même coupure.
   */
  async ajouterUnePhoto(businessId: string, uri: string) {
    const corps = new FormData();
    // La forme attendue par React Native pour un fichier local. Le nom et le
    // type sont indicatifs : le serveur lit les premiers octets.
    corps.append('fichier', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);

    const { storage_key } = await this.client.request<{ storage_key: string }>(
      routes.televerserUnePhoto(businessId),
      { methode: 'POST', corpsBrut: corps },
    );

    return this.client.request<PhotoDuCommerce>(routes.photosDuCommerce(businessId), {
      methode: 'POST',
      corps: { storage_key },
    });
  }

  ordonnerLesPhotos(businessId: string, photos: string[]) {
    return this.client.request<PhotoDuCommerce[]>(routes.ordreDesPhotos(businessId), {
      methode: 'PUT',
      corps: { photos },
    });
  }

  retirerUnePhoto(businessId: string, photoId: string) {
    return this.client.request<void>(routes.retirerUnePhoto(businessId, photoId), {
      methode: 'DELETE',
    });
  }

  /** La couverture est un champ du commerce, pas de la galerie : la route qui
   *  la change existe déjà, et en créer une seconde ferait deux vérités. */
  definirLaCouverture(businessId: string, cle: string) {
    return this.client.request<unknown>(routes.modifierLeCommerce(businessId), {
      methode: 'PATCH',
      corps: { cover_photo_key: cle },
    });
  }

  compositionDuCommerce(businessId: string, signal?: AbortSignal) {
    return this.client.request<EtatDeLaComposition>(routes.compositionDuCommerce(businessId), {
      signal,
    });
  }

  etapesDActivation(businessId: string, signal?: AbortSignal) {
    return this.client.request<VueDActivation>(routes.etapesDActivation(businessId), {
      signal,
    });
  }

  /** Le commerce se retire du fil, sans rien perdre. Réversible. */
  mettreEnPauseLeCommerce(businessId: string) {
    return this.client.request<unknown>(routes.mettreEnPauseLeCommerce(businessId), {
      methode: 'POST',
    });
  }

  activerLeCommerce(businessId: string) {
    return this.client.request<unknown>(routes.activerLeCommerce(businessId), { methode: 'POST' });
  }

  // ---- composition : catalogue, paliers offerts, horaires ----

  itemsDuCatalogue(businessId: string, signal?: AbortSignal) {
    return this.client.request<ItemDuCatalogue[]>(routes.itemsDuCatalogue(businessId), { signal });
  }

  creerUnItem(businessId: string, item: NouvelItem) {
    return this.client.request<ItemDuCatalogue>(routes.itemsDuCatalogue(businessId), {
      methode: 'POST',
      corps: item,
    });
  }

  modifierUnItem(businessId: string, itemId: string, champs: Partial<NouvelItem>) {
    return this.client.request<ItemDuCatalogue>(routes.itemDuCatalogue(businessId, itemId), {
      methode: 'PATCH',
      corps: champs,
    });
  }

  /**
   * Ouvrir ou fermer une prestation.
   *
   * Sa propre route, et non un champ du correctif : c'est une transition
   * d'état, elle laisse une trace au journal. Deux chemins pour la même
   * transition finiraient par diverger.
   */
  ouvrirLItem(businessId: string, itemId: string, ouvert: boolean) {
    return this.client.request<void>(routes.disponibiliteDUnItem(businessId, itemId), {
      methode: 'PUT',
      corps: { is_available: ouvert },
    });
  }

  supprimerUnItem(businessId: string, itemId: string) {
    return this.client.request<void>(routes.itemDuCatalogue(businessId, itemId), {
      methode: 'DELETE',
    });
  }

  paliersDuCommerce(businessId: string, signal?: AbortSignal) {
    return this.client.request<PalierOffrable[]>(routes.paliersDuCommerce(businessId), { signal });
  }

  offresDePalier(businessId: string, signal?: AbortSignal) {
    return this.client.request<OffreDePalier[]>(routes.offresDePalier(businessId), { signal });
  }

  offrirAuPalier(businessId: string, tierId: string, catalogItemId: string) {
    return this.client.request<OffreDePalier>(routes.offresDePalier(businessId), {
      methode: 'POST',
      corps: { tier_id: tierId, catalog_item_id: catalogItemId },
    });
  }

  activerUneOffre(businessId: string, offreId: string, active: boolean) {
    return this.client.request<OffreDePalier>(routes.activationDUneOffre(businessId, offreId), {
      methode: 'PUT',
      corps: { is_active: active },
    });
  }

  reglesDeCapacite(businessId: string, signal?: AbortSignal) {
    return this.client.request<RegleDeCapacite[]>(routes.reglesDeCapacite(businessId), { signal });
  }

  creerUneRegle(businessId: string, regle: Omit<RegleDeCapacite, 'id' | 'business_id'>) {
    return this.client.request<RegleDeCapacite>(routes.reglesDeCapacite(businessId), {
      methode: 'POST',
      corps: regle,
    });
  }

  modifierUneRegle(
    businessId: string,
    ruleId: string,
    champs: Partial<Omit<RegleDeCapacite, 'id' | 'business_id' | 'weekday'>>,
  ) {
    return this.client.request<RegleDeCapacite>(routes.regleDeCapacite(businessId, ruleId), {
      methode: 'PATCH',
      corps: champs,
    });
  }

  supprimerUneRegle(businessId: string, ruleId: string) {
    return this.client.request<void>(routes.regleDeCapacite(businessId, ruleId), {
      methode: 'DELETE',
    });
  }

  exceptionsDeCapacite(businessId: string, signal?: AbortSignal) {
    return this.client.request<ExceptionDeCapacite[]>(routes.exceptionsDeCapacite(businessId), {
      signal,
    });
  }

  fermerUneJournee(businessId: string, date: string) {
    return this.client.request<ExceptionDeCapacite>(routes.exceptionsDeCapacite(businessId), {
      methode: 'POST',
      corps: { date, is_closed: true },
    });
  }

  supprimerUneException(businessId: string, exceptionId: string) {
    return this.client.request<void>(routes.exceptionDeCapacite(businessId, exceptionId), {
      methode: 'DELETE',
    });
  }

  // ---- back office ----

  fileDArbitrage(signal?: AbortSignal) {
    return this.client.request<LigneDeFile[]>(routes.fileDArbitrage(), { signal });
  }

  arbitrer(
    collaborationId: string,
    decision: { issue: IssueDArbitrage; reason?: string; note?: string },
  ) {
    return this.client.request<Collaboration>(routes.arbitrer(collaborationId), {
      methode: 'POST',
      corps: decision,
    });
  }

  plans(signal?: AbortSignal) {
    return this.client.request<PlanAdministrateur[]>(routes.plans(), { signal });
  }
}

// --------------------------------------------------------------------------

type ApiValue = {
  api: Api;
  /**
   * Ce qu'on montre à l'utilisateur, quoi qu'il ait été levé.
   *
   * Un code inconnu donne le message générique, jamais le code brut : personne
   * ne sait ce que veut dire `not_a_member`, et l'afficher revient à ne rien
   * dire tout en ayant l'air de dire quelque chose.
   */
  messageDErreur: (erreur: unknown) => string;
};

const ApiContext = createContext<ApiValue | null>(null);

export function ApiProvider({
  children,
  client,
}: {
  children: ReactNode;
  /** Injectable pour les tests et pour la démo, plus tard. */
  client: ApiClient;
}) {
  const { t } = useI18n();

  const value = useMemo<ApiValue>(
    () => ({
      api: new Api(client),
      messageDErreur: (erreur: unknown) => {
        // Une panne de transport n'est pas une erreur d'API : la phrase à dire
        // n'est pas la même, et « réessaie » n'a de sens que dans ce cas-là.
        if (erreur instanceof NetworkError) return t('errors.network');
        if (erreur instanceof ApiError) return translateErrorCode(t, erreur.code);
        return t('errors.generic');
      },
    }),
    [client, t],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiValue {
  const value = useContext(ApiContext);
  if (value === null) {
    // Lever plutôt que fabriquer un client silencieux : un écran rendu hors du
    // fournisseur taperait sur une base d'URL vide et n'échouerait qu'au
    // premier appel réseau, loin de la cause.
    throw new Error('useApi hors de ApiProvider');
  }
  return value;
}
