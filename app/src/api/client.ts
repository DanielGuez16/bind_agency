/**
 * Le client d'API.
 *
 * **Un code d'erreur n'atteint jamais l'écran.** `ApiError` porte le code brut
 * pour que l'appelant puisse décider — un `booking_slot_unavailable` rouvre la
 * liste des créneaux, un `not_a_member` renvoie à l'accueil — et le message
 * affichable se demande au catalogue. Un code hors catalogue donne le message
 * générique, jamais `not_a_member` en toutes lettres devant quelqu'un qui
 * voulait réserver un soin.
 *
 * **Un seul rafraîchissement de jeton à la fois.** Trois écrans qui chargent en
 * parallèle prennent trois 401 en même temps ; sans partage, ils lanceraient
 * trois rotations, et deux d'entre elles invalideraient le jeton que la
 * troisième vient d'obtenir. La promesse en cours est partagée.
 *
 * **Un appel n'attend jamais indéfiniment.** Un réseau qui accepte la connexion
 * et ne répond plus laisserait un écran en chargement pour toujours, sans
 * erreur à afficher ni bouton à presser.
 *
 * **Le client ne connaît aucun écran.** Il ne navigue pas, il ne montre rien :
 * il rend des données ou lève. Ce qu'on fait d'un `authentication_required` est
 * une décision d'application, pas de transport.
 */
import { errorCodeFromResponse } from '../i18n/errors';
import { routes } from './routes';

export const DELAI_MS = 15_000;

