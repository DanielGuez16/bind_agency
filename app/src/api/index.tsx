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
import { Platform } from 'react-native';

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
  TerminalEnregistre,
  Creneau,
  JourDeDisponibilite,
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
  MotifQuiRevient,
  PlanAdministrateur,
  PlanSouscriptible,
  PlateformeConnectable,
  ExceptionDeCapacite,
  ItemDuCatalogue,
  NouvelItem,
  OffreDePalier,
  OffreDuPalier,
  PalierOffrable,
  RegleDeCapacite,
  Reporting,
  Verification,
  VerificationDuCompte,
  VueDesPaliers,
  AnnuaireDuCommerce,
  CommerceDeLUtilisateur,
  CreateurDeLAnnuaire,
  PageDeLaCarte,
  PhotoDuCommerce,
  EtatDeLaComposition,
  BookingStatus,
  ApercuDeLaFiche,
  FichePreparee,
  LienRemis,
  PorteeDeReprise,
  ListeDesCommerces,
  CompteDesReprises,
  Favori,
  RepriseDuCompte,
  RepriseOuverte,
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
/**
 * Le suffixe de l'aperçu flouté, tel que le serveur le range.
 *
 * Nommé plutôt qu'écrit dans une comparaison : `storage.SUFFIXE_APERCU` porte
 * la même chaîne côté serveur, et une constante nue au milieu d'une méthode
 * finirait par diverger de lui sans que rien ne le dise.
 */
const SUFFIXE_APERCU = '@apercu';

/**
 * Un fichier local, sous la forme que la plateforme sait envoyer.
 *
 * **React Native et le web n'ont pas le même `FormData`.** En natif, on lui
 * passe `{ uri, name, type }` et le pont construit la partie multipart. Sur le
 * web, `FormData.append` suit la spécification : tout ce qui n'est ni `Blob` ni
 * `File` est **converti en chaîne**. L'objet part donc littéralement en
 * `"[object Object]"`, le serveur reçoit un champ texte là où il attend un
 * fichier, et répond `validation_failed` — « Some information is missing or
 * incorrect », qui ne dit rien de la cause.
 *
 * Mesuré contre le serveur de démonstration : champ en texte →
 * `{"detail":"validation_failed","fields":[{"loc":["body","fichier"]}]}` ;
 * vrai fichier → `{"storage_key":"…"}`.
 *
 * **Les quatre chemins de téléversement du produit étaient morts sur le web** —
 * galerie du lieu, photo de prestation, page de carte, et la capture de preuve,
 * qui est le geste par lequel une créatrice tient sa contrepartie. C'est ce
 * dernier qui rend le défaut grave : la démonstration tourne sur le build web.
 *
 * Sur le web, l'`uri` d'une image choisie est une adresse `blob:` ou `data:`
 * que `fetch` sait relire — il n'y a pas de disque à traverser.
 */
