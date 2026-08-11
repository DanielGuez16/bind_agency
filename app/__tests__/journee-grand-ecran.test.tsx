/**
 * La journée du comptoir en deux colonnes.
 *
 * **Le gabarit est simulé, pas mesuré.** `useGabarit` lit une largeur de
 * conteneur, que l'environnement de test rend toujours nulle : sans ce
 * remplacement, le chemin grand écran ne serait jamais parcouru et cette mise
 * en page partirait en production sans qu'un seul test l'ait vue.
 *
 * Ce qui est vérifié ici est ce que la mise en deux colonnes ajoute : le
 * panneau n'ouvre rien tant qu'on n'a pas choisi, il ouvre la ligne qu'on
 * touche, et la liste garde sa largeur de 400.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { JourneeScreen } from '../src/screens/JourneeScreen';
import { ThemeProvider, breakpoint } from '../src/theme';

jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: 1512, large: true }),
}));

const JOURNEE: {
  jour: string;
  timezone: string;
  debut: string;
  fin: string;
  a_trancher: Record<string, unknown>[];
  items: Record<string, unknown>[];
} = {
  jour: '2026-08-10',
  timezone: 'America/New_York',
  debut: '2026-08-10T12:00:00Z',
  fin: '2026-08-11T00:00:00Z',
  a_trancher: [],
  items: [
    {
      booking_id: 'b-1',
      status: 'confirmed',
      starts_at: '2026-08-10T18:30:00Z',
      ends_at: '2026-08-10T19:15:00Z',
      valid_until: '2026-08-11T00:00:00Z',
      creator_id: 'c-1',
      creator_first_name: 'Lea',
      creator_last_name: null,
      creator_handle: 'lea.mrl',
      item_name: 'Gel manicure',
      duration_minutes: 45,
      platform: 'instagram',
      content_format: 'story',
      required_mention: null,
      required_geotag: false,
      contrepartie: null,
    },
    {
      booking_id: 'b-2',
      status: 'confirmed',
      starts_at: '2026-08-10T19:15:00Z',
      ends_at: '2026-08-10T20:05:00Z',
      valid_until: '2026-08-11T00:00:00Z',
      creator_id: 'c-2',
      creator_first_name: 'Sofia',
      creator_last_name: null,
      creator_handle: 'sofia.rz',
      item_name: 'Classic pedicure',
      duration_minutes: 50,
      platform: 'instagram',
      content_format: 'post',
      required_mention: '@velanailstudio',
      required_geotag: true,
      contrepartie: null,
    },
  ],
};

function monter(journee: typeof JOURNEE = JOURNEE) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () =>
      ({ ok: true, status: 200, json: async () => journee }) as Response,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api}>
          <JourneeScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('journée du comptoir, grand écran', () => {
  it('ouvre le panneau sur la première ligne plutôt que sur une phrase', async () => {
    // **Il ne s'ouvrait sur rien**, au motif que pré-ouvrir ferait croire
    // qu'une ligne demande quelque chose. Les deux tiers de l'écran restaient
    // alors occupés par « choisissez une réservation à gauche », et c'est ce
    // qu'un commerçant voyait chaque matin.
    await monter();
    await waitFor(() => expect(screen.getAllByText('Gel manicure').length).toBeGreaterThan(0));

    expect(screen.getByTestId('detail-de-la-ligne')).toHaveTextContent(/Gel manicure/);
    expect(screen.queryByTestId('aucune-ligne-ouverte')).toBeNull();
  });

  it('met devant ce qui attend une décision, avant le planning', async () => {
    // C'est la seule chose de la journée qui réclame un geste.
    await monter({
      ...JOURNEE,
      a_trancher: [{ ...JOURNEE.items[1], booking_id: 'b-9', item_name: 'Balayage' }],
    });
    await waitFor(() => expect(screen.getAllByText('Gel manicure').length).toBeGreaterThan(0));

    expect(screen.getByTestId('detail-de-la-ligne')).toHaveTextContent(/Balayage/);
  });

  it('ouvre la ligne qu’on touche, et elle seule', async () => {
    await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-b-2')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('ligne-b-2'));

    const detail = screen.getByTestId('detail-de-la-ligne');
    expect(detail).toHaveTextContent(/Classic pedicure/);
    expect(detail).not.toHaveTextContent(/Gel manicure/);
    expect(screen.queryByTestId('aucune-ligne-ouverte')).toBeNull();
  });

  it('montre au comptoir ce qu’il devra vérifier sur la publication', async () => {
    // La mention et le lieu vivent sur l'offre de palier. Sans eux ici, on
    // sert sans savoir ce qu'on exigera ensuite, et il faut aller le chercher
    // ailleurs au moment où quelqu'un attend devant soi.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-b-2')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('ligne-b-2'));
    expect(screen.getByTestId('mention-attendue')).toHaveTextContent(/@velanailstudio/);
    expect(screen.getByTestId('lieu-attendu')).toBeTruthy();

    // Et rien n'est affiché quand l'offre n'exige rien : un cadre vide ferait
    // croire à une donnée perdue.
    await fireEvent.press(screen.getByTestId('ligne-b-1'));
    expect(screen.queryByTestId('mention-attendue')).toBeNull();
    expect(screen.queryByTestId('lieu-attendu')).toBeNull();
  });

  it('borne la liste à sa largeur, sans l’étirer', async () => {
    // 400 vient de `rules.md` §8 et n'a pas bougé en v0.6. Étirée, la liste
    // cesse d'être une liste et devient une seconde colonne de contenu.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-b-1')).toBeTruthy());

    const liste = screen.getByTestId('ligne-b-1').parent?.parent;
    expect(liste?.props.style).toEqual(
      expect.objectContaining({ width: breakpoint.listWidthMerchant }),
    );
  });
});
