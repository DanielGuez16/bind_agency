/**
 * Cinq champs servis depuis toujours, et rendus nulle part.
 *
 * Chacun a le même mode d'échec : rien ne tombe, l'écran paraît complet, et
 * l'information qui décide du geste suivant n'est pas là. La garde des champs
 * les a nommés ; ces tests éprouvent qu'ils sont **rendus**, ce qu'une garde
 * textuelle ne peut pas voir — elle constate qu'un nom apparaît, pas qu'il
 * arrive à l'écran.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { HistoriqueScreen } from '../src/screens/HistoriqueScreen';
import { ThemeProvider } from '../src/theme';

const RESERVATION = {
  booking_id: 'r1',
  status: 'consumed',
  starts_at: '2026-08-16T14:30:00Z',
  ends_at: '2026-08-16T15:15:00Z',
  valid_until: '2026-08-16T18:00:00Z',
  approval_expires_at: null,
  created_at: '2026-08-14T09:00:00Z',
  business_id: 'b1',
  business_name: 'Vela Nail Studio',
  business_category: 'beauty',
  business_address: '120 NE 41st St',
  business_timezone: 'America/New_York',
  business_cover_photo_key: null,
  item_name: 'Gel manicure',
  item_photo_key: null,
  duration_minutes: 45,
  platform: 'instagram',
  content_format: 'story',
  contrepartie: {
    collaboration_id: 'k1',
    status: 'under_review',
    deadline_at: '2026-08-16T14:30:00Z',
    attempts_count: 1,
    needs_human_review: false,
  },
};

async function monter(extra: Record<string, unknown> = {}) {
  const items = [{ ...RESERVATION, ...extra }];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ items, compteurs: { consumed: 1 } }),
      }) as Response,
  });
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <HistoriqueScreen onOuvrir={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

/**
 * Deux des cinq ont changé d'écran, et ce fichier dit lesquels.
 *
 * L'adresse et l'arbitrage étaient rendus sur la ligne des réservations. La
 * carte y portait huit à dix lignes, dont une seule en corps de texte, et le
 * bouton qui ouvre le code de retrait arrivait après quatre lignes en
 * capitales — au point qu'une campagne de test entière n'a pas trouvé où
 * montrer son QR. Le chemin n'était pas rompu, il était noyé.
 *
 * Les deux champs sont donc partis là où la question se pose :
 *
 * - **`business_address`** sur l'écran du code, éprouvée par
 *   `code-de-retrait` (`ou-aller`, et le cas sans adresse). On ne cherche pas
 *   son chemin en parcourant une liste, on le cherche en partant.
 * - **`needs_human_review`** sur l'écran de la contrepartie, éprouvé par
 *   `la-preuve-v3` (`en-arbitrage`, et son inverse).
 *
 * Le contrat de ce fichier n'a pas changé — un champ servi doit arriver à
 * l'œil quelque part. Ce qui a changé est *où*, et il faut que ce soit écrit
 * ici : la garde ne vaut que si l'on sait où chercher ce qu'elle ne couvre
 * plus. Le test ci-dessous tient l'autre moitié, celle qu'aucun des deux
 * fichiers d'écran ne peut voir depuis chez lui — que la liste s'en est bien
 * délestée.
 */
describe('et la liste s’en est délestée', () => {
  it('ne porte plus ni l’adresse ni l’arbitrage', async () => {
    await monter({
      contrepartie: { ...RESERVATION.contrepartie, needs_human_review: true },
    });
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());

    expect(screen.queryByText(/120 NE 41st St/)).toBeNull();
    expect(screen.queryByTestId('en-arbitrage-r1')).toBeNull();

    // **Et le salon reste**, sinon la ligne ne dirait plus chez qui l'on va.
    // Sans cette assertion, retirer les deux *et* le nom passerait au vert.
    expect(screen.getByText(/Vela Nail Studio/)).toBeTruthy();
  });
});
