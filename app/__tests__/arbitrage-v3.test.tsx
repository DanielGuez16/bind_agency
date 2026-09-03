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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

// **La file en tableau n'existe qu'en grand écran.** En compact l'arbitrage
// empile ses dossiers : c'est la colonne « Reasons » qu'on éprouve ici, et elle
// n'a pas de sens sans tableau.
jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  // `place` vient de la règle elle-même : la recopier ici ferait un
  // double qui dérive le jour où le seuil bouge.
  useGabarit: () => ({
    largeur: 1512,
    large: true,
    place: (besoin: number) =>
      (require('../src/shell/placeDisponible') as typeof import('../src/shell/placeDisponible'))
        .placeDisponible(1512, besoin),
  }),
}));

import { ApiClient, ApiProvider } from '../src/api';
import { en } from '../src/i18n/en';
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
  /** Le décor minimal : des tentatives, et le verdict du serveur. */
  const F = (motifs: string[], memeMotifRepete: boolean) =>
    formeDuMalentendu({ tentatives: motifs.map((motif) => T(motif)), meme_motif_repete: memeMotifRepete });

  it('le verdict vient du serveur, jamais d’une comparaison locale', () => {
    // **Le cas qui diverge de « tous les motifs identiques ».** C'est la
    // dérivation que je portais, et elle était subtilement fausse : ici les
    // trois derniers refus portent sur la même chose, la demande n'a jamais été
    // comprise, et le serveur le dit — alors qu'une comparaison de l'ensemble
    // répondrait « mélangé » à cause du premier.
    const forme = F(['wrong_format', 'missing_mention', 'missing_mention', 'missing_mention'], true);
    expect(forme.meme).toBe(true);
    expect(motDeLaForme(forme)).toBe('meme');
  });

  it('et l’inverse aussi : trois fois le même motif, mais pas de suite', () => {
    // Mention, format, mention fait deux occurrences et une seule suite.
    // Compter les occurrences proposerait « fermer sans faute » sur un dossier
    // où deux choses clochaient réellement — là où il faut trancher.
    const forme = F(['missing_mention', 'wrong_format', 'missing_mention'], false);
    expect(forme.meme).toBe(false);
    expect(motDeLaForme(forme)).toBe('melange');
  });

  it('le compte porte sur les reproches, pas sur la suite', () => {
    // La colonne écrit « 4 · same » : le nombre dit combien de fois on a
    // refusé, le mot dit si le dernier reproche boucle. Les confondre ferait
    // écrire « 3 · same » sur un dossier qui a quatre refus.
    expect(F(['wrong_format', 'missing_mention', 'missing_mention', 'missing_mention'], true).compte).toBe(4);
  });

  it('une tentative sans motif ne compte pas', () => {
    // Une tentative sans reproche n'en est pas un, et la compter gonflerait le
    // nombre que l'arbitre lit pour décider.
    expect(F(['missing_mention', ''], false).compte).toBe(1);
  });

  it('un seul reproche ne porte aucun mot', () => {
    // Écrire « 1 · same » ferait lire une répétition là où il n'y a qu'un
    // premier refus.
    expect(motDeLaForme(F(['missing_mention'], false))).toBeNull();
  });

  it('et le champ absent se lit « pas de répétition », jamais l’inverse', () => {
    // **Sous-proposer est le bon défaut.** Une réponse d'avant le champ ne doit
    // pas faire clore un dossier sans faute : sur-proposer fermerait là où il
    // fallait trancher.
    const forme = formeDuMalentendu({
      tentatives: [T('missing_mention'), T('missing_mention')],
    } as never);
    expect(forme.meme).toBe(false);
    expect(formeDuMalentendu({} as never)).toMatchObject({ compte: 0, meme: false });
  });
});

const DOSSIER_POUR_CLOTURE = (
  id: string,
  motifs: string[],
  memeMotifRepete: boolean,
  suite?: number,
) => ({
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
  repetitions_du_dernier_motif: suite ?? (memeMotifRepete ? motifs.length : 1),
  meme_motif_repete: memeMotifRepete,
  derniere_soumission: null,
});

