/**
 * Le client d'API.
 *
 * Deux familles de tests, et la première est celle qui compte.
 *
 * **Le contrat.** Chaque route que le client appelle est comparée au contrat
 * réel du serveur, extrait de son OpenAPI. Une route renommée côté API ne se
 * découvre autrement qu'à l'exécution, sur l'appareil de quelqu'un, sous un
 * 404 que l'écran traduira en « quelque chose s'est mal passé ».
 *
 * **Le comportement.** Un code d'erreur n'atteint jamais l'écran ; une seule
 * rotation de jeton vit à la fois ; un appel n'attend pas indéfiniment ; une
 * déconnexion ferme la session même si le serveur ne répond pas.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiClient, ApiError, NetworkError, type CoffreDeJetons } from '../src/api/client';
import { ApiProvider, useApi } from '../src/api';
import { METHODES, PREFIXE, routes } from '../src/api/routes';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { NOTE_MAXIMUM } from '../src/screens/PublicationsScreen';

const CONTRAT = JSON.parse(
  readFileSync(join(__dirname, '..', 'src', 'api', 'openapi.json'), { encoding: 'utf-8' }),
) as { paths: Record<string, Record<string, unknown>> };

/** Remplace les segments variables par le gabarit `{param}` de l'OpenAPI. */
const GABARITS: Record<string, string> = {
  business_id: 'business_id',
  collaboration_id: 'collaboration_id',
  booking_id: 'booking_id',
  tier_id: 'tier_id',
  offer_id: 'offer_id',
  job_id: 'job_id',
  account_id: 'account_id',
};

/** Un identifiant reconnaissable, pour retrouver la place des paramètres. */
const JETON = '00000000-0000-4000-8000-000000000001';

function coffre(initial: { access_token: string; refresh_token: string } | null = null) {
  let contenu = initial;
  return {
    lire: async () => contenu,
    ecrire: async (jetons: typeof contenu) => {
      contenu = jetons;
    },
    get contenu() {
      return contenu;
    },
  };
}

function reponse(status: number, corps: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corps,
  } as Response;
}

// --------------------------------------------------------------------------
// Contrat
// --------------------------------------------------------------------------

describe('contrat avec le serveur', () => {
  /**
   * Appelle chaque route avec des identifiants factices et rend le chemin
   * ramené au gabarit de l'OpenAPI.
   */
  function cheminsAppeles(): { nom: string; chemin: string }[] {
    return Object.entries(routes).map(([nom, fabrique]) => {
      const arite = (fabrique as (...args: string[]) => string).length;
      const chemin = (fabrique as (...args: string[]) => string)(
        ...(Array.from({ length: arite }, () => JETON) as string[]),
      );
      return { nom, chemin };
    });
  }

  /** Un chemin concret devient le gabarit `/business/{business_id}/...`. */
  function versGabarit(chemin: string, connus: string[]): string | null {
    const segments = chemin.split('/');
    for (const gabarit of connus) {
      const attendus = gabarit.split('/');
      if (attendus.length !== segments.length) continue;
      const correspond = attendus.every(
        (attendu, i) => attendu === segments[i] || (attendu.startsWith('{') && segments[i] === JETON),
      );
      if (correspond) return gabarit;
    }
    return null;
  }

  it('appelle des routes qui existent toutes', () => {
    const connus = Object.keys(CONTRAT.paths);
    expect(connus.length).toBeGreaterThan(50);

    const inconnues = cheminsAppeles()
      .filter(({ chemin }) => versGabarit(chemin, connus) === null)
      .map(({ nom, chemin }) => `${nom} → ${chemin}`);

    expect(inconnues).toEqual([]);
  });

  it('appelle chaque route avec une méthode que le serveur sert', () => {
    const connus = Object.keys(CONTRAT.paths);

    const fautives: string[] = [];
    for (const { nom, chemin } of cheminsAppeles()) {
      const gabarit = versGabarit(chemin, connus);
      if (gabarit === null) continue;
      const servies = Object.keys(CONTRAT.paths[gabarit]).map((m) => m.toUpperCase());
      for (const methode of METHODES[nom as keyof typeof routes]) {
        if (!servies.includes(methode)) fautives.push(`${nom} ${methode} ${gabarit}`);
      }
    }

    expect(fautives).toEqual([]);
  });

  it('déclare une méthode pour chaque route', () => {
    // Sans cette égalité, une route ajoutée sans sa méthode échapperait au
    // test précédent : il n'aurait rien à vérifier pour elle.
    expect(Object.keys(METHODES).sort()).toEqual(Object.keys(routes).sort());
  });

  it('préfixe toutes les routes', () => {
    for (const { nom, chemin } of cheminsAppeles()) {
      expect([nom, chemin.startsWith(`${PREFIXE}/`)]).toEqual([nom, true]);
    }
  });
});

