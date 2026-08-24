/**
 * Le fil v3.1 : chercher, et garder.
 *
 * **Chercher et garder ne se posent pas au même endroit.** La recherche est une
 * barre : elle s'adresse à l'écran entier. Le cœur est sur l'objet, et il ne
 * s'adresse qu'à lui. Les deux décors divergents portent là-dessus — ce qui
 * part sur le réseau quand on tape, et ce qui se remplit avant que le réseau
 * réponde.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { FilScreen } from '../src/screens/FilScreen';
import { motion, ThemeProvider } from '../src/theme';

function salon(rang: number, estFavori = false) {
  return {
    business_id: `b${rang}`,
    name: `Salon ${rang}`,
    category: 'beauty',
    address: null,
    cover_photo_key: null,
    cover_portrait_key: null,
    neighborhood: 'wynwood',
    distance_metres: 100 * rang,
    // **Servi, et compté comme le serveur le compte** : par article distinct,
    // jamais par offre. Le poser à `items.length` referait dans le décor la
    // faute que la route a corrigée, et le test la validerait.
    prestations_ouvertes: 1,
    items: [
      {
        tier_offer_id: `o${rang}`,
        catalog_item_id: `i${rang}`,
        tier_id: 't1',
        social_account_id: 's1',
        name: 'Gel manicure',
        description: null,
        price_cents: 4500,
        currency: 'USD',
        duration_minutes: 45,
        requires_booking: true,
        photo_key: null,
        platform: 'instagram',
        content_format: 'story',
        value_ratio: null,
        est_favori: estFavori,
      },
    ],
  };
}

function fil(extra: Partial<Fil> = {}, commerces = [salon(1), salon(2)]) {
  return {
    commerces,
    obstacles: [],
    rayon_metres: 15_000,
    total_prestations: commerces.length,
    categories: [
      { categorie: 'beauty', commerces: 5, prestations: 9 },
      { categorie: 'fitness', commerces: 4, prestations: 6 },
    ],
    rayons: [],
    quartiers: [{ quartier: 'wynwood', commerces: 2, prestations: 3, distance_metres: 200 }],
    prochain_palier: null,
    ...extra,
  } as unknown as Fil;
}

async function monter(donnees: Fil = fil()) {
  const appels: { url: string; methode: string }[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const methode = (init?.method ?? 'GET').toUpperCase();
      appels.push({ url: String(url), methode });
      return { ok: true, status: 200, json: async () => donnees } as Response;
    }) as unknown as typeof fetch,
  });

  const ouvertures: string[] = [];
  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onVoirMesFavoris={() => ouvertures.push('favoris')}
            onOuvrirLeCommerce={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('barre-du-mur')).toBeTruthy());
  return { appels, ouvertures };
}

describe('la recherche existait et n’avait aucun bouton', () => {
  it('ce qu’on tape part au serveur, une fois la frappe posée', async () => {
    jest.useFakeTimers();
    try {
      const { appels } = await monter();

      await fireEvent.changeText(screen.getByTestId('champ-recherche'), 'massage');
      await act(async () => {
        jest.advanceTimersByTime(motion.etat + 10);
      });

      await waitFor(() =>
        expect(appels.some((a) => a.url.includes('recherche=massage'))).toBe(true),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('et pas une requête par touche', async () => {
    /**
     * **Le décor divergent.** Lier le champ à la requête rend le même écran :
     * on tape, les résultats arrivent. Ce qu'il détruit est le réseau — huit
     * requêtes pour « massage », dont la dernière n'arrive pas forcément en
     * dernier. Le test compte les départs.
     */
    jest.useFakeTimers();
    try {
      const { appels } = await monter();
      const avant = appels.length;

      for (const texte of ['m', 'ma', 'mas', 'mass', 'massa', 'massag', 'massage']) {
        await fireEvent.changeText(screen.getByTestId('champ-recherche'), texte);
        await act(async () => {
          jest.advanceTimersByTime(20);
        });
      }
      await act(async () => {
        jest.advanceTimersByTime(motion.etat + 10);
      });

      const partis = appels.slice(avant).filter((a) => a.url.includes('recherche='));
      expect(partis).toHaveLength(1);
      expect(partis[0].url).toContain('recherche=massage');
    } finally {
      jest.useRealTimers();
    }
  });

  it('le cœur de la barre ouvre la liste, il n’en garde aucun', async () => {
    const { ouvertures } = await monter();

    await fireEvent.press(screen.getByTestId('voir-mes-favoris'));

    expect(ouvertures).toEqual(['favoris']);
  });
});
