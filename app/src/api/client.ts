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
import { champsEnCause, codesEnCause, errorCodeFromResponse } from '../i18n/errors';
import { routes } from './routes';

export const DELAI_MS = 15_000;

/** Ce que l'app sait faire d'une erreur sans consulter le catalogue. */
export class ApiError extends Error {
  readonly status: number;
  /** Le code du catalogue fermé, ou `null` si la réponse n'en portait pas. */
  readonly code: string | null;
  /**
   * Les champs que le serveur met en cause, quand il en nomme.
   *
   * **Il en nommait, et personne ne les lisait.** Un refus de validation arrive
   * avec `fields: [{ loc: ['body', 'email'] }]` ; l'écran affichait « Some
   * information is missing or incorrect » et laissait chercher lequel. C'est le
   * seul refus du produit dont la cause est connue et n'était pas dite.
   */
  readonly champs: string[];
  /**
   * Les codes que le serveur porte sur ces champs, quand il en porte.
   *
   * **Ils manquaient, et six messages en dépendaient.** `passwords.py` lève
   * `password_too_short` ; le handler 422 gardait `loc` et `type` et jetait le
   * reste, si bien que l'écran ne pouvait que nommer le champ. Les phrases qui
   * disent quoi corriger existaient dans les deux catalogues sans lecteur.
   */
  readonly codes: string[];

