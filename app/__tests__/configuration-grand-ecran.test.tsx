/**
 * La composition du commerce, sur grand écran.
 *
 * Relevé en campagne 2 : « trois cartes sur une page vide ». Le défaut n'est pas
 * la mise en page des cartes, c'est qu'une page entière soit dépensée pour un
 * menu. Là où la place existe, le menu devient une colonne et la section vit à
 * côté — on arrive **dans** le catalogue, pas devant une porte qui y mène.
 *
 * En compact la table des matières garde tout son sens : il n'y a pas de place
 * pour deux colonnes, et c'est alors le seul endroit d'où l'on choisit. Les deux
 * cas sont éprouvés, sinon corriger l'un casserait l'autre en silence.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import {
  CompositionDuCommerce,
  ConfigurationScreen,
} from '../src/screens/ConfigurationScreen';
import { ThemeProvider } from '../src/theme';

const mockGabarit = { large: true };
jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: mockGabarit.large ? 1512 : 390, large: mockGabarit.large }),
}));

beforeEach(() => {
  mockGabarit.large = true;
});

/** Ce que les trois sections demandent. Vide partout : la forme suffit ici. */
const REPONSES: Record<string, unknown> = {
  '/catalog': [],
  '/tier-offers': [],
  '/tiers': [],
  '/capacity/rules': [],
  '/capacity/exceptions': [],
  '/activation': { etapes: [{ cle: 'address', faite: true }] },
};

function api() {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url) => {
      const chemin = String(url);
      const trouve = Object.entries(REPONSES).find(([fragment]) => chemin.includes(fragment));
      return {
        ok: true,
        status: 200,
        json: async () => (trouve ? trouve[1] : []),
      } as Response;
    },
  });
}

async function monter(noeud: React.ReactElement) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api()}>{noeud}</ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la composition du commerce, grand écran', () => {
  it('ouvre sur une section, pas sur une page de menu', async () => {
    // Une page dont le seul rôle est de mener ailleurs coûte un clic et un
    // écran entier. La section est là dès l'arrivée.
    await monter(<CompositionDuCommerce businessId="b1" />);

    await waitFor(() => expect(screen.getByTestId('ecran-catalogue')).toBeTruthy());
    expect(screen.queryByTestId('ecran-configuration')).toBeNull();
  });

  it('garde les trois sections visibles à côté de celle qu’on lit', async () => {
    // C'est ce qui distingue une colonne d'une page de garde : elle sert à
    // changer de section, pas à être traversée une fois.
    await monter(<CompositionDuCommerce businessId="b1" />);

    for (const section of ['catalogue', 'horaires', 'activation']) {
      expect(screen.getByTestId(`section-${section}`)).toBeTruthy();
    }
  });

  it('change de section sans quitter la colonne', async () => {
    await monter(<CompositionDuCommerce businessId="b1" />);
    await waitFor(() => expect(screen.getByTestId('ecran-catalogue')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('section-horaires'));

    await waitFor(() => expect(screen.getByTestId('ecran-horaires')).toBeTruthy());
    expect(screen.queryByTestId('ecran-catalogue')).toBeNull();
    // La colonne n'a pas bougé : on n'est pas passé par un menu.
    expect(screen.getByTestId('sections-de-configuration')).toBeTruthy();
  });

  it('marque la section lue par deux signes, jamais par la couleur seule', async () => {
    await monter(<CompositionDuCommerce businessId="b1" />);

    const style = screen.getByTestId('section-catalogue').props.style;
    expect(style.borderLeftWidth).toBe(3);
    expect(style.backgroundColor).not.toBe('transparent');
    // Et la section qu'on ne lit pas ne porte ni l'un ni l'autre.
    const autre = screen.getByTestId('section-horaires').props.style;
    expect(autre.backgroundColor).toBe('transparent');
  });
});

describe('la table des matières, en compact', () => {
  it('reste le seul endroit d’où l’on choisit', async () => {
    // Deux colonnes ne tiennent pas sur 390. Supprimer la page ici laisserait
    // le commerce sans aucun accès à ses trois sections.
    mockGabarit.large = false;
    await monter(<ConfigurationScreen onOuvrir={jest.fn()} />);

    expect(screen.getByTestId('ecran-configuration')).toBeTruthy();
    for (const porte of ['catalogue', 'horaires', 'activation']) {
      expect(screen.getByTestId(`ouvrir-${porte}`)).toBeTruthy();
    }
    expect(screen.getByText(en.composition.titre)).toBeTruthy();
  });
});
