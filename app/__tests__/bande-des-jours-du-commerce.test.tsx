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

/**
 * Les jours que le serveur rendra. Deux en portent, le reste non.
 *
 * **Le 3 et le 4 divergent, et c'est tout l'intérêt du décor.** Les deux sont à
 * zéro décision ; l'un est ouvert, l'autre fermé. Une implémentation qui
 * poserait « 0 » partout, ou « closed » partout, rendrait le même verdict sur
 * l'un des deux — il faut les deux cases pour qu'aucune ne puisse être devinée.
 */
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
  // **Deux jours, et c'est ce qui fait diverger les deux implémentations.**
  // Une file entièrement posée sur le même jour rendrait le même verdict
  // qu'on filtre ou non : le test n'aurait rien éprouvé. Les deux premières
  // tombent le 1er, la troisième le 2.
  starts_at: n < 2 ? '2026-09-01T18:00:00Z' : '2026-09-02T18:00:00Z',
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
        return rendre({ timezone: 'America/New_York', jours: BANDE });
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

  /**
   * **Un zéro, et non plus une case vide — l'arbitrage a été renversé.**
   *
   * Cette assertion disait `not.toHaveTextContent('0')`, sur l'argument qu'un
   * chiffre par jour ferait « sept chiffres à lire pour en retenir deux ». Il
   * valait pour une bande de sept cases tenant toutes à l'écran.
   *
   * La bande en porte quatorze et défile. Une case vide ne se distingue alors
   * plus d'une case pas encore arrivée, et c'est le doute que le chiffre lève.
   */
  expect(screen.getByTestId('jour-2026-09-03-decisions')).toHaveTextContent('0');
});

it('dit « fermé » sur un jour fermé, plutôt qu’un zéro qui se lirait « calme »', async () => {
  await monter();

  // Le 4 est fermé et à zéro, comme le 3 est ouvert et à zéro. Les deux cases
  // ne disent pas la même chose : « aucune demande » n'est pas « pas ouvert ».
  expect(screen.getByTestId('jour-2026-09-04-decisions')).toHaveTextContent('CLOSED');
  expect(screen.getByTestId('jour-2026-09-04-decisions')).not.toHaveTextContent('0');
});

it('demande quatorze jours au serveur, pas sept', async () => {
  await monter();

  // La constante d'écran est ce que la bande dessine **et** ce qu'elle demande :
  // les laisser diverger rendrait sept cases sur une piste de quatorze.
  const parJour = demandes.find((chemin) => chemin.includes('/bookings/par-jour'));
  expect(parJour).toContain('jours=14');
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

it('montre les décisions du jour choisi, et non celles d’aujourd’hui', async () => {
  // **Le défaut remonté par Daniel.** La file est servie toutes dates
  // confondues — c'était juste avant la bande : sans elle, filtrer aurait fait
  // disparaître une demande pour après-demain. La bande lève cette condition,
  // et ce qui restait était pire : la barre annonçait deux décisions mardi, on
  // ouvrait mardi, et la même liste s'affichait quel que soit le jour.
  await monter();

  expect(screen.getByTestId('ligne-attente-0')).toBeTruthy();
  expect(screen.getByTestId('ligne-attente-1')).toBeTruthy();
  expect(screen.queryByTestId('ligne-attente-2')).toBeNull();

  await fireEvent.press(screen.getByTestId('jour-2026-09-02'));

  await waitFor(() => expect(screen.getByTestId('ligne-attente-2')).toBeTruthy());
  expect(screen.queryByTestId('ligne-attente-0')).toBeNull();
});

it('ne dit la phrase de l’échéance qu’une fois', async () => {
  // La fusion des deux phrases concurrentes en a laissé une seule — mais la
  // même, à deux endroits de la même carte et dans deux formats.
  await monter();

  expect(screen.getByTestId('limite-attente-0')).toBeTruthy();
  expect(screen.queryByTestId('echeance-decision-attente-0')).toBeNull();
});
