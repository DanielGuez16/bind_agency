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