// --------------------------------------------------------------------------
// Erreurs
// --------------------------------------------------------------------------

describe('erreurs', () => {
  it('porte le code du serveur sans le montrer', async () => {
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: coffre(),
      fetchImpl: async () => reponse(403, { detail: 'not_a_member' }),
    });

    await expect(client.request('/api/v1/me')).rejects.toMatchObject({
      status: 403,
      code: 'not_a_member',
    });
  });

  it('distingue une panne de transport d’une erreur d’API', async () => {
    // La conduite à tenir diffère : une requête jamais partie se rejoue sans
    // risque, une qui a reçu un 409 non.
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: coffre(),
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    });

    await expect(client.request('/api/v1/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('traite un 200 au corps illisible comme une panne, pas comme un succès', async () => {
    // Le laisser passer rendrait `undefined` aux écrans, qui afficheraient du
    // vide sans erreur — le pire des deux mondes.
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: coffre(),
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('html');
          },
        }) as unknown as Response,
    });

    await expect(client.request('/api/v1/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('normalise une base d’URL terminée par une barre', async () => {
    // Sans normalisation, `//me` : certains serveurs redirigent, d'autres
    // répondent 404, et l'app se comporte selon la façon dont la variable
    // d'environnement a été écrite.
    let vue = '';
    const client = new ApiClient({
      baseUrl: 'https://api.test/',
      coffre: coffre(),
      fetchImpl: async (url) => {
        vue = String(url);
        return reponse(200, {});
      },
    });

    await client.request('/api/v1/me');
    expect(vue).toBe('https://api.test/api/v1/me');
  });

  it('répète un paramètre de tableau plutôt que de le joindre', async () => {
    // `status=held&status=confirmed` est ce que FastAPI attend, et ce dont
    // l'onglet « à venir » a besoin. Une virgule donnerait un 422.
    let vue = '';
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: coffre(),
      fetchImpl: async (url) => {
        vue = String(url);
        return reponse(200, {});
      },
    });

    await client.request('/api/v1/me/bookings', {
      query: { status: ['held', 'confirmed'], limite: 10, avant: undefined },
    });

    expect(vue).toContain('status=held&status=confirmed');
    expect(vue).toContain('limite=10');
    expect(vue).not.toContain('avant');
  });
});

// --------------------------------------------------------------------------
// Rotation des jetons
// --------------------------------------------------------------------------

