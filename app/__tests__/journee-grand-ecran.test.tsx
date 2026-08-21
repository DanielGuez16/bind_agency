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
      absence_signalable_a: '2026-08-10T18:50:00Z',
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
      absence_signalable_a: '2026-08-10T19:35:00Z',
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

    // Nommée plutôt que remontée par `.parent.parent` : la chaîne cassait au
    // premier conteneur ajouté, et ce qu'on veut vérifier est la largeur de la
    // colonne, pas la profondeur de l'arbre.
    expect(screen.getByTestId('colonne-liste').props.style).toEqual(
      expect.objectContaining({ width: breakpoint.listWidthMerchant }),
    );
  });
});

// --------------------------------------------------------------------------
// campagne 2 : la liste sélectionne, le panneau agit
// --------------------------------------------------------------------------

/**
 * Une demande en attente, et une place déjà servie.
 *
 * L'heure de la demande se calcule **depuis maintenant**. L'écran cesse de
 * proposer d'accorder une demande dont l'heure est passée — à juste titre — et
 * une date écrite en dur dans la fixture finit par tomber derrière, ce qui
 * ferait échouer le test un matin sans que rien n'ait changé.
 */
const DANS_UNE_HEURE = new Date(Date.now() + 3_600_000).toISOString();

const JOURNEE_COMPLETE = {
  ...JOURNEE,
  a_trancher: [
    {
      ...JOURNEE.items[0],
      booking_id: 'b-3',
      status: 'awaiting_business',
      starts_at: DANS_UNE_HEURE,
      ends_at: DANS_UNE_HEURE,
      valid_until: DANS_UNE_HEURE,
    },
  ],
  items: [
    ...JOURNEE.items,
    {
      ...JOURNEE.items[0],
      booking_id: 'b-4',
      status: 'consumed',
      starts_at: '2026-08-10T14:00:00Z',
      ends_at: '2026-08-10T14:45:00Z',
    },
  ],
};

describe('la journée, après la campagne 2', () => {
  it('ne redessine pas la ligne choisie dans le panneau', async () => {
    // Le panneau commençait par le **même composant** que la colonne de
    // gauche : il s'ouvrait sur une copie exacte de la carte qu'on venait de
    // choisir, et se lisait comme un doublon.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ligne-b-1')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('ligne-b-1'));

    expect(screen.getByTestId('detail-de-la-ligne')).toBeTruthy();
    // La ligne n'existe qu'une fois dans l'arbre : à gauche. Le panneau
    // reprend les mêmes faits sous une autre forme, pas le même objet.
    expect(screen.getAllByTestId('reservation-b-1')).toHaveLength(1);
  });

  it('ne met les gestes qu’à un seul endroit', async () => {
    // Les boutons vivaient dans la liste, ce qui laissait le panneau sans rien
    // à faire — d'où le tiers de hauteur occupé et le vide dessous.
    await monter(JOURNEE_COMPLETE);
    await waitFor(() => expect(screen.getByTestId('ligne-b-3')).toBeTruthy());

    expect(screen.getAllByTestId('accorder-b-3')).toHaveLength(1);
    expect(screen.getByTestId('detail-de-la-ligne')).toContainElement(
      screen.getByTestId('accorder-b-3'),
    );
  });

  it('donne le relief à ce qui attend une décision, et à lui seul', async () => {
    // **La v3 renverse la règle de la campagne 2**, qui avait aplati toute la
    // colonne au motif que deux formes physiques pour deux états de la même
    // chose obligent à réapprendre la lecture. C'était vrai de deux états ;
    // ce ne sont pas deux états, ce sont deux gestes. Une demande se soupèse,
    // le planning se parcourt. Le relief distingue ce qu'on lit de ce qu'on
    // survole — et le donner aux trois sections revient à ne rien mettre en
    // avant.
    await monter(JOURNEE_COMPLETE);
    await waitFor(() => expect(screen.getByTestId('demande-b-3')).toBeTruthy());

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    // La demande porte un fond, un filet et un rayon : c'est une carte.
    const carte = aplati(screen.getByTestId('demande-b-3').props.style);
    expect(carte.borderWidth).toBe(1);
    expect(carte.backgroundColor).toBeTruthy();

    // Les lignes du planning et des journées finies restent plates. Sans cette
    // moitié, la garde passerait sur un écran qui aurait donné le relief à
    // tout le monde — ce qui est exactement la faute qu'elle doit attraper.
    for (const id of ['b-1', 'b-2', 'b-4']) {
      const style = aplati(screen.getByTestId(`reservation-${id}`).props.style);
      expect({ id, bord: style.borderWidth ?? 0, fond: style.backgroundColor }).toEqual({
        id,
        bord: 0,
        fond: undefined,
      });
    }
  });

  it('dit qu’il n’y a rien à faire plutôt que de laisser un blanc', async () => {
    // Une place déjà servie n'appelle plus rien du comptoir. Un bloc vide
    // laisse chercher le bouton qu'on croit avoir manqué.
    await monter(JOURNEE_COMPLETE);
    await waitFor(() => expect(screen.getByTestId('ligne-b-4')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('ligne-b-4'));
    expect(screen.getByTestId('detail-sans-geste')).toBeTruthy();
  });
});
