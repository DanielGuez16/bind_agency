/**
 * Ce qui part réellement dans le `FormData` d'un téléversement.
 *
 * **Le décor doit diverger sur la plateforme, sinon il ne prouve rien.** Un
 * test qui vérifie seulement « le champ s'appelle `fichier` » passait déjà avec
 * le défaut : le champ s'appelait bien `fichier`, il portait la chaîne
 * `"[object Object]"`. C'est le *type* de la valeur qui distingue les deux
 * implémentations, et lui seul.
 *
 * Le défaut mesuré contre le serveur de démonstration : champ en texte →
 * `validation_failed`, c'est-à-dire « Some information is missing or
 * incorrect ». Les quatre chemins du produit étaient morts sur le web, dont la
 * capture de preuve — le geste par lequel une créatrice tient sa contrepartie.
 */
import { Platform } from 'react-native';

import { Api, ApiClient } from '../src/api';

function apiEspion() {
  const envois: { url: string; corps: FormData }[] = [];
  const client = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      envois.push({ url: String(url), corps: init?.body as FormData });
      return {
        ok: true,
        status: 200,
        json: async () => ({ storage_key: 'k', screenshot_key: 'k', id: 'p1' }),
      } as Response;
    }) as unknown as typeof fetch,
  });
  return { api: new Api(client), envois };
}

/** Une adresse `blob:` que `fetch` sait relire, comme sur le web. */
const URI = 'blob:https://app.test/8f2c';

beforeEach(() => {
  // Le double de `fetch` du client ne sert pas à relire l'uri : c'est le
  // `fetch` global que `fichierAEnvoyer` appelle.
  globalThis.fetch = (async () =>
    ({ blob: async () => new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }) }) as never) as typeof fetch;
});

describe('sur le web, un fichier part comme fichier', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  });

  it.each([
    ['la capture de preuve', (api: Api) => api.televerserUneCapture(URI)],
    ['la photo de galerie', (api: Api) => api.ajouterUnePhoto('b1', URI)],
    ['la page de carte', (api: Api) => api.ajouterUnePageDeCarte('b1', URI)],
  ])('%s', async (_nom, geste) => {
    const { api, envois } = apiEspion();

    await geste(api);

    const valeur = envois[0].corps.get('fichier');
    // **L'assertion qui compte.** Avec le défaut, `valeur` est la chaîne
    // "[object Object]" — le champ existe, il est simplement inutilisable.
    expect(typeof valeur).not.toBe('string');
    expect(valeur).toBeInstanceOf(Blob);
  });
});

describe('en natif, la forme de React Native est conservée', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  it('le pont natif construit la partie multipart depuis {uri, name, type}', async () => {
    // **L'autre bord.** Convertir partout casserait le natif, où le pont fait
    // déjà le travail depuis `{uri, name, type}`.
    //
    // **Ce que jsdom permet d'affirmer, et ce qu'il ne permet pas.** Son
    // `FormData` suit la spécification du web : il sérialise l'objet en
    // `"[object Object]"`, exactement comme le navigateur. On ne peut donc pas
    // relire `uri` ici. Ce qui reste vérifiable est la divergence elle-même —
    // aucun `Blob` n'a été construit —, et c'est précisément ce qui distingue
    // les deux implémentations. Le comportement du pont natif, lui, ne
    // s'éprouve pas sous jsdom.
    const relu = new Set<string>();
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      relu.add(String(u));
      return { blob: async () => new Blob([]) } as never;
    }) as typeof fetch;

    const { api, envois } = apiEspion();

    await api.televerserUneCapture('file:///tmp/capture.jpg');

    expect(envois[0].corps.get('fichier')).not.toBeInstanceOf(Blob);
    expect(relu).not.toContain('file:///tmp/capture.jpg');
  });
});
