/**
 * La bande de sept jours du comptoir.
 *
 * **Ce qu'elle apporte et qu'une liste ne donnerait pas** : un jour sans
 * décision se voit *sans être ouvert*. C'est une information au même titre
 * qu'une décision — savoir qu'il n'y a rien jeudi vaut d'être su sans appuyer
 * sur jeudi, et c'est ce qui distingue une bande d'un sélecteur de date.
 *
 * Le compte porté par chaque barre n'est **pas** la longueur de la file : la
 * file d'arbitrage porte tout, toutes dates confondues, et la bande dit *où*
 * sont les décisions. Le premier test tient sur cette distinction.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { JourneeScreen } from '../src/screens/JourneeScreen';
import { ThemeProvider } from '../src/theme';

const coffre = { lire: async () => ({ access_token: 'a', refresh_token: 'r' }), ecrire: async () => {} };

/** Les sept jours que le serveur rendra. Deux en portent, cinq n'en portent pas. */
const BANDE = [
  { jour: '2026-09-01', decisions: 2, ouvert: true },
  { jour: '2026-09-02', decisions: 1, ouvert: true },
  { jour: '2026-09-03', decisions: 0, ouvert: true },
  { jour: '2026-09-04', decisions: 0, ouvert: false },
  { jour: '2026-09-05', decisions: 0, ouvert: true },
  { jour: '2026-09-06', decisions: 0, ouvert: true },
  { jour: '2026-09-07', decisions: 0, ouvert: true },
];

/**
 * La file, **plus longue que ce que la bande porte sur un jour**.
 *
 * C'est le décor qui fait diverger les deux implémentations : une bande qui
 * recopierait la longueur de la file afficherait trois partout. Avec une file
 * de trois et un jour à deux, les deux réponses ne peuvent plus coïncider.
 */
const FILE = [0, 1, 2].map((n) => ({
  booking_id: `attente-${n}`,
  business_id: 'b1',
  status: 'awaiting_business',
  starts_at: '2026-09-01T18:00:00Z',
  ends_at: '2026-09-01T18:45:00Z',
  valid_until: '2026-09-08T00:00:00Z',
  created_at: '2026-08-30T09:00:00Z',
  item_name: 'Gel manicure',
  item_photo_key: null,
  duration_minutes: 45,
  platform: 'instagram',
  content_format: 'story',
  creator_id: `c${n}`,
  creator_handle: `lea.mrl.${n}`,
  creator_avatar_key: null,
  creator_profil_url: null,
  contrepartie: null,
  approval_expires_at: '2026-09-01T16:00:00Z',
}));

/** Les chemins demandés, dans l'ordre : c'est là qu'on lit le jour choisi. */
let demandes: string[] = [];

function client() {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) => {
      const chemin = String(url);
      demandes.push(chemin);
      const rendre = (corps: unknown) =>
        ({ ok: true, status: 200, json: async () => corps }) as Response;

      // L'ordre compte : « /bookings/par-jour » contient « /bookings ».
      if (chemin.includes('/bookings/par-jour')) {
        return rendre({ timezone: 'America/New_York', jours: BANDE, sans_date: 0 });
      }
      if (chemin.includes('/support-access')) return rendre([]);
      if (chemin.includes('/bookings')) {
        // Le jour rendu suit celui qui est demandé : sans cela, choisir un jour
        // ne changerait rien à l'écran et le test ne saurait pas le dire.
        const demande = new URL(chemin, 'https://api.test').searchParams.get('jour');
        return rendre({
          jour: demande ?? '2026-09-01',
          timezone: 'America/New_York',
          debut: '2026-09-01T12:00:00Z',
          fin: '2026-09-02T00:00:00Z',
          horaires: [],
          items: [],
          a_trancher: FILE,
          reprise_en_cours: null,
        });
      }
      return rendre({});
    },
  });
}

async function monter() {
  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={client()}>
          <JourneeScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('ecran-journee')).toBeTruthy());
  // eslint-disable-next-line no-console
  console.log(
    'IDS',
    screen
      .toJSON &&
      JSON.stringify(
        screen.root ? [] : [],
      ),
  );
  const tous: string[] = [];
  const parcourir = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.props?.testID) tous.push(String(n.props.testID));
    (n.children ?? []).forEach(parcourir);
  };
  parcourir(screen.toJSON());
  console.log('TESTIDS', JSON.stringify(tous));
  await waitFor(() => expect(screen.getByTestId('bande-des-jours')).toBeTruthy());
  return vue;
}

beforeEach(() => {
  demandes = [];
});

it('porte le compte du jour, et non la longueur de la file', async () => {
  await monter();

  // Trois demandes dans la file, deux sur le premier jour : une bande qui
  // recopierait la file dirait trois partout.
  expect(screen.getByTestId('jour-2026-09-01-decisions')).toHaveTextContent('2');
  expect(screen.getByTestId('jour-2026-09-02-decisions')).toHaveTextContent('1');
});

it('montre le jour sans décision sans qu’on l’ouvre', async () => {
  await monter();

  // **La case existe, et elle est vide.** Un jour calme qui disparaîtrait de la
  // bande se lirait comme un jour qu'on n'a pas encore chargé ; un « 0 » sur
  // chaque jour ferait sept chiffres à lire pour en retenir deux.
  expect(screen.getByTestId('jour-2026-09-03')).toBeTruthy();
  expect(screen.getByTestId('jour-2026-09-03-decisions')).not.toHaveTextContent('0');
});

it('recharge la journée du jour choisi', async () => {
  await monter();
  demandes = [];

  await fireEvent.press(screen.getByTestId('jour-2026-09-04'));

  await waitFor(() =>
    expect(demandes.some((chemin) => chemin.includes('jour=2026-09-04'))).toBe(true),
  );
});

it('marque le jour choisi, et un seul', async () => {
  await monter();

  await fireEvent.press(screen.getByTestId('jour-2026-09-05'));

  await waitFor(() => {
    const barres = within(screen.getByTestId('bande-des-jours')).getAllByRole('button');
    const choisies = barres.filter(
      (barre) =>
        barre.props['aria-selected'] === true ||
        barre.props.accessibilityState?.selected === true,
    );
    expect(choisies).toHaveLength(1);
    expect(String(choisies[0].props.testID)).toBe('jour-2026-09-05');
  });
});
