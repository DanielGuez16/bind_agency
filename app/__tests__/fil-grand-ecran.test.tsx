/**
 * Le fil créateur en grille, sur grand écran.
 *
 * `rules.md` §8 bornait le contenu créateur à 760 centré : c'est exactement la
 * colonne étroite perdue dans du vide relevée en campagne de test. La v0.6 le
 * porte à 1120 et met les cartes en grille de trois à quatre.
 *
 * **Le défilement horizontal reste la forme mobile.** Sur grand écran il cache
 * du contenu sans raison : on ne sait pas combien de salons attendent derrière
 * le bord, et on ne pense pas à pousser.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { FilScreen } from '../src/screens/FilScreen';
import { ThemeProvider } from '../src/theme';

// Préfixé `mock` : jest n'autorise que ces noms dans une fabrique de mock.
let mockLargeur = 1120;

jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: mockLargeur, large: true }),
}));

function commerce(id: string) {
  return {
    business_id: id,
    name: `Salon ${id}`,
    category: 'beauty',
    address: '100 Ocean Dr',
    cover_photo_key: null,
    distance_metres: 420,
    items: [
      {
        tier_offer_id: `o-${id}`,
        catalog_item_id: `i-${id}`,
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
      },
    ],
  };
}

function monter(nombre: number) {
  const fil = {
    commerces: Array.from({ length: nombre }, (_, rang) => commerce(`b${rang}`)),
    obstacles: [],
  };
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => fil }) as Response,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onOuvrirLeCommerce={() => {}}
            onConnecterUnReseau={() => {}}
            onVoirMonAudience={() => {}}
            onVoirMesPaliers={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('fil créateur, grand écran', () => {
  afterEach(() => {
    mockLargeur = 1120;
  });

  it('range les salons en grille de trois', async () => {
    await monter(6);
    await waitFor(() => expect(screen.getByTestId('commerce-b0')).toBeTruthy());

    // Six salons, trois par ligne : deux rangées, pas six.
    expect(screen.getByTestId('rangee-0')).toBeTruthy();
    expect(screen.getByTestId('rangee-1')).toBeTruthy();
    expect(screen.queryByTestId('rangee-2')).toBeNull();
  });

  it('passe à quatre quand la place y est vraiment', async () => {
    mockLargeur = 1280;
    await monter(8);
    await waitFor(() => expect(screen.getByTestId('commerce-b0')).toBeTruthy());

    expect(screen.getByTestId('rangee-1')).toBeTruthy();
    expect(screen.queryByTestId('rangee-2')).toBeNull();
  });

  it('complète la dernière rangée plutôt que d’étirer ce qui reste', async () => {
    // Deux cartes seules sur la dernière ligne s'étireraient à la moitié de la
    // largeur et cesseraient de ressembler aux autres. Une grille dont la
    // dernière ligne a des cartes plus grandes n'est plus une grille.
    await monter(4);
    await waitFor(() => expect(screen.getByTestId('commerce-b3')).toBeTruthy());

    const derniere = screen.getByTestId('rangee-1');
    expect(derniere.props.children).toHaveLength(3);
  });

  it('affiche tous les salons, aucun caché derrière un bord', async () => {
    await monter(7);
    await waitFor(() => expect(screen.getByTestId('commerce-b0')).toBeTruthy());

    for (let rang = 0; rang < 7; rang += 1) {
      expect(screen.getByTestId(`commerce-b${rang}`)).toBeTruthy();
    }
  });
});