describe('rotation des jetons', () => {
  it('rafraîchit une seule fois pour plusieurs 401 simultanés', async () => {
    // Trois écrans qui chargent en parallèle prennent trois 401 en même temps.
    // Sans partage, trois rotations partiraient, et deux invalideraient le
    // jeton que la troisième vient d'obtenir.
    const c = coffre({ access_token: 'vieux', refresh_token: 'r' });
    let rotations = 0;

    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: c,
      fetchImpl: async (url, init) => {
        const chemin = String(url);
        if (chemin.endsWith('/auth/refresh')) {
          rotations += 1;
          return reponse(200, { access_token: 'neuf', refresh_token: 'r2' });
        }
        const entetes = (init?.headers ?? {}) as Record<string, string>;
        return entetes.Authorization === 'Bearer neuf'
          ? reponse(200, { ok: true })
          : reponse(401, { detail: 'authentication_required' });
      },
    });

    const resultats = await Promise.all([
      client.request('/api/v1/me/tiers'),
      client.request('/api/v1/me/audience'),
      client.request('/api/v1/me/bookings'),
    ]);

    expect(resultats).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(rotations).toBe(1);
  });

  it('rejoue la requête avec le jeton neuf', async () => {
    const c = coffre({ access_token: 'vieux', refresh_token: 'r' });
    const vus: string[] = [];

    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: c,
      fetchImpl: async (url, init) => {
        const chemin = String(url);
        if (chemin.endsWith('/auth/refresh')) {
          return reponse(200, { access_token: 'neuf', refresh_token: 'r2' });
        }
        vus.push(((init?.headers ?? {}) as Record<string, string>).Authorization);
        return vus.length === 1 ? reponse(401, { detail: 'x' }) : reponse(200, { ok: true });
      },
    });

    await client.request('/api/v1/me');
    expect(vus).toEqual(['Bearer vieux', 'Bearer neuf']);
    expect(c.contenu).toEqual({ access_token: 'neuf', refresh_token: 'r2' });
  });

  it('efface la session quand le jeton de rafraîchissement est refusé', async () => {
    // Le garder ferait retenter à chaque appel, indéfiniment.
    const c = coffre({ access_token: 'a', refresh_token: 'mort' });
    const perdue = jest.fn();

    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: c,
      surSessionPerdue: perdue,
      fetchImpl: async (url) =>
        String(url).endsWith('/auth/refresh')
          ? reponse(401, { detail: 'invalid_refresh_token' })
          : reponse(401, { detail: 'authentication_required' }),
    });

    await expect(client.request('/api/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(c.contenu).toBeNull();
    expect(perdue).toHaveBeenCalledTimes(1);
  });

  it('garde la session quand la rotation tombe sur une panne réseau', async () => {
    // La session n'est pas prouvée morte. L'effacer déconnecterait quelqu'un
    // qui passe sous un tunnel.
    const c = coffre({ access_token: 'a', refresh_token: 'r' });

    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: c,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/auth/refresh')) throw new TypeError('offline');
        return reponse(401, { detail: 'authentication_required' });
      },
    });

    await expect(client.request('/api/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(c.contenu).toEqual({ access_token: 'a', refresh_token: 'r' });
  });

  it('ne rafraîchit pas sur une route publique', async () => {
    // Un 401 sur la connexion veut dire « mauvais mot de passe », pas « jeton
    // périmé ». Y répondre par une rotation masquerait l'erreur réelle.
    let rotations = 0;
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: coffre({ access_token: 'a', refresh_token: 'r' }),
      fetchImpl: async (url) => {
        if (String(url).endsWith('/auth/refresh')) rotations += 1;
        return reponse(401, { detail: 'invalid_credentials' });
      },
    });

    await expect(
      client.request('/api/v1/auth/login', { methode: 'POST', publique: true }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(rotations).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Session
// --------------------------------------------------------------------------

describe('session', () => {
  it('ferme la session localement même si le serveur ne répond pas', async () => {
    // Un serveur injoignable ne doit pas laisser quelqu'un connecté sur un
    // téléphone qu'il vient de rendre.
    const c = coffre({ access_token: 'a', refresh_token: 'r' });
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: c,
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    });

    await client.deconnecter();
    expect(c.contenu).toBeNull();
  });

  it('range les jetons à la connexion', async () => {
    const c = coffre();
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: c,
      fetchImpl: async () => reponse(200, { access_token: 'a', refresh_token: 'r' }),
    });

    await client.connecter('rebecca@example.com', 'un-mot-de-passe-solide-42');
    expect(c.contenu).toEqual({ access_token: 'a', refresh_token: 'r' });
  });

  it('abandonne au bout du délai plutôt que d’attendre indéfiniment', async () => {
    // Un réseau qui accepte la connexion et ne répond plus laisserait un écran
    // en chargement pour toujours, sans erreur ni bouton.
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: coffre(),
      delaiMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    await expect(client.request('/api/v1/me')).rejects.toBeInstanceOf(NetworkError);
  });
});

// --------------------------------------------------------------------------
// Traduction, telle que l'écran la voit
// --------------------------------------------------------------------------

