/**
 * L'arbitrage en tableau, sur grand écran.
 *
 * Ce que la version de bureau ajoute : la file en colonnes, le dossier ouvert
 * à droite sans quitter la file, et l'approbation en lot — bornée aux
 * approbations, comme `components.md` §16 l'exige.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { ArbitrageScreen } from '../src/screens/ArbitrageScreen';
import { ThemeProvider } from '../src/theme';

jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: 1512, large: true }),
}));

const DANS_DEUX_JOURS = new Date(Date.now() + 48 * 3_600_000).toISOString();

function dossier(id: string, commerce: string) {
  return {
    collaboration_id: id,
    booking_id: `b-${id}`,
    status: 'under_review',
    required_format: 'post',
    required_mention: '@casabruma',
    required_geotag: true,
    deadline_at: DANS_DEUX_JOURS,
    attempts_count: 2,
    needs_human_review: true,
    created_at: DANS_DEUX_JOURS,
    business_id: `biz-${id}`,
    business_name: commerce,
    creator_id: `c-${id}`,
    creator_first_name: 'Sofia',
    creator_last_name: null,
    creator_handle: 'sofia.rz',
    platform: 'instagram',
    item_name: 'Signature facial',
    dernier_motif: null,
    tentatives: [],
    derniere_soumission: null,
  };
}

const FILE = [dossier('a1b2c3d4-0000', 'Casa Bruma Spa'), dossier('e5f6a7b8-1111', 'Vela Nail')];

function monter(espion?: (chemin: string) => void) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url) => {
      espion?.(String(url));
      return { ok: true, status: 200, json: async () => FILE } as Response;
    },
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="admin">
        <ApiProvider client={api}>
          <ArbitrageScreen />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('arbitrage, grand écran', () => {
  it('montre la file en tableau', async () => {
    await monter();
    await waitFor(() => expect(screen.getByTestId('entete-de-file')).toBeTruthy());

    expect(screen.getByTestId('ligne-a1b2c3d4-0000')).toBeTruthy();
    expect(screen.getByText('Casa Bruma Spa')).toBeTruthy();
  });

  it('ouvre un dossier sans quitter la file', async () => {
    // Arbitrer se fait en comparant : un dossier qui remplacerait la file
    // ferait perdre la place à chaque décision.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-a1b2c3d4-0000')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('ligne-a1b2c3d4-0000'));

    expect(screen.getByTestId('dossier-ouvert')).toBeTruthy();
    // La file est toujours là, la seconde ligne comprise.
    expect(screen.getByTestId('ligne-e5f6a7b8-1111')).toBeTruthy();
  });

  it('ne propose l’action de masse qu’une fois quelque chose coché', async () => {
    // Vide, la barre ne propose rien plutôt que de griser.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-a1b2c3d4-0000')).toBeTruthy());
    expect(screen.queryByTestId('barre-de-selection')).toBeNull();

    await fireEvent.press(screen.getByTestId('cocher-a1b2c3d4-0000'));
    expect(screen.getByTestId('barre-de-selection')).toBeTruthy();
    expect(screen.getByTestId('approuver-la-selection')).toBeTruthy();
  });

  it('cocher n’ouvre pas, et ouvrir ne coche pas', async () => {
    // Les deux gestes mènent à des décisions différentes : l'un approuve sans
    // regarder, l'autre ouvre pour regarder.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-a1b2c3d4-0000')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('cocher-a1b2c3d4-0000'));
    expect(screen.queryByTestId('dossier-ouvert')).toBeNull();

    await fireEvent.press(screen.getByTestId('ligne-e5f6a7b8-1111'));
    expect(screen.getByTestId('cocher-e5f6a7b8-1111').props.accessibilityState.checked).toBe(
      false,
    );
  });

  it('n’offre aucune action de masse qui ne soit une approbation', async () => {
    // `components.md` §16. Refuser en lot demanderait un motif commun à des
    // dossiers qu'on n'a pas ouverts — la décision qu'il ne faut pas rendre
    // facile.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-a1b2c3d4-0000')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('cocher-a1b2c3d4-0000'));

    const barre = screen.getByTestId('barre-de-selection');
    expect(barre).not.toHaveTextContent(/reject|unfulfilled|resubmit/i);
  });
});
