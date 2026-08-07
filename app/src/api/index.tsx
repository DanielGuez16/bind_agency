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
  Booking,
  CodeDeRetrait,
  Collaboration,
  Creneau,
  EtapeActivation,
  FichePublique,
  Fil,
  FiltreDeContrepartie,
  HistoriqueDuCreateur,
  IssueDArbitrage,
  JourneeDuCommerce,
  LigneDeFile,
  PlanAdministrateur,
  PlanSouscriptible,
  Reporting,
  VerificationDuCompte,
  VueDesPaliers,
  BookingStatus,
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

  annulerLaReservation(bookingId: string) {
    return this.client.request<Booking>(routes.annulerLaReservation(bookingId), {
      methode: 'POST',
    });
  }

  codeDeRetrait(bookingId: string, signal?: AbortSignal) {
    return this.client.request<CodeDeRetrait>(routes.codeDeRetrait(bookingId), { signal });
  }

  // ---- contrepartie ----

  contrepartie(collaborationId: string, signal?: AbortSignal) {
    return this.client.request<Collaboration>(routes.contrepartie(collaborationId), { signal });
  }

  deciderCommerce(collaborationId: string, decision: { approuve: boolean; reason?: string }) {
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

  souscrire(businessId: string, planId: string) {
    return this.client.request<Abonnement>(routes.abonnement(businessId), {
      methode: 'POST',
      corps: { plan_id: planId },
    });
  }

  /** L'adresse d'une photo déposée. Jamais celle d'une preuve : la route les refuse. */
  urlDuMedia(cle: string): string {
    return routes.media(cle);
  }

  etapesDActivation(businessId: string, signal?: AbortSignal) {
    return this.client.request<EtapeActivation[]>(routes.etapesDActivation(businessId), {
      signal,
    });
  }

  activerLeCommerce(businessId: string) {
    return this.client.request<unknown>(routes.activerLeCommerce(businessId), { methode: 'POST' });
  }

  // ---- back office ----

  fileDArbitrage(signal?: AbortSignal) {
    return this.client.request<LigneDeFile[]>(routes.fileDArbitrage(), { signal });
  }

  arbitrer(collaborationId: string, decision: { issue: IssueDArbitrage; reason?: string }) {
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