  constructor(
    status: number,
    code: string | null,
    champs: string[] = [],
    codes: string[] = [],
  ) {
    // Le message technique ne s'affiche pas : il sert aux traces et aux tests.
    super(`api ${status}${code ? ` ${code}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.champs = champs;
    this.codes = codes;
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
  /**
   * Ce qui est parti, sur ce qu'il y a à envoyer, entre 0 et 1.
   *
   * **Présente, elle change de transport.** `fetch` ne rapporte rien de la
   * montée d'un corps ; seul `XMLHttpRequest` émet `upload.onprogress`. Le
   * chemin JSON reste sur `fetch` — il n'a rien à rapporter, et une seconde
   * implémentation pour tout le produit serait deux comportements à tenir.
   *
   * Le seul endroit du produit où l'attente est assez longue pour qu'un filet
   * qui parcourt mente sur ce qui se passe : une photo sur le réseau d'un salon
   * prend des secondes, et un filet qui boucle dit « ça travaille » sans dire
   * si l'on est au début ou à la fin.
   */
  progression?: (part: number) => void;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  /** Une route publique n'attache pas de jeton et ne déclenche pas de rotation. */
  publique?: boolean;
  signal?: AbortSignal;
};

/**
 * Ce qu'une tentative de rotation a appris.
 *
 * **Trois issues et non deux, parce que « pas de jetons » recouvrait deux
 * choses opposées.** Un serveur qui refuse le jeton de rafraîchissement dit que
 * la session est finie ; un serveur injoignable ne dit rien du tout. Les deux
 * rendaient `null`, et l'appelant en tirait la même conclusion : il jetait
 * dehors quelqu'un qui passait sous un tunnel, et il gardait sur place
 * quelqu'un dont la session était morte.
 */
type Rotation =
  | { readonly quoi: 'jetons'; readonly jetons: Jetons }
  /** Le serveur a refusé, ou il n'y avait rien à faire tourner. */
  | { readonly quoi: 'morte' }
  /** On ne sait pas : la question n'est pas arrivée jusqu'au serveur. */
  | { readonly quoi: 'injoignable'; readonly cause: unknown };

export type ConfigurationDuClient = {
  baseUrl: string;
  coffre: CoffreDeJetons;
  /**
   * Appelé quand la session est **prouvée** perdue : le serveur a refusé le
   * jeton de rafraîchissement, il n'y en avait pas, ou l'appel rejoué avec un
   * jeton tout neuf a repris un 401. Le client ne navigue pas lui-même — il
   * prévient, l'application décide.
   *
   * Jamais sur une panne de réseau : ne pas pouvoir poser la question n'est pas
   * une réponse.
   */
  surSessionPerdue?: () => void;
  delaiMs?: number;
  /** Injectable pour les tests. Par défaut, le `fetch` global. */
  fetchImpl?: typeof fetch;
  /**
   * Le transport des envois de fichier, quand une progression est demandée.
   *
   * **Injectable pour la même raison que `fetchImpl`.** Le chemin `XMLHttpRequest`
   * ne passe pas par `fetch` — c'est tout son intérêt — donc un double qui ne
   * remplace que `fetch` n'intercepte plus rien des quatre téléversements, et
   * les tests attendent une réponse qui ne vient jamais. Le défaut ne se voit
   * qu'à l'expiration d'un `waitFor`, ce qui ne dit pas la cause.
   *
   * Par défaut, l'envoi réel. En test, on passe le même double que `fetchImpl`.
   */
  envoiImpl?: (options: OptionsDEnvoi) => Promise<Response>;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly coffre: CoffreDeJetons;
  private readonly surSessionPerdue?: () => void;
  private readonly delaiMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly envoiImpl: (options: OptionsDEnvoi) => Promise<Response>;

  /** La rotation en cours, partagée par tous les appels qui prennent un 401. */
  private rotation: Promise<Rotation> | null = null;

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
    // **Le repli est `fetch`, pas une erreur.** Un environnement sans
    // `XMLHttpRequest` — Node nu, un rendu serveur — doit envoyer le fichier
    // quand même : il perdra la progression, pas la photo.
    // **Un double de `fetch` remplace tout le réseau, envois compris.** Sans
    // cela, un test qui injecte `fetchImpl` verrait ses trois requêtes JSON
    // interceptées et son téléversement partir pour de bon — la panne se lit
    // alors comme un `waitFor` qui expire, qui ne dit rien de la cause.
    this.envoiImpl =
      config.envoiImpl ??
      (config.fetchImpl || typeof XMLHttpRequest === 'undefined'
        ? (o) =>
            this.fetchImpl(o.url, {
              method: o.methode,
              headers: o.entetes,
              body: o.corps,
              signal: o.signal,
            })
        : envoyerAvecProgression);
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
      const rotation = await this.rafraichir();

      // **Injoignable n'est pas mort.** On ne ferme pas une session parce
      // qu'un train est entré dans un tunnel : l'écran dit qu'il n'a pas pu
      // charger, et le prochain appel repose la question.
      if (rotation.quoi === 'injoignable') throw new NetworkError(rotation.cause);

      if (rotation.quoi === 'morte') {
        this.surSessionPerdue?.();
        throw await this.erreur(premiere);
      }

      const seconde = await this.envoyer(chemin, options, rotation.jetons.access_token);

      // **Un 401 sur l'appel rejoué ferme la session, lui aussi.** Le jeton
      // vient d'être émis : s'il est refusé, ce n'est plus une question
      // d'expiration — un compte suspendu répond exactement ainsi, et l'API ne
      // le distingue nulle part ailleurs. Sans ce chemin, l'erreur remontait à
      // l'écran, qui affichait un message et un bouton « réessayer » que rien
      // ne pouvait faire aboutir.
      if (seconde.status === 401) {
        await this.coffre.ecrire(null);
        this.surSessionPerdue?.();
      }
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
   * Vrai si ce mot de passe est bien celui du compte.
   *
   * **Le coffre n'est pas touché.** `connecter` range les jetons, ce qui
   * ferait tourner la session en cours pour une simple vérification. Ici on ne
   * garde rien : on demande au serveur s'il accepte, et on jette la réponse.
   *
   * **Par la route de connexion, faute de mieux.** La suppression de compte ne
   * prend pas de corps ; c'est là qu'un mot de passe devrait être vérifié, et
   * c'est demandé. En attendant, la seule vérification honnête disponible est
   * celle-ci — un champ qui accepterait n'importe quoi aurait l'air d'un
   * contrôle sans en être un, ce qui est pire qu'un champ absent.
   */
  async verifierLeMotDePasse(email: string, motDePasse: string): Promise<boolean> {
    try {
      await this.request<Jetons>(routes.connexion(), {
        methode: 'POST',
        corps: { email, password: motDePasse },
        publique: true,
      });
      return true;
    } catch {
      return false;
    }
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
    /**
     * **Pourquoi la requête s'est arrêtée**, et non seulement qu'elle l'a fait.
     *
     * Les trois causes se ressemblent à l'arrivée — `fetch` lève la même
     * `AbortError` — et n'ont rien en commun. Une annulation par l'appelant est
     * le fonctionnement normal : on change d'écran, on change de filtre, la
     * requête en vol ne sert plus. Une échéance dépassée est une panne. Une
     * levée inattendue est un défaut de programmation.
     *
     * Sans cette distinction, toutes trois s'écrivaient `console.error` :
     * `/businesses` et `/business/{id}/collaborations` remplissaient la console
     * d'erreurs rouges à chaque changement d'onglet, et la vraie panne s'y
     * noyait — ce qui rend un journal inutile est le bruit, pas le silence.
     */
    let motif: 'appelant' | 'echeance' | null = null;

    const echeance = setTimeout(() => {
      motif = 'echeance';
      horloge.abort();
    }, this.delaiMs);
    /**
     * **L'échéance ne retient pas le processus.**
     *
     * Elle existe pour couper une requête qui traîne, jamais pour tenir une
     * boucle d'événements ouverte. La différence ne se voit pas dans
     * l'application — il y a toujours autre chose qui la tient — mais elle se
     * voit sous Node : une requête qui n'aboutit pas garde son minuteur en vol
     * jusqu'au bout du délai, et le worker Jest qui l'héberge ne peut pas
     * sortir. C'était l'une des trois causes de « A worker process has failed
     * to exit gracefully », à chaque exécution de la suite.
     *
     * L'annulation, elle, éteint déjà le minuteur par le `finally` — mais rien
     * n'annule une écriture : un `POST` dont la réponse n'arrive pas n'est lié
     * à aucun démontage d'écran, et c'est exactement le décor qui sépare
     * l'optimiste de l'attente.
     *
     * `unref` n'existe ni sur le web ni en React Native, où le minuteur est un
     * nombre. L'appel est donc facultatif, et sans effet là-bas.
     */
    (echeance as unknown as { unref?: () => void }).unref?.();
    // Le signal de l'appelant et celui du délai doivent tous deux pouvoir
    // annuler : un écran quitté pendant un chargement ne doit pas attendre
    // quinze secondes de plus.
    const relais = () => {
      motif = 'appelant';
      horloge.abort();
    };
    options.signal?.addEventListener('abort', relais);
    // **Un signal déjà avorté n'émettra plus rien.** L'appelant peut annuler
    // avant que la requête parte — le temps de lire le coffre, un écran a pu
    // être quitté. S'abonner ne suffit alors pas : l'événement est passé, et
    // la requête serait partie pour de bon, à attendre son échéance.
    if (options.signal?.aborted) relais();

    try {
      if (options.progression && options.corpsBrut !== undefined) {
        return await this.envoiImpl({
          url: this.url(chemin, options.query),
          methode: options.methode ?? 'POST',
          entetes,
          corps: options.corpsBrut,
          signal: horloge.signal,
          progression: options.progression,
        });
      }
      return await this.fetchImpl(this.url(chemin, options.query), {
        method: options.methode ?? 'GET',
        headers: entetes,
        body:
          options.corpsBrut ??
          (options.corps === undefined ? undefined : JSON.stringify(options.corps)),
        signal: horloge.signal,
      });
    } catch (cause) {
      // **Journalisé avant d'être enveloppé**, mais selon ce qui s'est passé.
      //
      // Sans journal du tout, un défaut de programmation — un `fetch` mal lié,
      // un en-tête invalide — se présente à l'écran comme « vérifiez votre
      // connexion », sans rien dans la console et sans requête dans l'onglet
      // réseau. C'est exactement ce qui s'est produit une fois.
      //
      // Mais tout journaliser en erreur revient au même : une annulation au
      // changement d'écran est le fonctionnement normal, elle arrivait à
      // chaque geste, et la vraie panne se noyait dedans.
      if (motif === 'appelant') {
        // Rien. L'appelant sait qu'il a annulé — c'est lui qui l'a demandé.
        throw new NetworkError(cause);
      }
      if (motif === 'echeance') {
        // Une panne, mais une panne connue et nommée : le serveur a accepté la
        // connexion et n'a pas répondu dans le délai. `warn` la distingue d'un
        // défaut de programmation sans la cacher.
        console.warn('requête expirée', chemin, `${this.delaiMs} ms`);
        throw new NetworkError(cause);
      }
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
    return new ApiError(
      reponse.status,
      errorCodeFromResponse(corps),
      champsEnCause(corps),
      codesEnCause(corps),
    );
  }

  /** Une seule rotation vivante à la fois, partagée. */
  private async rafraichir(): Promise<Rotation> {
    this.rotation ??= this.faireTournerLesJetons().finally(() => {
      this.rotation = null;
    });
    return this.rotation;
  }

  private async faireTournerLesJetons(): Promise<Rotation> {
    const jetons = await this.coffre.lire();
    if (!jetons?.refresh_token) return { quoi: 'morte' };

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
        return { quoi: 'morte' };
      }
      const neufs = (await reponse.json()) as Jetons;
      await this.coffre.ecrire(neufs);
      return { quoi: 'jetons', jetons: neufs };
    } catch (cause) {
      // Panne réseau pendant la rotation : la session n'est pas prouvée morte,
      // on ne l'efface pas et on ne renvoie personne à l'écran de connexion.
      // Le prochain appel réessaiera.
      return { quoi: 'injoignable', cause };
    }
  }
}

/**
 * Un envoi de fichier qui dit où il en est.
 *
 * **`XMLHttpRequest` et non `fetch`, et seulement ici.** `fetch` n'expose
 * aucune progression de montée : son `ReadableStream` descend, jamais l'inverse.
 * XHR reste le seul transport du web à émettre `upload.onprogress`, et React
 * Native l'implémente aussi.
 *
 * **La réponse est imitée, pas construite.** Le client ne lit que `ok`, `status`
 * et `json()` : rendre autre chose serait promettre une `Response` qui n'en est
 * pas une, et le jour où quelqu'un lirait `headers` il trouverait `undefined`
 * sans savoir pourquoi.
 *
 * **`lengthComputable` n'est pas garanti.** Un serveur derrière un proxy qui
 * réécrit la taille, ou un corps dont la plateforme ne connaît pas la longueur,
 * n'en donne aucune. On ne rapporte alors rien plutôt qu'un nombre inventé :
 * l'écran garde son « ça travaille », qui est vrai, au lieu d'une barre qui
 * avance au hasard.
 */
export type OptionsDEnvoi = {
  url: string;
  methode: string;
  entetes: Record<string, string>;
  corps: BodyInit;
  signal: AbortSignal;
  progression: (part: number) => void;
};

function envoyerAvecProgression(options: OptionsDEnvoi): Promise<Response> {
  return new Promise((resoudre, rejeter) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.methode, options.url);
    for (const [nom, valeur] of Object.entries(options.entetes)) {
      xhr.setRequestHeader(nom, valeur);
    }

    xhr.upload.onprogress = (evenement) => {
      if (!evenement.lengthComputable || evenement.total === 0) return;
      options.progression(Math.min(1, evenement.loaded / evenement.total));
    };

    xhr.onload = () => {
      const texte = xhr.responseText;
      resoudre({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => (texte ? JSON.parse(texte) : null),
      } as Response);
    };

    // **Trois façons de ne pas aboutir, une seule erreur.** Le client au-dessus
    // sait déjà distinguer l'annulation de l'échéance par son propre motif ;
    // lui rendre trois erreurs distinctes ferait deux tables à tenir.
    xhr.onerror = () => rejeter(new Error('réseau'));
    xhr.ontimeout = () => rejeter(new Error('réseau'));
    xhr.onabort = () => rejeter(new Error('annulé'));

    const couper = () => xhr.abort();
    if (options.signal.aborted) {
      couper();
      return;
    }
    options.signal.addEventListener('abort', couper);
    xhr.onloadend = () => options.signal.removeEventListener('abort', couper);

    xhr.send(options.corps);
  });
}
