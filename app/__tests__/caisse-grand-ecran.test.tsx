/**
 * La caisse sur grand écran.
 *
 * Ce que la version de bureau ajoute et que rien n'éprouvait : la barre sur
 * encre, le pavé de douze touches, et le fait que les deux entrées — pavé et
 * clavier — arrivent dans la même valeur.
 *
 * Le gabarit est simulé : l'environnement de test rend toujours une largeur
 * nulle, et sans ce remplacement aucun de ces éléments ne serait monté.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { RedemptionScreen, type Scanner } from '../src/screens/RedemptionScreen';
import { ThemeProvider } from '../src/theme';

jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: 1512, large: true }),
}));

const scannerFactice: Scanner = ({ onCode }) => (
  <Pressable accessibilityRole="button" onPress={() => onCode('c1:123456')}>
    <Text>scanner-factice</Text>
  </Pressable>
);

function repond(reponses: Array<{ ok: boolean; corps: object }>) {
  const file = [...reponses];
  global.fetch = jest.fn().mockImplementation(async () => {
    const suivante = file.shift() ?? { ok: true, corps: {} };
    return { ok: suivante.ok, status: suivante.ok ? 200 : 409, json: async () => suivante.corps };
  }) as unknown as typeof fetch;
}

/** Une place déjà servie, avec l'échéance que le serveur a calculée. */
const SERVI = {
  booking_id: 'b-9',
  status: 'consumed',
  starts_at: '2026-08-11T14:00:00Z',
  ends_at: '2026-08-11T14:45:00Z',
  valid_until: '2026-08-11T23:00:00Z',
  creator_id: 'c-9',
  creator_first_name: 'Lea',
  creator_last_name: null,
  creator_handle: 'lea.mrl',
  item_name: 'Gel manicure',
  duration_minutes: 45,
  platform: 'instagram',
  content_format: 'story',
  required_mention: null,
  required_geotag: false,
  contrepartie: {
    collaboration_id: 'k-9',
    status: 'attendue',
    deadline_at: '2026-08-13T14:00:00Z',
    attempts_count: 0,
    needs_human_review: false,
  },
};

function clientDeJournee(items: unknown[]) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          jour: '2026-08-11',
          timezone: 'America/New_York',
          debut: '',
          fin: '',
          items,
          a_trancher: [],
        }),
      }) as Response,
  });
}

async function afficher(scanner?: Scanner, options: { items?: unknown[] } = {}) {
  return render(
    <ThemeProvider role="merchant">
      <I18nProvider initialLocale="en">
        <ApiProvider client={clientDeJournee(options.items ?? [])}>
          <RedemptionScreen
            apiUrl="http://test/api/v1"
            accessToken="un-jeton"
            scanner={scanner}
            businessId="b1"
          />
        </ApiProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('caisse, grand écran', () => {
  it('pose la barre de caisse sur encre', async () => {
    // Le seul écran commerce qui se lit debout, à un mètre, entre deux
    // clientes : le contraste maximal y est un choix de lisibilité.
    repond([]);
    await afficher();

    expect(screen.getByTestId('barre-de-caisse')).toBeTruthy();
  });

  it('garde le pavé, et le fait entrer dans le même champ que le clavier', async () => {
    // Au comptoir on tape d'une main. Les deux entrées arrivent dans la même
    // valeur : rien ne les distingue à l'arrivée.
    repond([]);
    await afficher();

    await fireEvent.changeText(screen.getByTestId('champ-code'), '9K');
    await fireEvent.press(screen.getByTestId('touche-4'));
    await fireEvent.press(screen.getByTestId('touche-A'));

    expect(screen.getByTestId('champ-code').props.value).toBe('9K4A');
  });

  it('n’offre aucune touche absente de l’alphabet des codes', async () => {
    // `0`, `1`, `I` et `O` n'existent pas dans un code de secours : les
    // proposer ne fabriquerait que des refus, et le comptoir accuserait la
    // cliente.
    repond([]);
    await afficher();

    for (const interdit of ['0', '1', 'I', 'O']) {
      expect(screen.queryByTestId(`touche-${interdit}`)).toBeNull();
    }
  });

  it('efface la saisie sans rien envoyer', async () => {
    repond([]);
    await afficher();

    await fireEvent.press(screen.getByTestId('touche-7'));
    await fireEvent.press(screen.getByTestId('effacer-code'));

    expect(screen.getByTestId('champ-code').props.value).toBe('');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('garde la saisie manuelle au premier rang, scanner ou non', async () => {
    // Dans un salon, une caméra sale ou une lumière rasante arrivent tous les
    // jours. Le champ est utilisable d'emblée.
    repond([]);
    await afficher(scannerFactice);

    expect(screen.getByTestId('champ-code')).toBeTruthy();
    expect(screen.getByText(en.redemption.manualHint)).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// campagne 2 : les deux tiers vides à droite
// --------------------------------------------------------------------------

describe('le journal du jour', () => {
  it('occupe la place que le pavé laissait blanche', async () => {
    // « Le pavé de touches occupe le tiers gauche, le reste est vide. » Le
    // panneau était prévu par la passation v0.6 §5 et n'avait jamais été posé.
    repond([]);
    await afficher(undefined, { items: [SERVI] });

    await waitFor(() => expect(screen.getByTestId('servi-b-9')).toBeTruthy());
    expect(screen.getByTestId('servis-du-jour')).toBeTruthy();
  });

  it('porte l’échéance de publication de la place qu’on vient de donner', async () => {
    // C'est la seule chose que le commerce doit retenir d'une place donnée :
    // quand la contrepartie est attendue. Elle vient du serveur, jamais
    // recalculée ici — deux dates coexisteraient et l'une serait fausse.
    repond([]);
    await afficher(undefined, { items: [SERVI] });

    await waitFor(() => expect(screen.getByTestId('servi-b-9')).toBeTruthy());
    expect(screen.getByTestId('servi-b-9')).toHaveTextContent(/Publication due/);
  });

  it('dit le début de journée plutôt que de laisser un cadre blanc', async () => {
    // Un panneau vide se lit comme un chargement qui n'a pas abouti.
    repond([]);
    await afficher();

    await waitFor(() => expect(screen.getByTestId('servis-aucun')).toBeTruthy());
  });

  it('ne compte pas ce qui n’a pas été servi', async () => {
    // Une place confirmée n'est pas une place donnée : la faire figurer au
    // journal ferait croire le code déjà consommé.
    repond([]);
    await afficher(undefined, { items: [{ ...SERVI, status: 'confirmed' }] });

    await waitFor(() => expect(screen.getByTestId('servis-aucun')).toBeTruthy());
    expect(screen.queryByTestId('servi-b-9')).toBeNull();
  });
});
