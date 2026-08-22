/**
 * L'arbitrage v3 : la forme du malentendu, pas la conversation.
 *
 * **Trois refus pour le même motif ne disent pas qu'une créatrice est de
 * mauvaise foi.** Ils disent que la demande n'a jamais été comprise, et que la
 * liste fermée de motifs n'a pas su la porter. Trois motifs différents disent
 * l'inverse. C'est le même nombre de pixels et ce n'est pas la même décision.
 *
 * **Ce que ces tests éprouvent d'abord est la distinction elle-même**, parce que
 * c'est la seule chose ici qui puisse être fausse plutôt que laide. Un décor
 * recopié de la planche — trois fois le même motif — ne distingue pas une
 * implémentation qui compare les motifs d'une qui répond toujours « same ».
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// **La file en tableau n'existe qu'en grand écran.** En compact l'arbitrage
// empile ses dossiers : c'est la colonne « Reasons » qu'on éprouve ici, et elle
// n'a pas de sens sans tableau.
jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: 1512, large: true }),
}));

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { ArbitrageScreen } from '../src/screens/ArbitrageScreen';
import { formeDuMalentendu, motDeLaForme } from '../src/screens/arbitrage/formeDuMalentendu';
import { ThemeProvider } from '../src/theme';

const T = (motif: string, note: string | null = null) => ({
  motif,
  note,
  demandee_le: '2026-08-18T09:00:00Z',
  par: 'business_member' as const,
});

describe('la forme du malentendu', () => {
  it('trois fois le même motif : le produit n’a pas su transmettre', () => {
    const forme = formeDuMalentendu([T('missing_mention'), T('missing_mention'), T('missing_mention')]);
    expect(forme).toMatchObject({ compte: 3, meme: true });
    expect(motDeLaForme(forme)).toBe('meme');
  });

  it('trois motifs différents : ce n’est pas le même dossier', () => {
    // **Le cas qui diverge de « réponds toujours same ».** Un décor recopié de
    // la maquette ne les sépare pas : la planche ne dessine qu'un dossier
    // « same », et un écran qui écrirait « same » partout lui ressemblerait
    // trait pour trait.
    const forme = formeDuMalentendu([T('missing_mention'), T('missing_location'), T('wrong_format')]);
    expect(forme).toMatchObject({ compte: 3, meme: false });
    expect(motDeLaForme(forme)).toBe('melange');
  });

  it('et deux sur trois ne suffisent pas', () => {
    // **Le cas qui diverge de « le premier motif revient quelque part ».** Deux
    // fois la mention et une fois le lieu, c'est un mélange : la créatrice a
    // corrigé quelque chose entre-temps, et la clôture sans faute ne s'y
    // applique pas.
    const forme = formeDuMalentendu([T('missing_mention'), T('missing_mention'), T('missing_location')]);
    expect(forme.meme).toBe(false);
  });

  it('un motif unique n’est pas un motif répété', () => {
    // Écrire « 1 · same » ferait lire une répétition là où il n'y a qu'un
    // premier refus — et proposerait la clôture sans faute avant même qu'on
    // ait pu se tromper deux fois.
    const forme = formeDuMalentendu([T('missing_mention')]);
    expect(forme.meme).toBe(false);
    expect(motDeLaForme(forme)).toBeNull();
  });

  it('une tentative sans motif ne compte pas', () => {
    // `par` dit qui a demandé la reprise ; une tentative sans reproche n'en est
    // pas un, et la compter gonflerait le nombre que l'arbitre lit pour décider.
    const forme = formeDuMalentendu([T('missing_mention'), T('')]);
    expect(forme.compte).toBe(1);
  });

  it('et l’absence du champ se traite comme son absence de valeur', () => {
    expect(formeDuMalentendu(null)).toMatchObject({ compte: 0, meme: false });
    expect(formeDuMalentendu(undefined)).toMatchObject({ compte: 0, meme: false });
    expect(motDeLaForme(formeDuMalentendu([]))).toBeNull();
  });
});

describe('la file distingue les deux dossiers', () => {
  async function monter(lignes: unknown[]) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async () =>
        ({ ok: true, status: 200, json: async () => lignes }) as Response) as unknown as typeof fetch,
    });
    return await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="admin">
          <ApiProvider client={api}>
            <ArbitrageScreen />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
  }

  const DOSSIER = (id: string, motifs: string[]) => ({
    collaboration_id: id,
    booking_id: `b-${id}`,
    status: 'under_review',
    required_format: 'story',
    required_mention: '@vela',
    required_geotag: false,
    deadline_at: '2026-08-25T12:00:00Z',
    attempts_count: motifs.length,
    needs_human_review: true,
    created_at: '2026-08-18T09:00:00Z',
    business_id: 'b1',
    business_name: 'Vela Nail Studio',
    creator_id: 'u1',
    creator_first_name: null,
    creator_last_name: null,
    creator_handle: '@lea.mrl',
    creator_partie: false,
    platform: 'instagram',
    item_name: 'Gel manicure',
    dernier_motif: motifs.at(-1) ?? null,
    tentatives: motifs.map((motif) => T(motif)),
    derniere_soumission: null,
  });

  it('écrit « 3 · same » et « 3 · mixed » dans la colonne', async () => {
    await monter([
      DOSSIER('k1', ['missing_mention', 'missing_mention', 'missing_mention']),
      DOSSIER('k2', ['missing_mention', 'missing_location', 'wrong_format']),
    ]);
    await waitFor(() => expect(screen.getByTestId('ligne-k1')).toBeTruthy());

    expect(screen.getByTestId('ligne-k1')).toHaveTextContent(/3 · same/);
    expect(screen.getByTestId('ligne-k2')).toHaveTextContent(/3 · mixed/);
  });

  it('et le filtre garde les uns sans les autres', async () => {
    // Une file de trente dossiers mêle ceux que le produit a ratés et ceux où
    // la créatrice n'a pas suivi : ce ne sont pas les mêmes décisions.
    await monter([
      DOSSIER('k1', ['missing_mention', 'missing_mention', 'missing_mention']),
      DOSSIER('k2', ['missing_mention', 'missing_location', 'wrong_format']),
    ]);
    await waitFor(() => expect(screen.getByTestId('ligne-k2')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('filtre-meme-motif'));

    expect(screen.getByTestId('ligne-k1')).toBeTruthy();
    expect(screen.queryByTestId('ligne-k2')).toBeNull();
  });

  it('le dossier nomme la forme en une phrase, avant tout journal', async () => {
    // Une phrase de six mots au lieu d'un journal, et elle suffit à savoir de
    // quel côté est l'incompréhension.
    await monter([DOSSIER('k1', ['missing_mention', 'missing_mention', 'missing_mention'])]);
    await waitFor(() => expect(screen.getByTestId('forme-du-malentendu')).toBeTruthy());

    expect(screen.getByTestId('forme-du-malentendu')).toHaveTextContent(/same thing was asked 3/);
  });

  it('et il le dit autrement quand les motifs diffèrent', async () => {
    // Sans cette moitié, la garde passerait sur un écran qui écrirait « le même
    // trois fois » sur tous les dossiers — exactement la faute qu'elle vise.
    await monter([DOSSIER('k1', ['missing_mention', 'missing_location', 'wrong_format'])]);
    await waitFor(() => expect(screen.getByTestId('forme-du-malentendu')).toBeTruthy());

    expect(screen.getByTestId('forme-du-malentendu')).toHaveTextContent(/3 different things/);
  });
});
