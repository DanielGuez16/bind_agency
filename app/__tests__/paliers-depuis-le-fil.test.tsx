/**
 * Les paliers ne sont plus un onglet : ils sont une ligne du fil.
 *
 * **Ce que l'onglet faisait de travers.** Un onglet répond à une question qu'on
 * se pose en ouvrant l'application. « Quel est mon palier » n'en est pas une :
 * ce que la créatrice veut savoir, c'est **ce qu'elle peut réserver**, et c'est
 * le fil qui répond. Les paliers sont la raison, pas la réponse — rangés dans
 * un onglet, ils étaient offerts à qui n'avait pas posé la question.
 *
 * La ligne dit donc le nombre d'abord, et l'explication s'ouvre depuis elle.
 * L'information reste, elle arrive au moment où elle sert.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { FilScreen } from '../src/screens/FilScreen';
import { ThemeProvider } from '../src/theme';

const COMMERCE = {
  business_id: 'b1',
  name: 'Salon Ocean',
  category: 'beauty',
  address: '100 Ocean Dr',
  cover_photo_key: null,
  distance_metres: 420,
  items: [
    {
      tier_offer_id: 'o1',
      catalog_item_id: 'i1',
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

function filAvec(total: number, commerces = 1): Partial<Fil> {
  return {
    commerces: Array.from({ length: commerces }, () => COMMERCE) as Fil['commerces'],
    obstacles: [],
    total_prestations: total,
    // Le type les déclare obligatoires et le serveur les rend toujours : un
    // montage qui les omet fabrique une réponse qui n'existe pas, et rendrait
    // le composant défensif contre un cas qu'aucun appel n'atteint.
    rayons: [],
    quartiers: [],
    categories: [],
    prochain_palier: null,
  };
}

async function monter(fil: Partial<Fil>, onVoirMesPaliers?: () => void) {
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
            onVoirMesPaliers={onVoirMesPaliers}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la ligne qui répond, et l’explication qu’elle ouvre', () => {
  it('annonce ce qui est ouvert, avec le nombre', async () => {
    await monter(filAvec(12));
    await waitFor(() => expect(screen.getByTestId('prestations-ouvertes')).toBeTruthy());

    expect(screen.getByTestId('prestations-ouvertes')).toHaveTextContent(/\b12\b/);
  });

  it('ouvre les paliers quand on l’appuie', async () => {
    // C'est tout le déplacement : l'explication naît d'une question posée, pas
    // d'un onglet qu'on visite une fois et plus jamais.
    const ouvrir = jest.fn();
    await monter(filAvec(12), ouvrir);
    await waitFor(() => expect(screen.getByTestId('prestations-ouvertes')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('prestations-ouvertes'));
    expect(ouvrir).toHaveBeenCalledTimes(1);
  });

  it('dit « une prestation » au singulier', async () => {
    // Le cas du premier jour, pas le cas limite : le produit n'a pas de
    // machinerie de pluriel, il choisit entre deux clés là où ça compte.
    await monter(filAvec(1));
    await waitFor(() => expect(screen.getByTestId('prestations-ouvertes')).toBeTruthy());

    expect(screen.getByTestId('prestations-ouvertes')).toHaveTextContent(
      en.parcours.filPrestationsOuverteUne,
    );
    expect(screen.getByTestId('prestations-ouvertes')).not.toHaveTextContent(/^1 /);
  });

  it('cède la place à l’état vide, qui dit mieux que zéro', async () => {
    // **Il n'y a pas de cas zéro à traiter.** Côté serveur, `total_prestations`
    // vaut `sum(len(commerce.items))` : il est nul exactement quand le fil est
    // vide, et un fil vide rend `RaisonDuVide` à la place de ce corps. Une
    // garde `total <= 0` dans le composant protégerait un état qu'aucun appel
    // n'atteint — et ce test, écrit d'abord avec un fil peuplé à total nul,
    // fabriquait une réponse que le serveur ne produit pas : il passait sans
    // rien couvrir. Ce qui se vérifie ici est le vrai chemin.
    await monter({ ...filAvec(0), commerces: [] });
    await waitFor(() => expect(screen.getByTestId('fil-vide')).toBeTruthy());

    expect(screen.queryByTestId('prestations-ouvertes')).toBeNull();
  });

  it('reste une phrase quand aucune issue n’est fournie', async () => {
    // Le sens inverse : sans chemin vers l'explication, la ligne informe
    // toujours. Un appui qui ne mène nulle part vaut moins que pas d'appui.
    await monter(filAvec(12));
    await waitFor(() => expect(screen.getByTestId('prestations-ouvertes')).toBeTruthy());

    expect(screen.getByTestId('prestations-ouvertes')).toHaveTextContent(/\b12\b/);
    expect(screen.queryByTestId('prestations-ouvertes-issue')).toBeNull();
  });

  it('les élargissements portent leur nombre, et aucun n’en promet zéro', async () => {
    // **Une issue à zéro est un cul-de-sac chiffré**, pire qu'une issue
    // absente : elle promet un geste dont on revient bredouille. Le fil vide
    // est le seul endroit où ces boutons se montrent, donc le seul où
    // l'éprouver.
    await monter({
      ...filAvec(0),
      commerces: [],
      rayons: [
        { rayon_metres: 30000, commerces: 9, prestations: 12 },
        { rayon_metres: 50000, commerces: 0, prestations: 0 },
      ],
    } as never);
    await waitFor(() => expect(screen.getByTestId('fil-vide')).toBeTruthy());

    const elargir = screen.getByTestId('elargir');
    // Celui qui ouvre quelque chose dit combien.
    expect(elargir).toHaveTextContent(/30/);
    expect(elargir).toHaveTextContent(/\b9\b/);
    // Celui qui n'ouvre rien n'est pas là.
    expect(elargir).not.toHaveTextContent(/50/);
  });
});
