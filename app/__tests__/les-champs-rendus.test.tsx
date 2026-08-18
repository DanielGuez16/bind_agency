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

describe('une réservation dit où aller', () => {
  it('l’adresse est sur la ligne, à côté du salon', async () => {
    // Le cadre 08a l'affiche — « 120 NE 41st St · 320 m » — et l'écran la
    // taisait. Une réservation dont on ne sait pas où aller ne se tient pas.
    await monter();
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());

    expect(screen.getByText(/120 NE 41st St/)).toBeTruthy();
  });
});

describe('l’attente qui change de nature', () => {
  it('un dossier passé en arbitrage le dit', async () => {
    // **Le plus important des cinq.** Passé en revue humaine, le dossier
    // n'attend plus le salon mais un arbitre : le délai n'a plus le même sens,
    // et relancer le salon ne sert à rien. Le champ était rendu depuis
    // toujours et affiché nulle part.
    await monter({
      contrepartie: { ...RESERVATION.contrepartie, needs_human_review: true },
    });
    await waitFor(() => expect(screen.getByTestId('en-arbitrage-r1')).toBeTruthy());

    expect(screen.getByTestId('en-arbitrage-r1')).toHaveTextContent(
      en.parcours.contrepartieEnArbitrage,
    );
  });

  it('et une contrepartie ordinaire ne le dit pas', async () => {
    // Le sens inverse : une mention permanente ne distinguerait plus rien, et
    // c'est justement la distinction qui est l'information.
    await monter();
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());

    expect(screen.queryByTestId('en-arbitrage-r1')).toBeNull();
  });
});