describe('messageDErreur', () => {
  function enveloppe(client: ApiClient) {
    return function Enveloppe({ children }: { children: ReactNode }) {
      return (
        <I18nProvider initialLocale="en">
          <ApiProvider client={client}>{children}</ApiProvider>
        </I18nProvider>
      );
    };
  }

  async function messageDErreur() {
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: coffre(),
      fetchImpl: async () => reponse(200, {}),
    });
    const { result } = await renderHook(() => useApi(), { wrapper: enveloppe(client) });
    await waitFor(() => expect(result.current).toBeTruthy());
    return result.current.messageDErreur;
  }

  it('traduit un code connu', async () => {
    const traduire = await messageDErreur();
    expect(traduire(new ApiError(403, 'not_a_member'))).toBe(en.errors.not_a_member);
  });

  it('rend le générique pour un code inconnu, jamais le code brut', async () => {
    const traduire = await messageDErreur();
    const code = 'code_invente_par_le_backend';
    expect(traduire(new ApiError(500, code))).toBe(en.errors.generic);
    expect(traduire(new ApiError(500, code))).not.toContain(code);
  });

  it('dit le réseau quand c’est le réseau', async () => {
    // « Réessayez » n'a de sens que dans ce cas-là. Le confondre avec une
    // erreur d'API ferait réessayer une requête que le serveur a refusée.
    const traduire = await messageDErreur();
    expect(traduire(new NetworkError())).toBe(en.errors.network);
  });

  it('rend le générique pour ce qui n’est ni l’un ni l’autre', async () => {
    const traduire = await messageDErreur();
    expect(traduire(new Error('bug'))).toBe(en.errors.generic);
  });
});

void GABARITS;

// --------------------------------------------------------------------------
// Ce qui a cassé le web
// --------------------------------------------------------------------------

describe('appel du fetch global', () => {
  /**
   * Un `fetch` qui vérifie son `this`, comme le font les navigateurs.
   *
   * `globalThis.fetch` rangé dans un champ puis appelé par `this.fetchImpl(...)`
   * reçoit l'instance comme `this`. Chrome et Safari refusent — « Failed to
   * execute 'fetch' on 'Window': Illegal invocation » — et **la requête ne part
   * pas**. React Native l'accepte : le défaut ne se voyait qu'en web, et se
   * présentait comme une panne réseau, sans requête dans l'onglet réseau et
   * sans rien dans la console.
   */
  function fetchQuiVerifieSonThis() {
    const appels: string[] = [];
    const impl = function (this: unknown, url: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      appels.push(String(url));
      return Promise.resolve(reponse(200, { ok: true }));
    };
    return { impl: impl as unknown as typeof fetch, appels };
  }

  it('appelle le fetch global sans lui imposer son propre `this`', async () => {
    const { impl, appels } = fetchQuiVerifieSonThis();
    const ancien = globalThis.fetch;
    globalThis.fetch = impl;

    try {
      // Sans `fetchImpl` : c'est le chemin de production, celui qui prenait
      // `globalThis.fetch` et le retenait nu.
      const client = new ApiClient({ baseUrl: 'https://api.test', coffre: coffre() });
      await client.request('/api/v1/me');
      expect(appels).toEqual(['https://api.test/api/v1/me']);
    } finally {
      globalThis.fetch = ancien;
    }
  });

  it('journalise la cause au lieu de la faire disparaître', async () => {
    // Le second défaut, plus grave que le premier : une erreur de
    // programmation devenait « vérifiez votre connexion », sans trace. C'est
    // ce silence qui a rendu la cause invisible.
    const bruit = jest.spyOn(console, 'error').mockImplementation(() => {});
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: coffre(),
      fetchImpl: (() => {
        throw new TypeError('Illegal invocation');
      }) as unknown as typeof fetch,
    });

    await expect(client.request('/api/v1/me')).rejects.toBeInstanceOf(NetworkError);
    expect(bruit).toHaveBeenCalled();
    bruit.mockRestore();
  });
});

