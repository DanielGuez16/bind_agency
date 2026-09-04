/**
 * Ce que le salon attend d'une publication, écrit depuis l'écran de composition.
 *
 * **Le défaut que ces tests gardent.** `required_mention` et `required_geotag`
 * existaient en base, dans la migration, et dans toutes les lectures — fiche,
 * contrepartie, file du commerce. Il manquait les deux bouts : aucun schéma
 * d'écriture ne les acceptait côté serveur, et aucun écran ne les saisissait.
 * Résultat, `required_mention` valait `null` sur chaque ligne de chaque
 * environnement, et l'interface qui l'affiche — gardée par
 * `required_mention ? … : null` — ne se rendait jamais.
 *
 * Vu depuis l'écran de la créatrice, ça se lisait « le badge est peu clair » :
 * un défaut d'affichage, alors que la cause était qu'il n'y avait rien à
 * afficher.
 */
let mockLarge = false;
jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: mockLarge ? 1512 : 390, large: mockLarge, place: () => mockLarge }),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { CatalogueScreen } from '../src/screens/CatalogueScreen';
import { ThemeProvider } from '../src/theme';

const ITEM = {
  id: 'i1',
  business_id: 'b1',
  parent_item_id: null,
  name: 'Gel manicure',
  description: null,
  price_cents: 4_000,
  duration_minutes: 45,
  requires_booking: true,
  photo_key: null,
  leaves_choice: false,
  source: 'manual' as const,
  is_available: true,
  is_effectively_available: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const OFFRE = {
  id: 'o1',
  business_id: 'b1',
  tier_id: 't1',
  catalog_item_id: 'i1',
  platform: 'instagram' as const,
  content_format: 'story' as const,
  item_name: 'Gel manicure',
  required_mention: null as string | null,
  required_geotag: false,
  is_active: true,
  is_effectively_offered: true,
  created_at: '2026-08-01T00:00:00Z',
};

const PALIER = {
  id: 't1',
  platform: 'instagram' as const,
  content_format: 'story' as const,
  is_active: true,
};

/** Ce qui est parti au serveur, dans l'ordre. */
type Envoi = { methode: string; chemin: string; corps: unknown };

async function monter(offre = OFFRE) {
  const envois: Envoi[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const chemin = String(url);
      if (init?.method && init.method !== 'GET') {
        envois.push({
          methode: init.method,
          chemin,
          corps: init.body ? JSON.parse(String(init.body)) : null,
        });
        return { ok: true, status: 200, json: async () => offre } as Response;
      }
      if (chemin.includes('/catalog-items')) {
        return { ok: true, status: 200, json: async () => [ITEM] } as Response;
      }
      if (chemin.includes('/tier-offers')) {
        return { ok: true, status: 200, json: async () => [offre] } as Response;
      }
      if (chemin.includes('/tiers')) {
        return { ok: true, status: 200, json: async () => [PALIER] } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    }) as unknown as typeof fetch,
  });

  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api}>
          <CatalogueScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId(`mention-${offre.id}`)).toBeTruthy());
  return { vue, envois };
}

describe('les critères de publication se saisissent', () => {
  it('le champ existe sur une offre, avec son libellé', async () => {
    // **Le geste qui manquait au produit entier.** Sans lui, la colonne reste
    // nulle et tout ce qui l'affiche est mort.
    const { vue } = await monter();

    expect(screen.getByText('Account to mention')).toBeTruthy();
    expect(screen.getByTestId('lieu-o1')).toBeTruthy();
    await vue.unmount();
  });

  it('le bouton n’apparaît que si quelque chose a changé', async () => {
    // La règle de forme de cet écran : retiré, jamais grisé. Un enregistrement
    // toujours offert fait douter de ce qui est enregistré.
    const { vue } = await monter();
    expect(screen.queryByTestId('enregistrer-criteres-o1')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('mention-o1'), '@maison.rivage');

    await waitFor(() => expect(screen.getByTestId('enregistrer-criteres-o1')).toBeTruthy());
    await vue.unmount();
  });

  it('ce qui part au serveur est un PATCH sur l’offre, avec les deux critères', async () => {
    const { vue, envois } = await monter();

    await fireEvent.changeText(screen.getByTestId('mention-o1'), '@maison.rivage');
    await waitFor(() => expect(screen.getByTestId('enregistrer-criteres-o1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('enregistrer-criteres-o1'));

    await waitFor(() => expect(envois.length).toBe(1));
    expect(envois[0].methode).toBe('PATCH');
    expect(envois[0].chemin).toContain('/tier-offers/o1');
    expect(envois[0].corps).toEqual({
      required_mention: '@maison.rivage',
      required_geotag: false,
    });
    await vue.unmount();
  });

  it('un champ vidé part en null, pas en chaîne vide', async () => {
    // **Le cas divergent.** Une implémentation qui enverrait `''` passerait
    // tous les tests ci-dessus : le serveur rangerait une chaîne vide, et
    // l'écran de la créatrice afficherait « citez : » suivi de rien.
    const { vue, envois } = await monter({ ...OFFRE, required_mention: '@ancien' });

    await fireEvent.changeText(screen.getByTestId('mention-o1'), '   ');
    await waitFor(() => expect(screen.getByTestId('enregistrer-criteres-o1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('enregistrer-criteres-o1'));

    await waitFor(() => expect(envois.length).toBe(1));
    expect((envois[0].corps as { required_mention: unknown }).required_mention).toBeNull();
    await vue.unmount();
  });
});
