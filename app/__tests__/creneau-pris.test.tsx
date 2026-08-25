/**
 * Le créneau pris pendant qu'on choisissait.
 *
 * **Le cas le plus coûteux du parcours, et il rendait un message.** La
 * créatrice venait de choisir ; on lui répondait « ce créneau vient d'être
 * pris » et on la renvoyait relire toute la liste — c'est-à-dire refaire
 * depuis le début le choix qu'elle venait de faire.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type FichePublique, type OffreDeLaFiche } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { CreneauxScreen } from '../src/screens/CreneauxScreen';
import { ThemeProvider } from '../src/theme';

const AUJOURDHUI = new Date();
const JOUR = AUJOURDHUI.toISOString().slice(0, 10);
const A = (h: number) => {
  const d = new Date(AUJOURDHUI);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString();
};

const OFFRE = {
  tier_offer_id: 'o1',
  catalog_item_id: 'i1',
  tier_id: 't1',
  name: 'Gel manicure',
  duration_minutes: 45,
  requires_booking: true,
  accessible: true,
  social_account_id: 's1',
  content_format: 'story',
  platform: 'instagram',
  obstacles: [],
  est_favori: false,
  prochains_creneaux: [],
} as unknown as OffreDeLaFiche;

const FICHE = {
  business_id: 'b1',
  name: 'Vela Nail Studio',
  timezone: 'UTC',
} as unknown as FichePublique;

async function monter(surReservation: () => Response) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const chemin = String(url);
      if (init?.method === 'POST' && chemin.includes('/bookings')) return surReservation();
      // **Le résumé avant les créneaux** : « /availability » contient lui-même
      // « /availability/summary », et l'ordre décide lequel répond.
      if (chemin.includes('/availability/summary')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { jour: JOUR, ouvert: true, revolu: false, creneaux_libres: 3 },
          ],
        } as Response;
      }
      if (chemin.includes('/availability')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { starts_at: A(14), ends_at: A(15), places_restantes: 1 },
            { starts_at: A(16), ends_at: A(17), places_restantes: 2 },
            { starts_at: A(17), ends_at: A(18), places_restantes: 2 },
          ],
        } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    }) as unknown as typeof fetch,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <CreneauxScreen fiche={FICHE} offre={OFFRE} onReserve={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

const PRIS = () =>
  ({
    ok: false,
    status: 409,
    json: async () => ({ detail: 'booking_slot_unavailable' }),
  }) as Response;

it('propose les heures encore libres du même jour, sans faire relire la liste', async () => {
  await monter(PRIS);
  // Les créneaux se désignent par leur heure : c'est le nom que le lecteur
  // d'écran annonce, et le seul que la pastille porte.
  await waitFor(() => expect(screen.getByLabelText('14:00')).toBeTruthy());

  await act(async () => {
    await fireEvent.press(screen.getByLabelText('14:00'));
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('confirmer'));
  });

  await waitFor(() => expect(screen.getByTestId('creneau-pris')).toBeTruthy());
  // Les deux autres heures du jour sont proposées directement : le choix se
  // refait au plus près de celui qui vient de tomber.
  expect(screen.getByTestId(`reprendre-${A(16)}`)).toBeTruthy();
  expect(screen.getByTestId(`reprendre-${A(17)}`)).toBeTruthy();
  // Et ce n'est pas un échec cramoisi : personne n'a mal fait quoi que ce soit.
  expect(screen.queryByTestId('echec-reservation')).toBeNull();
});