describe('la file distingue les deux dossiers', () => {
  async function monter(lignes: unknown[], motifs: unknown[] = []) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      // **Par chemin.** Répondre la file à l'agrégat des motifs lui donnerait
      // des lignes dont le motif est absent, rendues sans que rien ne tombe.
      fetchImpl: (async (url: unknown) =>
        ({
          ok: true,
          status: 200,
          json: async () =>
            String(url).includes('motifs-qui-reviennent') ? motifs : lignes,
        }) as Response) as unknown as typeof fetch,
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

  const DOSSIER = (id: string, motifs: string[], memeMotifRepete = false) => ({
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
    // Le verdict du serveur, qui est ce que l'écran lit.
    repetitions_du_dernier_motif: memeMotifRepete ? motifs.length : 1,
    meme_motif_repete: memeMotifRepete,
    derniere_soumission: null,
  });

  it('écrit « 3 · same » et « 3 · mixed » dans la colonne', async () => {
    await monter([
      DOSSIER('k1', ['missing_mention', 'missing_mention', 'missing_mention'], true),
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
      DOSSIER('k1', ['missing_mention', 'missing_mention', 'missing_mention'], true),
      DOSSIER('k2', ['missing_mention', 'missing_location', 'wrong_format']),
    ]);
    await waitFor(() => expect(screen.getByTestId('ligne-k2')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('filtre-meme-motif'));

    expect(screen.getByTestId('ligne-k1')).toBeTruthy();
    expect(screen.queryByTestId('ligne-k2')).toBeNull();
  });

  it('isole aussi les motifs différents, que rien n’offrait', async () => {
    // **La décision opposée, et elle n'avait pas de filtre.** `motDeLaForme`
    // rendait `melange` depuis toujours ; l'écran ne proposait que « même
    // motif », donc l'arbitre pouvait isoler la moitié qui dit « la demande n'a
    // jamais été comprise » et pas celle qui dit l'inverse.
    await monter([
      DOSSIER('k1', ['missing_mention', 'missing_mention', 'missing_mention'], true),
      DOSSIER('k2', ['missing_mention', 'missing_location', 'wrong_format']),
    ]);
    await waitFor(() => expect(screen.getByTestId('ligne-k2')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('filtre-motifs-differents'));

    expect(screen.getByTestId('ligne-k2')).toBeTruthy();
    expect(screen.queryByTestId('ligne-k1')).toBeNull();
  });

  it('les deux axes se remettent à zéro chacun chez soi', async () => {
    /**
     * **Le défaut de cadrage.** « Même motif » était un interrupteur posé près
     * des formats : « Tous » ne remettait à zéro que le format, et
     * l'interrupteur restait allumé sous une étiquette qui annonçait l'inverse.
     *
     * Le décor a **deux** dossiers de formes opposées : un axe qui ne filtrerait
     * rien passerait un décor à un seul.
     */
    await monter([
      DOSSIER('k1', ['missing_mention', 'missing_mention', 'missing_mention'], true),
      DOSSIER('k2', ['missing_mention', 'missing_location', 'wrong_format']),
    ]);
    await waitFor(() => expect(screen.getByTestId('ligne-k2')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('filtre-meme-motif'));
    expect(screen.queryByTestId('ligne-k2')).toBeNull();

    // Le « tous » des formats ne touche pas l'axe des motifs…
    await fireEvent.press(screen.getByTestId('filtre-tous'));
    expect(screen.queryByTestId('ligne-k2')).toBeNull();

    // …et celui des motifs le rend, sans avoir à deviner lequel des deux agit.
    await fireEvent.press(screen.getByTestId('filtre-toutes-formes'));
    expect(screen.getByTestId('ligne-k1')).toBeTruthy();
    expect(screen.getByTestId('ligne-k2')).toBeTruthy();
  });

  it('le dossier nomme la forme en une phrase, avant tout journal', async () => {
    // Une phrase de six mots au lieu d'un journal, et elle suffit à savoir de
    // quel côté est l'incompréhension.
    await monter([DOSSIER('k1', ['missing_mention', 'missing_mention', 'missing_mention'], true)]);
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

describe('clore sans faute', () => {
  async function monterDossier(lignes: unknown[]) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') envois.push(JSON.parse(String(init.body)));
        // Par chemin : la file rendue à l'agrégat lui donnerait des lignes sans
        // motif, affichées sans que rien ne tombe.
        const corps = String(url).includes('motifs-qui-reviennent') ? [] : lignes;
        return { ok: true, status: 200, json: async () => corps } as Response;
      }) as unknown as typeof fetch,
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
  let envois: unknown[] = [];
  beforeEach(() => {
    envois = [];
  });

  const MEME = () =>
    DOSSIER_POUR_CLOTURE('k1', ['missing_mention', 'missing_mention', 'missing_mention'], true);
  const MELANGE = () =>
    DOSSIER_POUR_CLOTURE('k1', ['missing_mention', 'wrong_format', 'missing_location'], false);

  it('passe devant quand le même motif boucle', async () => {
    // **Ni approuver ni refuser n'est juste** : le produit a échoué à
    // transmettre une demande, et la trancher comme une faute la met au débit
    // de la mauvaise personne. L'arbitre qui tranche vingt dossiers à la chaîne
    // appuie sur le premier bouton — c'est là que l'ordre décide.
    await monterDossier([MEME()]);
    await waitFor(() => expect(screen.getByTestId('decisions-k1')).toBeTruthy());

    // **En régex : le bouton porte aussi son raccourci clavier.** Sur une
    // chaîne, `toHaveTextContent` compare le contenu entier, et « CClose it, no
    // fault » n'est pas « Close it, no fault ».
    const boutons = within(screen.getByTestId('decisions-k1')).getAllByRole('button');
    expect(boutons[0]).toHaveTextContent(new RegExp(en.admin.issueCloreSansFaute));
  });

  it('et repasse derrière quand les motifs diffèrent', async () => {
    // Sans cette moitié, la garde passerait sur un écran qui la mettrait
    // toujours en tête — c'est-à-dire qui proposerait de fermer sans faute un
    // dossier où deux choses clochaient réellement.
    await monterDossier([MELANGE()]);
    await waitFor(() => expect(screen.getByTestId('decisions-k1')).toBeTruthy());

    const boutons = within(screen.getByTestId('decisions-k1')).getAllByRole('button');
    expect(boutons[0]).not.toHaveTextContent(new RegExp(en.admin.issueCloreSansFaute));
    // Elle reste offerte : un arbitre peut juger que la demande n'est pas
    // passée même sur des motifs mélangés. C'est l'ordre qui conseille, pas la
    // présence.
    expect(
      within(screen.getByTestId('decisions-k1')).getByText(en.admin.issueCloreSansFaute),
    ).toBeTruthy();
  });

  it('envoie l’issue du serveur, et sans motif', async () => {
    // Les trois autres décisions exigent un motif parce qu'elles reprochent
    // quelque chose ; celle-ci ne reproche rien, et demander de nommer un tort
    // avant de dire qu'il n'y en a pas la contredirait.
    await monterDossier([MEME()]);
    await waitFor(() => expect(screen.getByTestId('decisions-k1')).toBeTruthy());

    await fireEvent.press(
      within(screen.getByTestId('decisions-k1')).getByText(en.admin.issueCloreSansFaute),
    );

    expect(envois).toEqual([{ issue: 'close_no_fault' }]);
  });

  it('la phrase compte la suite, pas les reproches', async () => {
    // **Elle affirme une répétition, donc elle doit dire combien de fois de
    // suite.** Quatre reproches dont trois identiques à la fin : écrire quatre
    // serait faux, et c'est le décor qui fait diverger les deux nombres.
    await monterDossier([
      DOSSIER_POUR_CLOTURE(
        'k1',
        ['wrong_format', 'missing_mention', 'missing_mention', 'missing_mention'],
        true,
        3,
      ),
    ]);
    await waitFor(() => expect(screen.getByTestId('forme-du-malentendu')).toBeTruthy());

    expect(screen.getByTestId('forme-du-malentendu')).toHaveTextContent(/asked 3 times/);
    // Et la colonne garde le compte des reproches : les deux nombres ne disent
    // pas la même chose.
    expect(screen.getByTestId('ligne-k1')).toHaveTextContent(/4 · same/);
  });
});
