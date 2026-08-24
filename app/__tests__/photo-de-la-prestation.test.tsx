/**
 * La photo par prestation : elle existait en base et nulle part ailleurs.
 *
 * **`photo_key` était déclarée corrigeable, la route de dépôt existait, et rien
 * ne les reliait.** Le champ se posait par correctif ; aucun écran ne savait
 * produire de clé. Une capacité déclarée que rien ne sait exercer n'est pas une
 * capacité, c'est un champ — et c'est exactement le pendant du champ accepté
 * par un schéma et ignoré par un service.
 *
 * **Le décor divergent est le second appel.** Une implémentation qui dépose le
 * fichier et s'arrête rend le même écran : la galerie du téléphone s'ouvre, le
 * fichier part, rien ne se plaint. La photo n'est simplement jamais posée sur
 * l'article. Le test lit donc **les deux** appels.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type ItemDuCatalogue } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { CatalogueScreen } from '../src/screens/CatalogueScreen';
import { ThemeProvider } from '../src/theme';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///choisie.jpg' }],
  })),
}));

const ITEM = (extra: Partial<ItemDuCatalogue> = {}) =>
  ({
    id: 'i1',
    business_id: 'b1',
    parent_item_id: null,
    name: 'Gel manicure',
    description: null,
    price_cents: 4000,
    duration_minutes: 45,
    requires_booking: true,
    photo_key: null,
    leaves_choice: false,
    source: 'manual',
    is_available: true,
    is_effectively_available: true,
    archived_at: null,
    reservations_count: 0,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...extra,
  }) as ItemDuCatalogue;

async function monter(item = ITEM()) {
  const envois: { url: string; methode: string; corps: string }[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const chemin = String(url);
      const methode = (init?.method ?? 'GET').toUpperCase();
      if (methode !== 'GET') {
        envois.push({ url: chemin, methode, corps: String(init?.body ?? '') });
        if (chemin.includes('/photos/uploads')) {
          return {
            ok: true,
            status: 201,
            json: async () => ({ storage_key: 'photos/b1/abc.jpg' }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => item } as Response;
      }
      if (chemin.includes('/catalog-items')) {
        return { ok: true, status: 200, json: async () => [item] } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    }) as unknown as typeof fetch,
  });

  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api}>
          <CatalogueScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { envois };
}

describe('le manque se signale seul', () => {
  it('sans photo : un cadre pointillé, et l’état le dit', async () => {
    // Aucun texte n'explique la fonction. Un intitulé « ajoutez une photo de
    // prestation » aurait décrit une capacité au lieu de la rendre évidente.
    await monter(ITEM({ photo_key: null }));

    const vignette = await screen.findByTestId('vignette-i1');
    const style = [vignette.props.style].flat(9).filter(Boolean) as Record<string, unknown>[];
    const aplat = Object.assign({}, ...style) as Record<string, unknown>;
    expect(aplat.borderStyle).toBe('dashed');

    expect(screen.getByTestId('photo-manque-i1')).toHaveTextContent(/needs a photo/i);
  });

  it('avec photo : la vignette, et plus rien à signaler', async () => {
    await monter(ITEM({ photo_key: 'photos/b1/deja.jpg' }));

    await waitFor(() => expect(screen.getByTestId('vignette-i1')).toBeTruthy());
    expect(screen.queryByTestId('photo-manque-i1')).toBeNull();
    // La vignette, pas l'original : `Image` décode avant de réduire.
    expect(String(screen.getByTestId('vignette-i1-image').props.source.uri)).toMatch(
      /deja\.jpg@vignette$/,
    );
  });
});

describe('la photo se dépose vraiment', () => {
  it('elle part, **et** elle est posée sur l’article', async () => {
    const { envois } = await monter();

    await fireEvent.press(await screen.findByTestId('corriger-i1'));
    await fireEvent.press(await screen.findByTestId('photo-choisir-i1'));

    await waitFor(() => expect(envois.length).toBeGreaterThanOrEqual(2));

    // Le dépôt, qui rend une clé.
    const depot = envois.find((e) => e.url.includes('/photos/uploads'));
    expect(depot?.methode).toBe('POST');

    // **Et le correctif, qui la range sur l'article.** Sans lui, le fichier
    // part et la prestation n'a toujours pas de photo — c'est exactement
    // l'état d'avant, avec un aller-retour réseau en plus.
    const correctif = envois.find((e) => e.methode === 'PATCH');
    expect(correctif?.url).toContain('/catalog-items/i1');
    expect(JSON.parse(correctif!.corps)).toEqual({ photo_key: 'photos/b1/abc.jpg' });
  });
});
