/**
 * La liste des favoris, et ce qu'on peut en faire.
 *
 * **Le décor divergent est le salon disparu.** Une liste où le cœur ne se
 * presse pas rend un écran qui a l'air complet : les lignes sont là, les états
 * sont dits, tout se lit. Ce qu'elle interdit ne se voit qu'au bout d'un mois —
 * un salon qui ne paraît plus n'est dans aucun fil, donc son favori n'aurait
 * **jamais** pu être retiré, et la liste se remplit une fois pour toutes.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Favori } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { FavorisScreen } from '../src/screens/FavorisScreen';
import { ThemeProvider } from '../src/theme';

function favori(extra: Partial<Favori> = {}): Favori {
  return {
    catalog_item_id: 'i1',
    business_id: 'b1',
    business_name: 'Vela Nail Studio',
    name: 'Gel manicure',
    description: null,
    duration_minutes: 45,
    price_cents: 4000,
    currency: 'USD',
    photo_key: 'photos/vela.jpg',
    etat: 'reservable',
    ...extra,
  } as Favori;
}

async function monter(favoris: Favori[], surRetrait?: () => Response) {
  const appels: { url: string; methode: string }[] = [];
  const ouvertures: string[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const methode = (init?.method ?? 'GET').toUpperCase();
      appels.push({ url: String(url), methode });
      if (methode === 'DELETE') {
        return surRetrait?.() ?? ({ ok: true, status: 204, json: async () => null } as Response);
      }
      return { ok: true, status: 200, json: async () => favoris } as Response;
    }) as unknown as typeof fetch,
  });

  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FavorisScreen
            onRetour={() => {}}
            onOuvrirLeCommerce={(id) => ouvertures.push(id)}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { appels, ouvertures };
}

describe('une prestation qui n’est plus réservable reste, avec sa raison', () => {
  it.each([
    ['fermee', /closed this one for now/i],
    ['salon_indisponible', /not listed at the moment/i],
    ['hors_palier', /a tier you do not open yet/i],
  ])('%s dit ce qu’elle appelle comme conduite', async (etat, attendu) => {
    // « Indisponible » les aurait tous couverts et n'aurait rien dit : attendre
    // la réouverture, monter d'un palier et choisir autre chose ne sont pas le
    // même geste.
    await monter([favori({ etat: etat as Favori['etat'] })]);

    expect(await screen.findByTestId('favori-etat-i1')).toHaveTextContent(attendu);
  });

  it('et la réservable ne dit rien : il n’y a rien à dire', async () => {
    // Un bandeau qui annonce que tout va bien est du bruit sur la seule ligne
    // qui n'en demande pas.
    await monter([favori({ etat: 'reservable' })]);

    await waitFor(() => expect(screen.getByTestId('favori-i1')).toBeTruthy());
    expect(screen.queryByTestId('favori-etat-i1')).toBeNull();
  });
});

describe('on peut lâcher ce qu’on a gardé', () => {
  it('le cœur retire, même quand le salon a disparu du fil', async () => {
    /**
     * **Le cas qui rendait la liste inutilisable.** Un salon en pause n'est
     * dans aucun fil : sans ce cœur, son favori n'aurait eu aucun endroit où
     * être retiré. C'est précisément l'état où la liste doit le plus servir.
     */
    const { appels } = await monter([favori({ etat: 'salon_indisponible' })]);

    await fireEvent.press(await screen.findByTestId('favori-retirer-i1'));

    await waitFor(() =>
      expect(
        appels.some((a) => a.methode === 'DELETE' && a.url.includes('/me/favorites/i1')),
      ).toBe(true),
    );
    expect(screen.queryByTestId('favori-i1')).toBeNull();
  });

  it('la ligne s’en va au doigt, sans attendre le réseau', async () => {
    // Une promesse qui ne se résout jamais sépare l'optimiste de l'attente :
    // avec un double qui répond tout de suite, les deux rendent le même écran.
    await monter([favori()], () => new Promise<Response>(() => {}) as unknown as Response);

    await fireEvent.press(await screen.findByTestId('favori-retirer-i1'));

    expect(screen.queryByTestId('favori-i1')).toBeNull();
  });

  it('et elle revient si le serveur refuse', async () => {
    // Faire disparaître une ligne qu'on n'a pas su retirer serait mentir sur ce
    // qu'on a fait.
    await monter([favori()], () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'internal_error' }),
    }) as Response);

    await fireEvent.press(await screen.findByTestId('favori-retirer-i1'));

    await waitFor(() => expect(screen.getByTestId('favori-i1')).toBeTruthy());
  });

  it('la ligne entière ouvre le salon, y compris sur une réservable', async () => {
    const { ouvertures } = await monter([favori()]);

    await fireEvent.press(await screen.findByLabelText(/Gel manicure — Vela Nail Studio/));

    expect(ouvertures).toEqual(['b1']);
  });
});

describe('la liste se relit d’où l’on est', () => {
  it('aucune coordonnée ne part avec elle', async () => {
    // Un favori posé à Wynwood doit se relire depuis Kendall. La brancher sur
    // le rayon en ferait une seconde version du fil, qui oublie ce qu'on lui a
    // confié.
    const { appels } = await monter([favori()]);

    const lecture = appels.find((a) => a.methode === 'GET');
    expect(lecture?.url).toContain('/me/favorites');
    expect(lecture?.url).not.toContain('longitude');
    expect(lecture?.url).not.toContain('rayon');
  });
});