describe('chemins du client', () => {
  it('n’écrit aucun chemin en dur : tout passe par `routes`', () => {
    // La connexion, la déconnexion et la rotation étaient écrites à la main,
    // sans le préfixe `/api/v1`. Le test de contrat ne les voyait pas : il ne
    // parcourt que `routes`. Une fois le `fetch` réparé, elles auraient rendu
    // 404 — un second tour de diagnostic pour le même symptôme.
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const source = readFileSync(join(__dirname, '..', 'src', 'api', 'client.ts'), 'utf-8');

    const enDur = [...source.matchAll(/\b(?:request|envoyer)\w*<?[^(]*\(\s*'(\/[^']*)'/g)].map(
      (m) => m[1],
    );

    expect(enDur).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// les plateformes qu'on peut réellement rattacher
// --------------------------------------------------------------------------

/**
 * `PlateformeConnectable` est écrite à la main dans `types.ts`, et le serveur
 * tient la sienne dans `PLATEFORMES_BRANCHEES`. Deux listes de la même chose,
 * dans deux langages, que rien ne rapprochait.
 *
 * Ce n'est pas un défaut théorique. Snapchat existe déjà en base et dans les
 * paliers, et la fabrique **lève** au lieu de rendre un fournisseur muet : le
 * jour où l'app l'offrirait sans que le serveur l'implémente, le bouton
 * mènerait à une erreur serveur — sur l'écran dont le seul rôle est de dire
 * quels réseaux rattacher. Et le jour où l'accès partenaire arrive, la liste
 * du serveur bougera sans que l'app le sache.
 *
 * Le contrat de chemins ne pouvait pas l'attraper : `openapi.json` ne porte
 * que les routes, par choix assumé, et une plateforme n'est pas une route.
 */
describe('les plateformes connectables', () => {
  /** Les valeurs de l'union TypeScript, lues dans la source. */
  function coteApp(): string[] {
    const source = readFileSync(join(__dirname, '..', 'src', 'api', 'types.ts'), 'utf-8');
    const declaration = /export type PlateformeConnectable =([^;]+);/.exec(source);
    if (declaration === null) throw new Error('PlateformeConnectable introuvable');
    return [...declaration[1].matchAll(/'([a-z_]+)'/g)].map((trouve) => trouve[1]).sort();
  }

  /** Celles que la fabrique du serveur accepte. */
  function coteServeur(): string[] {
    const source = readFileSync(
      join(__dirname, '..', '..', 'api', 'app', 'integrations', 'providers.py'),
      'utf-8',
    );
    const declaration = /PLATEFORMES_BRANCHEES\s*=\s*frozenset\(\{([^}]+)\}\)/.exec(source);
    if (declaration === null) throw new Error('PLATEFORMES_BRANCHEES introuvable');
    return [...declaration[1].matchAll(/Platform\.([A-Z_]+)/g)]
      .map((trouve) => trouve[1].toLowerCase())
      .sort();
  }

  it('sont exactement les mêmes des deux côtés', () => {
    expect(coteApp()).toEqual(coteServeur());
  });

  it('ne sont pas vides des deux côtés', () => {
    // Sans cela, une expression régulière qui cesserait de trouver quoi que ce
    // soit rendrait le test vert en comparant deux listes vides.
    expect(coteApp().length).toBeGreaterThan(0);
    expect(coteServeur().length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// ce qui s'écrit dans la console, et ce qui ne s'y écrit pas
// --------------------------------------------------------------------------

/**
 * Une annulation au changement d'écran est le fonctionnement normal.
 *
 * Toutes les fins prématurées se ressemblent à l'arrivée — `fetch` lève la
 * même `AbortError` — et n'ont rien en commun. `/businesses` et
 * `/business/{id}/collaborations` remplissaient la console d'erreurs rouges à
 * chaque changement d'onglet et de filtre, et la vraie panne s'y noyait. Ce
 * qui rend un journal inutile est le bruit, pas le silence.
 */
describe('le journal des requêtes interrompues', () => {
  function client(fetchImpl: typeof fetch, delaiMs?: number) {
    return new ApiClient({ baseUrl: 'https://api.test', coffre: coffre(), fetchImpl, delaiMs });
  }

  /** Ce que `fetch` fait d'un signal déjà avorté, ou avorté pendant l'attente. */
  const suitLeSignal = (async (_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resoudre, rejeter) => {
      const signal = init?.signal;
      const abandonner = () => rejeter(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal?.aborted) abandonner();
      else signal?.addEventListener('abort', abandonner);
    })) as unknown as typeof fetch;

  let erreurs: jest.SpyInstance;
  let avertissements: jest.SpyInstance;

  beforeEach(() => {
    erreurs = jest.spyOn(console, 'error').mockImplementation(() => {});
    avertissements = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('ne crie pas quand c’est l’appelant qui a annulé en vol', async () => {
    let partie: () => void = () => {};
    const attendLAnnulation = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resoudre, rejeter) => {
        partie = () => {};
        init?.signal?.addEventListener('abort', () =>
          rejeter(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
        partie();
      })) as unknown as typeof fetch;

    const horloge = new AbortController();
    const promesse = client(attendLAnnulation).request('/api/v1/businesses', {
      signal: horloge.signal,
    });
    // Le temps que la requête parte réellement : le coffre se lit d'abord.
    await Promise.resolve();
    await Promise.resolve();
    horloge.abort();

    await expect(promesse).rejects.toBeInstanceOf(NetworkError);
    expect(erreurs).not.toHaveBeenCalled();
    expect(avertissements).not.toHaveBeenCalled();
  });

  it('n’envoie même pas une requête déjà annulée', async () => {
    // L'appelant peut annuler avant que la requête parte — le temps de lire le
    // coffre, un écran a pu être quitté. S'abonner ne suffit pas : l'événement
    // est passé, et la requête partirait pour de bon, à attendre son échéance.
    const horloge = new AbortController();
    horloge.abort();
    const appels: string[] = [];
    const compte = (async (url: RequestInfo | URL, init?: RequestInit) => {
      appels.push(String(url));
      return suitLeSignal(url, init);
    }) as unknown as typeof fetch;

    await expect(
      client(compte).request('/api/v1/businesses', { signal: horloge.signal }),
    ).rejects.toBeInstanceOf(NetworkError);

    expect(erreurs).not.toHaveBeenCalled();
    expect(avertissements).not.toHaveBeenCalled();
  });

  it('distingue une échéance dépassée, sans la cacher', async () => {
    // Le serveur a accepté la connexion et n'a pas répondu. C'est une panne,
    // pas un défaut de programmation : elle se dit, à un autre niveau.
    await expect(
      client(suitLeSignal, 5).request('/api/v1/businesses'),
    ).rejects.toBeInstanceOf(NetworkError);

    expect(avertissements).toHaveBeenCalled();
    expect(erreurs).not.toHaveBeenCalled();
  });

  it('crie encore sur ce que personne n’a demandé', async () => {
    // Le pendant, et il compte : un client devenu muet ferait passer un
    // `fetch` mal lié pour « vérifiez votre connexion », sans rien dans la
    // console ni dans l'onglet réseau. C'est arrivé, et c'est ce que le
    // journal existe pour éviter.
    const casse = (async () => {
      throw new TypeError('Illegal invocation');
    }) as unknown as typeof fetch;

    await expect(client(casse).request('/api/v1/businesses')).rejects.toBeInstanceOf(NetworkError);
    expect(erreurs).toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// la borne de la note libre
// --------------------------------------------------------------------------

/**
 * `NOTE_MAXIMUM` est recopié du serveur plutôt que demandé : une requête pour
 * connaître une limite ajouterait un aller-retour à chaque ouverture d'écran.
 * Le risque est qu'ils divergent — l'app laisserait alors écrire une phrase
 * que le serveur refuse, après l'avoir tapée.
 *
 * Le même défaut existait sur le poids d'une capture, et le même test le tient.
 */
describe('la borne de la note libre', () => {
  it('vaut celle du serveur', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'api', 'app', 'core', 'config.py'),
      'utf-8',
    );
    const declaration = /collaboration_note_max_length:\s*int\s*=\s*(\d+)/.exec(source);
    if (declaration === null) throw new Error('collaboration_note_max_length introuvable');

    expect(NOTE_MAXIMUM).toBe(Number(declaration[1]));
  });
});