/** Ce que l'app sait faire d'une erreur sans consulter le catalogue. */
export class ApiError extends Error {
  readonly status: number;
  /** Le code du catalogue fermé, ou `null` si la réponse n'en portait pas. */
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    // Le message technique ne s'affiche pas : il sert aux traces et aux tests.
    super(`api ${status}${code ? ` ${code}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Panne de transport : rien n'est parti, ou rien n'est revenu.
 *
 * Distinguée d'une erreur d'API parce que la conduite à tenir diffère : une
 * requête qui n'est jamais partie se rejoue sans risque, une qui a reçu un 409
 * non.
 */
export class NetworkError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super('network');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export type Jetons = { access_token: string; refresh_token: string };

/**
 * Où vivent les jetons.
 *
 * Une interface plutôt qu'un appel direct au stockage : les tests n'ont pas à
 * simuler un disque, et le jour où les jetons passent au trousseau sécurisé,
 * c'est une implémentation à écrire, pas un client à relire.
 */
export type CoffreDeJetons = {
  lire: () => Promise<Jetons | null>;
  ecrire: (jetons: Jetons | null) => Promise<void>;
};

export type OptionsDeRequete = {
  methode?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Sérialisé en JSON. Absent sur un GET. */
  corps?: unknown;
  /**
   * Un corps déjà formé, envoyé tel quel — un `FormData` pour un fichier.
   *
   * Distinct de `corps` parce que l'en-tête diffère : encoder une image en
   * JSON la ferait grossir d'un tiers, et poser `Content-Type` à la main sur
   * un `FormData` casse la frontière que la plateforme y écrit.
   */
  corpsBrut?: BodyInit;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  /** Une route publique n'attache pas de jeton et ne déclenche pas de rotation. */
  publique?: boolean;
  signal?: AbortSignal;
};

export type ConfigurationDuClient = {
  baseUrl: string;
  coffre: CoffreDeJetons;
  /**
   * Appelé quand la session est définitivement perdue : le rafraîchissement a
   * échoué, ou il n'y avait pas de jeton de rafraîchissement. Le client ne
   * navigue pas lui-même — il prévient, l'application décide.
   */
  surSessionPerdue?: () => void;
  delaiMs?: number;
  /** Injectable pour les tests. Par défaut, le `fetch` global. */
  fetchImpl?: typeof fetch;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly coffre: CoffreDeJetons;
  private readonly surSessionPerdue?: () => void;
  private readonly delaiMs: number;
  private readonly fetchImpl: typeof fetch;

  /** La rotation en cours, partagée par tous les appels qui prennent un 401. */
  private rotation: Promise<Jetons | null> | null = null;

  constructor(config: ConfigurationDuClient) {
    // Sans cette normalisation, une base finissant par `/` produit `//me` :
    // certains serveurs redirigent, d'autres répondent 404, et l'app se
    // comporte différemment selon la façon dont la variable a été écrite.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.coffre = config.coffre;
    this.surSessionPerdue = config.surSessionPerdue;
    this.delaiMs = config.delaiMs ?? DELAI_MS;
    // **Lié à `globalThis`, jamais retenu nu.** Un `fetch` rangé dans un
    // champ puis appelé par `this.fetchImpl(...)` reçoit l'instance comme
    // `this` ; les navigateurs le refusent — « Illegal invocation » — et la
    // requête ne part jamais. React Native, lui, l'accepte : le défaut ne se
    // voyait qu'en web, et se présentait comme une panne réseau.
    const global = config.fetchImpl ?? globalThis.fetch;
    this.fetchImpl = (...args) => global(...args);
  }

  /**
   * L'adresse complète d'une ressource.
   *
   * Nécessaire pour les images : un composant `Image` reçoit une URI, pas un
   * chemin relatif à une base qu'il ne connaît pas. Les photos ne
   * s'affichaient nulle part pour cette raison.
   */
  urlComplete(chemin: string): string {
    return `${this.baseUrl}${chemin}`;
  }

  async request<T>(chemin: string, options: OptionsDeRequete = {}): Promise<T> {
    const premiere = await this.envoyer(chemin, options);

    // 401 sur une route authentifiée : une rotation, une seule, puis on rejoue.
    if (premiere.status === 401 && !options.publique) {
      const jetons = await this.rafraichir();
      if (jetons === null) {
        this.surSessionPerdue?.();
        throw await this.erreur(premiere);
      }
      const seconde = await this.envoyer(chemin, options, jetons.access_token);
      return this.lire<T>(seconde);
    }

    return this.lire<T>(premiere);
  }

  /** Ouvre une session et range les jetons. */
  async connecter(email: string, motDePasse: string): Promise<Jetons> {
    const jetons = await this.request<Jetons>(routes.connexion(), {
      methode: 'POST',
      corps: { email, password: motDePasse },
      publique: true,
    });
    await this.coffre.ecrire(jetons);
    return jetons;
  }

  /**
   * Ferme la session **localement quoi qu'il arrive**.
   *
   * Un serveur injoignable ne doit pas laisser quelqu'un connecté sur un
   * téléphone qu'il vient de rendre. La révocation côté serveur est tentée, son
   * échec est avalé.
   */
  async deconnecter(): Promise<void> {
    const jetons = await this.coffre.lire();
    try {
      if (jetons) {
        await this.request(routes.deconnexion(), {
          methode: 'POST',
          corps: { refresh_token: jetons.refresh_token },
        });
      }
    } catch {
      // Voulu : la session locale se ferme même si le serveur ne répond pas.
    } finally {
      await this.coffre.ecrire(null);
    }
  }

  private async envoyer(
    chemin: string,
    options: OptionsDeRequete,
    jetonForce?: string,
  ): Promise<Response> {
    const jetons = options.publique ? null : await this.coffre.lire();
    const acces = jetonForce ?? jetons?.access_token;

    const entetes: Record<string, string> = { Accept: 'application/json' };
    // Jamais posé sur un corps brut : la plateforme y écrit la frontière du
    // `multipart`, et l'écraser rend le corps illisible au serveur.
    if (options.corps !== undefined) entetes['Content-Type'] = 'application/json';
    if (acces) entetes.Authorization = `Bearer ${acces}`;

    const horloge = new AbortController();
    const echeance = setTimeout(() => horloge.abort(), this.delaiMs);
    // Le signal de l'appelant et celui du délai doivent tous deux pouvoir
    // annuler : un écran quitté pendant un chargement ne doit pas attendre
    // quinze secondes de plus.
    const relais = () => horloge.abort();
    options.signal?.addEventListener('abort', relais);

    try {
      return await this.fetchImpl(this.url(chemin, options.query), {
        method: options.methode ?? 'GET',
        headers: entetes,
        body:
          options.corpsBrut ??
          (options.corps === undefined ? undefined : JSON.stringify(options.corps)),
        signal: horloge.signal,
      });
    } catch (cause) {
      // **Journalisé avant d'être enveloppé.** Sans cette ligne, un défaut de
      // programmation — un `fetch` mal lié, un en-tête invalide — se présente
      // à l'écran comme « vérifiez votre connexion », sans rien dans la
      // console et sans requête dans l'onglet réseau. C'est exactement ce qui
      // s'est produit, et ce qui a rendu la cause invisible.
      console.error('requête non partie', chemin, cause);
      throw new NetworkError(cause);
    } finally {
      clearTimeout(echeance);
      options.signal?.removeEventListener('abort', relais);
    }
  }

  private url(chemin: string, query: OptionsDeRequete['query']): string {
    const base = `${this.baseUrl}${chemin}`;
    if (!query) return base;

    const parametres = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(query)) {
      if (valeur === undefined || valeur === null) continue;
      // Un tableau devient plusieurs occurrences de la même clé : c'est ce que
      // FastAPI attend d'un paramètre répétable, et `status=held&status=confirmed`
      // est exactement ce dont l'onglet « à venir » a besoin.
      if (Array.isArray(valeur)) {
        for (const element of valeur) parametres.append(cle, element);
      } else {
        parametres.append(cle, String(valeur));
      }
    }
    const chaine = parametres.toString();
    return chaine ? `${base}?${chaine}` : base;
  }

  private async lire<T>(reponse: Response): Promise<T> {
    if (!reponse.ok) throw await this.erreur(reponse);
    if (reponse.status === 204) return undefined as T;

    try {
      return (await reponse.json()) as T;
    } catch (cause) {
      // Un 200 au corps illisible n'est pas un succès. Le laisser passer
      // rendrait `undefined` aux écrans, qui afficheraient du vide sans erreur.
      throw new NetworkError(cause);
    }
  }

  private async erreur(reponse: Response): Promise<ApiError> {
    let corps: unknown = null;
    try {
      corps = await reponse.json();
    } catch {
      // Une erreur sans corps JSON reste une erreur : le code sera nul et
      // l'écran affichera le message générique.
    }
    return new ApiError(reponse.status, errorCodeFromResponse(corps));
  }

  /** Une seule rotation vivante à la fois, partagée. */
  private async rafraichir(): Promise<Jetons | null> {
    this.rotation ??= this.faireTournerLesJetons().finally(() => {
      this.rotation = null;
    });
    return this.rotation;
  }

  private async faireTournerLesJetons(): Promise<Jetons | null> {
    const jetons = await this.coffre.lire();
    if (!jetons?.refresh_token) return null;

    try {
      const reponse = await this.envoyer(routes.rotation(), {
        methode: 'POST',
        corps: { refresh_token: jetons.refresh_token },
        publique: true,
      });
      if (!reponse.ok) {
        // Le jeton de rafraîchissement est mort : la session l'est aussi. Le
        // garder ferait retenter à chaque appel, indéfiniment.
        await this.coffre.ecrire(null);
        return null;
      }
      const neufs = (await reponse.json()) as Jetons;
      await this.coffre.ecrire(neufs);
      return neufs;
    } catch {
      // Panne réseau pendant la rotation : la session n'est pas prouvée morte,
      // on ne l'efface pas. Le prochain appel réessaiera.
      return null;
    }
  }
}