async function fichierAEnvoyer(uri: string, nom: string): Promise<Blob | { uri: string; name: string; type: string }> {
  if (Platform.OS !== 'web') return { uri, name: nom, type: 'image/jpeg' };

  const reponse = await fetch(uri);
  const donnees = await reponse.blob();
  // **Le nom voyage dans la troisième partie de `append`.** Sans lui, le
  // navigateur envoie `blob` comme nom de fichier ; le serveur lit les premiers
  // octets et ne s'y fie pas, mais un journal illisible coûte une enquête.
  return new File([donnees], nom, { type: donnees.type || 'image/jpeg' });
}

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

  /**
   * Les paliers, et ce que chacun ouvre.
   *
   * **Sans position, les comptes de proximité sont nuls** — et ils l'étaient
   * partout, parce que personne ne les demandait : le champ était rendu par le
   * serveur, lu par l'écran, et jamais alimenté. Les deux coordonnées ensemble
   * ou aucune, le serveur refusant une moitié en 422.
   */
  mesPaliers(
    options: {
      autourDe?: { longitude: number; latitude: number } | null;
      rayonMetres?: number;
    } = {},
    signal?: AbortSignal,
  ) {
    return this.client.request<VueDesPaliers>(routes.mesPaliers(), {
      query: {
        longitude: options.autourDe?.longitude,
        latitude: options.autourDe?.latitude,
        rayon_metres: options.autourDe ? options.rayonMetres : undefined,
      },
      signal,
    });
  }

  /**
   * Toutes les prestations d'un palier, sans borne de distance.
   *
   * La position est facultative et **ne borne rien** : elle ajoute seulement la
   * distance à chaque ligne. Les deux coordonnées ensemble ou aucune — le
   * serveur refuse une moitié en 422, et c'est mieux qu'un silence.
   */
  offresDuPalier(
    tierId: string,
    autourDe?: { longitude: number; latitude: number } | null,
    signal?: AbortSignal,
  ) {
    return this.client.request<OffreDuPalier[]>(routes.offresDuPalier(tierId), {
      query: { longitude: autourDe?.longitude, latitude: autourDe?.latitude },
      signal,
    });
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
    options: { rayonMetres?: number; categorie?: string; recherche?: string } = {},
    signal?: AbortSignal,
  ) {
    return this.client.request<Fil>(routes.fil(), {
      query: {
        longitude: autourDe.longitude,
        latitude: autourDe.latitude,
        rayon_metres: options.rayonMetres,
        categorie: options.categorie,
        // **Servie depuis des jours, et sans aucun bouton.** La route accepte
        // `recherche` ; l'écran n'avait pas de quoi la remplir, donc une
        // capacité entière du produit n'existait pour personne.
        recherche: options.recherche?.trim() || undefined,
      },
      signal,
    });
  }

  fichePublique(businessId: string, signal?: AbortSignal) {
    return this.client.request<FichePublique>(routes.fichePublique(businessId), { signal });
  }

  /**
   * Les débuts possibles, sur l'horizon demandé.
   *
   * **`jours` existait sur la route et personne ne le passait.** La bande de
   * quatorze jours a été annoncée comme coûtant quatorze appels ; elle en coûte
   * un. Le serveur borne à 90, et l'appel sans borne prend l'horizon de
   * réservation configuré.
   *
   * Elle rend les **heures**. L'état des jours vient de `resumeDeLaBande`, à
   * côté : une route qui rendrait les deux ferait payer le parcours complet des
   * règles de capacité pour une bande qui n'a besoin que de comptes.
   */
  disponibilite(
    businessId: string,
    catalogItemId: string,
    signal?: AbortSignal,
    jours?: number,
  ) {
    return this.client.request<Creneau[]>(routes.disponibilite(businessId), {
      query: { catalog_item_id: catalogItemId, ...(jours ? { jours: String(jours) } : {}) },
      signal,
    });
  }

  /**
   * La bande de quatorze jours : un état et un compte par journée locale.
   *
   * **Une route, pas quatorze appels à la précédente.** L'écran dessine la
   * bande avant qu'on choisisse un jour ; la demander jour par jour ferait
   * quatorze parcours des mêmes règles de capacité pour un écran qu'on ouvre à
   * chaque réservation.
   */
  resumeDeLaBande(
    businessId: string,
    catalogItemId: string,
    jours: number,
    signal?: AbortSignal,
  ) {
    return this.client.request<JourDeDisponibilite[]>(routes.resumeDeLaBande(businessId), {
      query: { catalog_item_id: catalogItemId, jours: String(jours) },
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

  // ---- caisse ----
  //
  // **Passées par le client, comme tout le reste.** La caisse construisait ses
  // deux requêtes elle-même, avec un jeton brut lu une fois à l'ouverture de
  // l'écran. Au bout de quinze minutes ce jeton expirait, le serveur répondait
  // 401, et l'écran affichait « authentification requise » à la caisse — sans
  // rotation, sans retour à la connexion, sans issue. Ici, un 401 fait tourner
  // les jetons et rejoue ; s'il persiste, la session se ferme et l'écran de
  // connexion s'affiche, comme partout ailleurs.

  verifierUnCode(code: string) {
    return this.client.request<Verification>(routes.verifierLeCode(), {
      methode: 'POST',
      corps: { code },
    });
  }

  consommerUnCode(redemptionCodeId: string) {
    return this.client.request<unknown>(routes.consommerLeCode(), {
      methode: 'POST',
      corps: { redemption_code_id: redemptionCodeId },
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
  async televerserUneCapture(uri: string) {
    const corps = new FormData();
    // Le nom et le type sont indicatifs : le serveur lit les premiers octets,
    // il ne les croit pas. Voir `fichierAEnvoyer` pour ce qui distingue le web.
    corps.append('fichier', (await fichierAEnvoyer(uri, 'capture.jpg')) as Blob);

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
  /**
   * Les commerces dont je suis membre.
   *
   * **Le fuseau est servi depuis toujours et n'était pas déclaré ici.** Sans
   * lui, chaque écran retombait sur celui de l'appareil, ce qui n'a de
   * conséquence visible que le jour où le gérant voyage — et la règle du
   * produit convertit sur le fuseau du commerce, parce que tout ce qu'il lit
   * s'y passe.
   */
  mesCommerces(signal?: AbortSignal) {
    return this.client.request<CommerceDeLUtilisateur[]>(routes.mesCommerces(), { signal });
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

  ouvrirUneReprise(
    businessId: string,
    motif: string,
    portee: PorteeDeReprise[],
    spontanee = true,
  ) {
    return this.client.request<RepriseOuverte>(routes.repriseAdmin(businessId), {
      methode: 'POST',
      corps: { reason: motif, scope: portee, spontaneous: spontanee },
    });
  }

  /**
   * Combien de reprises **l'appelant** a ouvertes, tous salons confondus.
   *
   * **Avant l'appui, et c'est toute la raison de cette route.** Le même nombre
   * arrive sur la réponse à l'ouverture ; lu là, il retient pour la fois
   * suivante — c'est-à-dire qu'il fait ce qu'un journal fait, et un journal
   * enregistre un abus sans l'empêcher. Ce qui retient est de se comparer à
   * soi-même pendant qu'on écrit encore le motif.
   *
   * Sans identifiant de salon : le compte doit vivre avant qu'un salon soit
   * choisi, puisque l'écran le pose au-dessus du champ de motif.
   */
  // ---- favoris ----

  /** La liste des prestations mises de côté, la plus récente d'abord. */
  /** Vrai si ce mot de passe est bien celui du compte. Ne touche pas au coffre. */
  verifierLeMotDePasse(email: string, motDePasse: string) {
    return this.client.verifierLeMotDePasse(email, motDePasse);
  }

  mesFavoris(signal?: AbortSignal) {
    return this.client.request<Favori[]>(routes.mesFavoris(), { signal });
  }

  /**
   * Pose le favori. **Le second appui ne fait rien et ne se plaint pas.**
   *
   * Le cœur est un interrupteur : un 409 au second appui obligerait l'écran à
   * traiter comme une erreur ce qui est le résultat voulu — la prestation est
   * en favori.
   */
  mettreEnFavori(catalogItemId: string) {
    return this.client.request<void>(routes.mesFavoris(), {
      methode: 'POST',
      corps: { catalog_item_id: catalogItemId },
    });
  }

  /** Retire le favori. Sans erreur s'il n'y en avait pas. */
  retirerDesFavoris(catalogItemId: string) {
    return this.client.request<void>(routes.unFavori(catalogItemId), { methode: 'DELETE' });
  }

  /**
   * Les salons que l'administration peut reprendre.
   *
   * **Tous les états**, et non les seuls ouverts : un salon en inscription est
   * celui qu'on vient débloquer, un suspendu celui dont on vient comprendre
   * pourquoi. La recherche porte sur le nom, sans accent ni casse.
   */
  commercesAdmin(recherche?: string, signal?: AbortSignal) {
    return this.client.request<ListeDesCommerces>(
      routes.commercesAdmin(),
      { signal, query: recherche ? { recherche } : undefined },
    );
  }

  mesReprisesRecentes(signal?: AbortSignal) {
    return this.client.request<CompteDesReprises>(routes.mesReprisesRecentes(), { signal });
  }

  fermerLaReprise(businessId: string) {
    return this.client.request<void>(routes.repriseAdmin(businessId), { methode: 'DELETE' });
  }

  /**
   * **Le salon met dehors, et n'a personne à convaincre.**
   *
   * Toutes les reprises qui courent chez lui, pas une : lui demander laquelle
   * serait lui demander de savoir combien de personnes sont entrées. Sans
   * erreur quand il n'y en avait aucune — « il n'y avait rien à fermer » est
   * le résultat voulu par quelqu'un qui veut être sûr que la porte est close.
   */
  refermerLaReprise(businessId: string) {
    return this.client.request<void>(routes.mesReprises(businessId), { methode: 'DELETE' });
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

  /**
   * Arrêter l'abonnement.
   *
   * **La route existait, le client ne la couvrait pas.** Souscrire sans pouvoir
   * arrêter enferme : c'est la moitié d'une paire, et celle qui manquait est
   * celle qui rassure au moment de commencer.
   */
  resilier(businessId: string) {
    return this.client.request<Abonnement>(routes.abonnement(businessId), {
      methode: 'DELETE',
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

  /**
   * L'adresse de la **vignette** d'une image. Pour les listes et les cartes.
   *
   * La vignette est produite au dépôt et rangée sous une clé dérivée : il n'y a
   * rien à demander au serveur pour la connaître, et rien à stocker à côté. Les
   * images déposées avant ce changement n'en ont pas — la route des médias sert
   * alors l'original, ce qui est moins bien que la vignette et infiniment mieux
   * qu'un trou.
   *
   * **Le détail garde l'original.** Une fiche ouverte en plein écran montre la
   * photo telle que le commerce l'a envoyée ; c'est la liste qui n'a jamais eu
   * besoin de quatre mille pixels.
   */
  urlDeLaVignette(cle: string | null): string | undefined {
    return cle ? this.client.urlComplete(routes.media(`${cle}@vignette`)) : undefined;
  }

  /**
   * La vignette d'un portrait, **sauf quand la clé est déjà un aperçu flouté**.
   *
   * **Le gain n'est pas dans les octets.** `Image` décode avant de réduire :
   * une photo occupe sa taille en pixels en mémoire quel que soit le cadre où
   * on la pose. Vingt portraits d'origine dans des cadres de 132 points font
   * accrocher le défilement avant même que le réseau soit en cause — le même
   * changement sur le mur a mesuré 10,5 Mo contre 1,5.
   *
   * **Un aperçu ne se resuffixe pas**, et c'est la seule raison pour laquelle
   * la clé partait nue. Le dépôt d'un avatar range trois clés — l'original, sa
   * vignette et son aperçu flouté — mais il n'y a pas de vignette *de
   * l'aperçu*. Demander `@apercu@vignette` ne casse rien : la route voit la
   * terminaison, la retire, trouve l'aperçu et sert la bonne image. Elle
   * **gaspille** une lecture de dépôt par portrait, vingt par ouverture
   * d'annuaire, pour rendre exactement ce qu'une clé nue aurait rendu.
   *
   * **La clé nue n'a jamais été un arbitrage contre la vignette.** La chronologie
   * le dit : le repli de la route date du 14 août, la vignette d'avatar du 21 au
   * soir, et la grille de l'annuaire du 22 au matin. Les deux existaient quand
   * le choix a été fait — c'était la forme juste dans le cas dangereux, prise
   * faute de pouvoir séparer les deux cas. Les séparer est tout ce que cette
   * méthode fait.
   */
  urlDuPortrait(cle: string | null): string | undefined {
    if (!cle) return undefined;
    return cle.endsWith(SUFFIXE_APERCU) ? this.urlDuMedia(cle) : this.urlDeLaVignette(cle);
  }

  /**
   * L'annuaire d'un salon, page par page.
   *
   * Le décalage plutôt qu'un curseur : le tri est stable — accès, puis
   * distance, puis identifiant — et la liste ne bouge pas sous la pagination
   * à l'échelle d'une consultation. Un curseur coûterait un champ opaque à
   * transporter pour un gain qui ne se voit pas ici.
   */
  annuaireDesCreateurs(
    businessId: string,
    options: { limite?: number; decalage?: number } = {},
    signal?: AbortSignal,
  ) {
    return this.client.request<AnnuaireDuCommerce>(routes.annuaireDesCreateurs(businessId), {
      query: { limite: options.limite, decalage: options.decalage },
      signal,
    });
  }

  /** Le commerce lui-même. Lu ici pour sa couverture, qui marque la galerie. */
  commerce(businessId: string, signal?: AbortSignal) {
    return this.client.request<{ cover_photo_key: string | null; menu_url: string | null }>(
      routes.commerce(businessId),
      {
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
  /**
   * La photo d'une prestation : déposée, puis posée sur l'article.
   *
   * **Deux appels, et il en fallait deux.** Le dépôt rend une clé, le correctif
   * la range sur l'article — `photo_key` était déclarée corrigeable depuis le
   * début et aucun écran ne savait produire de clé. Une capacité déclarée que
   * rien ne sait exercer n'est pas une capacité, c'est un champ.
   *
   * **La route de dépôt est celle de la galerie**, et c'est correct : elle
   * range un fichier sous le préfixe du commerce et rend sa clé, sans rien
   * décider de ce qu'on en fait. C'est la seconde moitié — poser la clé dans
   * la galerie — que cette méthode ne fait pas.
   */
  async photographierUnItem(businessId: string, itemId: string, uri: string) {
    const corps = new FormData();
    corps.append('fichier', (await fichierAEnvoyer(uri, 'photo.jpg')) as Blob);

    const { storage_key } = await this.client.request<{ storage_key: string }>(
      routes.televerserUnePhoto(businessId),
      { methode: 'POST', corpsBrut: corps },
    );

    return this.modifierUnItem(businessId, itemId, { photo_key: storage_key });
  }

  async ajouterUnePhoto(businessId: string, uri: string) {
    const corps = new FormData();
    // Le nom et le type sont indicatifs : le serveur lit les premiers octets.
    // Voir `fichierAEnvoyer` pour ce qui distingue le web du natif.
    corps.append('fichier', (await fichierAEnvoyer(uri, 'photo.jpg')) as Blob);

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

  // ---- la carte du commerce ----
  //
  // **Distincte de la galerie**, et jumelle par le mécanisme. La galerie montre
  // le lieu : on la fait défiler, on se fait une idée, on passe. La carte se
  // consulte : on l'ouvre pour y chercher un plat et un prix. Deux gestes
  // différents, donc deux entrées sur la fiche — les mêler ferait chercher une
  // entrecôte entre deux photos de salle.

  pagesDeLaCarte(businessId: string, signal?: AbortSignal) {
    return this.client.request<PageDeLaCarte[]>(routes.carteDuCommerce(businessId), { signal });
  }

  /** Dépose la page, puis l'ajoute à la carte. Deux appels, comme la galerie. */
  async ajouterUnePageDeCarte(businessId: string, uri: string) {
    const corps = new FormData();
    corps.append('fichier', (await fichierAEnvoyer(uri, 'carte.jpg')) as Blob);

    const { storage_key } = await this.client.request<{ storage_key: string }>(
      routes.televerserUnePageDeCarte(businessId),
      { methode: 'POST', corpsBrut: corps },
    );

    return this.client.request<PageDeLaCarte>(routes.carteDuCommerce(businessId), {
      methode: 'POST',
      corps: { storage_key },
    });
  }

  ordonnerLaCarte(businessId: string, pages: string[]) {
    return this.client.request<PageDeLaCarte[]>(routes.ordreDeLaCarte(businessId), {
      methode: 'PUT',
      corps: { pages },
    });
  }

  retirerUnePageDeCarte(businessId: string, pageId: string) {
    return this.client.request<void>(routes.retirerUnePageDeCarte(businessId, pageId), {
      methode: 'DELETE',
    });
  }

  /**
   * Le lien vers la carte en ligne. **Un champ du commerce**, comme la
   * couverture : la route qui le change existe déjà, et en créer une seconde
   * ferait deux vérités. `null` le retire.
   */
  definirLeLienDeLaCarte(businessId: string, url: string | null) {
    return this.client.request<unknown>(routes.modifierLeCommerce(businessId), {
      methode: 'PATCH',
      corps: { menu_url: url },
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


  /**
   * Le commerce constate une absence. **Motif obligatoire** : il pénalise
   * quelqu'un, et l'événement de fiabilité ne se retire pas.
   *
   * Le serveur refuse avant le délai. L'écran ouvre le bouton sur
   * `absence_signalable_a`, mais c'est l'horloge du serveur qui décide — celle
   * du téléphone n'est pas une preuve.
   */
  marquerAbsent(bookingId: string, motif: string) {
    return this.client.request<Booking>(routes.marquerAbsent(bookingId), {
      methode: 'POST',
      corps: { reason: motif },
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

  /**
   * La liste que le salon travaille — **sans les archives**, par défaut.
   *
   * Une archive n'a plus rien à recevoir : la laisser ferait grossir l'écran
   * de prestations qu'on ne refera pas. `avecArchives` la ramène pour l'écran
   * qui les montre exprès.
   */
  itemsDuCatalogue(businessId: string, signal?: AbortSignal, avecArchives = false) {
    const chemin = routes.itemsDuCatalogue(businessId);
    return this.client.request<ItemDuCatalogue[]>(
      avecArchives ? `${chemin}?avec_archives=true` : chemin,
      { signal },
    );
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

  /**
   * Retirer une prestation pour de bon.
   *
   * **Archiver n'est pas fermer, et ce n'est pas supprimer non plus.** Fermer
   * dit « pas en ce moment » et se rouvre ; archiver dit « plus jamais » et ne
   * se rouvre pas — le serveur refuse par `catalog_item_already_archived`.
   * Supprimer n'existe qu'à zéro réservation : au-delà, laisser les
   * réservations pointer vers rien réécrirait leur histoire.
   */
  archiverUnItem(businessId: string, itemId: string) {
    return this.client.request<ItemDuCatalogue>(routes.archiverUnItem(businessId, itemId), {
      methode: 'POST',
    });
  }

  /**
   * Créer la remplaçante et archiver l'ancienne, dans la même transaction.
   *
   * Pour ce qui ne se corrige pas en place : durée, palier, contrepartie.
   * Douze réservations citent une prestation de quarante-cinq minutes, et la
   * passer à soixante-quinze réécrirait leur histoire — la neuve porte le
   * changement, l'ancienne garde la sienne.
   *
   * Rend la **nouvelle** : c'est celle sur laquelle on continue.
   */
  remplacerUnItem(businessId: string, itemId: string, item: NouvelItem) {
    return this.client.request<ItemDuCatalogue>(routes.remplacerUnItem(businessId, itemId), {
      methode: 'POST',
      corps: item,
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

  /**
   * Limiter les places d'un jour précis, sans toucher à la semaine type.
   *
   * **La même donnée que la semaine, pas un second modèle.** Une exception est
   * une ligne d'exception sur une date ; l'écran de la journée y écrit comme
   * l'écran des horaires, et rien ne se duplique.
   */
  limiterLesPlaces(businessId: string, date: string, places: number) {
    return this.client.request<ExceptionDeCapacite>(routes.exceptionsDeCapacite(businessId), {
      methode: 'POST',
      corps: { date, is_closed: false, concurrent_slots: places },
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

  /**
   * Les motifs qui bouclent, du plus fréquent au moins fréquent.
   *
   * **L'ordre vient du serveur et ne se rejoue pas ici.** Il trie sur le
   * nombre de dossiers qui bouclent ; retrier sur le rapport à
   * `dossiers_touches` ferait remonter un motif vu deux fois, ce qui est du
   * bruit et non un signal.
   */
  motifsQuiReviennent(signal?: AbortSignal) {
    return this.client.request<MotifQuiRevient[]>(routes.motifsQuiReviennent(), { signal });
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
