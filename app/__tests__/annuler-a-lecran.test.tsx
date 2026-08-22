/**
 * L'annulation à l'écran : deux appuis, et ce qu'elle coûte entre les deux.
 *
 * **Le décor qui compte est celui du premier appui.** L'implémentation qu'on
 * redoute n'est pas « le bouton manque » — elle se verrait tout de suite —,
 * c'est « le bouton annule tout de suite ». Elle rend un écran qui marche, qui
 * passe tous les tests d'apparence, et qui annule un rendez-vous par
 * frôlement dans une liste qu'on parcourt au pouce. Le seul décor où les deux
 * divergent est celui-ci : **appuyer une fois, et vérifier que rien n'est
 * parti**. Il est écrit en premier.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type ReservationDuCreateur } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { HistoriqueScreen } from '../src/screens/HistoriqueScreen';
import { ThemeProvider } from '../src/theme';

const DANS_UNE_HEURE = new Date(Date.now() + 3_600_000).toISOString();
const DANS_TROIS_HEURES = new Date(Date.now() + 3 * 3_600_000).toISOString();

function reservation(extra: Partial<ReservationDuCreateur> = {}): ReservationDuCreateur {
  return {
    booking_id: 'r1',
    status: 'confirmed',
    starts_at: DANS_UNE_HEURE,
    ends_at: DANS_TROIS_HEURES,
    valid_until: DANS_TROIS_HEURES,
    approval_expires_at: null,
    created_at: DANS_UNE_HEURE,
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
    contrepartie: null,
    ...extra,
  } as unknown as ReservationDuCreateur;
}

/** Ce qui est parti sur le réseau, pour pouvoir affirmer que rien n'est parti. */
async function monter(items: ReservationDuCreateur[]) {
  const envois: { url: string; method: string }[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      envois.push({ url: String(url), method });
      return {
        ok: true,
        status: 200,
        json: async () => ({ items, compteurs: { confirmed: items.length } }),
      } as Response;
    }) as typeof fetch,
  });
  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <HistoriqueScreen onOuvrir={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  const annulations = () => envois.filter((e) => e.url.includes('/cancel'));
  return { vue, annulations };
}

describe('annuler une réservation depuis le parcours', () => {
  it('le premier appui n’annule rien : il demande', async () => {
    const { annulations } = await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));

    // La confirmation est là…
    expect(await screen.findByTestId('confirmer-annulation-r1')).toBeTruthy();
    // …et rien n'est parti.
    expect(annulations()).toEqual([]);
  });

  it('le second appui annule, et sur la bonne route', async () => {
    const { annulations } = await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));
    await fireEvent.press(await screen.findByTestId('annuler-oui-r1'));

    await waitFor(() => expect(annulations()).toHaveLength(1));
    expect(annulations()[0].method).toBe('POST');
    expect(annulations()[0].url).toContain('/bookings/r1/cancel');
  });

  it('renoncer referme la demande sans rien envoyer', async () => {
    const { annulations } = await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));
    await fireEvent.press(await screen.findByTestId('annuler-non-r1'));

    await waitFor(() => expect(screen.queryByTestId('confirmer-annulation-r1')).toBeNull());
    expect(annulations()).toEqual([]);
    // Et le premier bouton est revenu : renoncer ne doit pas retirer le geste.
    expect(await screen.findByTestId('annuler-r1')).toBeTruthy();
  });

  it('sur une confirmée avec créneau, la phrase dit ce que ça coûte', async () => {
    await monter([reservation()]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));

    const avertissement = await screen.findByTestId('annuler-avertissement-r1');
    // La conséquence, en toutes lettres — pas « are you sure ».
    expect(avertissement).toHaveTextContent(/reliability score drops/i);
    expect(screen.queryByTestId('annuler-libre-r1')).toBeNull();
  });

  it('sur une place que le salon n’a pas encore acceptée, la phrase ne menace de rien', async () => {
    await monter([reservation({ status: 'awaiting_business', approval_expires_at: DANS_TROIS_HEURES })]);

    await fireEvent.press(await screen.findByTestId('annuler-r1'));

    expect(await screen.findByTestId('annuler-libre-r1')).toBeTruthy();
    expect(screen.queryByTestId('annuler-avertissement-r1')).toBeNull();
  });

  it('les cinq phrases existent dans les deux langues', async () => {
    for (const cle of [
      'annuler',
      'annulerConfirmer',
      'annulerGarder',
      'annulerSansFrais',
      'annulerPeutCouter',
    ] as const) {
      expect(en.parcours[cle]).toBeTruthy();
    }
  });
});
