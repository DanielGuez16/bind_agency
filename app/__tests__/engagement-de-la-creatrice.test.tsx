/**
 * Ce que la créatrice accepte en confirmant une réservation.
 *
 * **Le geste manquait, et le bouton s'appelait déjà « Confirm booking ».**
 * L'écran affichait « à quoi tu t'engages » — contrepartie, mention, échéance,
 * règle d'annulation — puis laissait confirmer d'un appui, sans que rien
 * n'atteste que ce bloc ait été vu. Le produit avait pourtant déjà le motif :
 * la prise en main d'une fiche fait accepter une version des conditions, la
 * refuse si elle a changé, et l'écrit au journal d'audit. Il n'existait que du
 * côté commerce.
 *
 * **Une bascule et non une case pré-cochée**, comme sur la prise en main : ce
 * qui est accepté part au journal avec sa version et son instant, et une
 * acceptation posée d'avance n'aurait aucune valeur le jour où on la produit.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type FichePublique, type OffreDeLaFiche } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { CreneauxScreen } from '../src/screens/CreneauxScreen';
import { ThemeProvider } from '../src/theme';

const VERSION = '2026-01';

type Envoi = { chemin: string; corps: unknown };

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
  terms_version: VERSION,
  business_id: 'b1',
  name: 'Vela Nail Studio',
  timezone: 'UTC',
} as unknown as FichePublique;

async function monter() {
  const envois: Envoi[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const chemin = String(url);
      if (init?.method === 'POST' && chemin.includes('/bookings')) {
        envois.push({ chemin, corps: init.body ? JSON.parse(String(init.body)) : null });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'r1', status: 'held' }),
        } as Response;
      }
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

  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <CreneauxScreen fiche={FICHE} offre={OFFRE} onReserve={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { vue, envois };
}


/** Choisir une heure : c'est ce qui fait paraître le bloc d'engagement. */
async function choisirUneHeure() {
  await waitFor(() => expect(screen.getByLabelText('14:00')).toBeTruthy());
  await act(async () => {
    await fireEvent.press(screen.getByLabelText('14:00'));
  });
}

describe('la réservation demande un engagement, elle ne le suppose pas', () => {
  it('le bouton reste verrouillé tant que rien n’est accepté', async () => {
    // **Le cas divergent.** Une bascule décorative — affichée mais non lue par
    // le verrou — passerait tous les autres tests de ce fichier : le bouton
    // marcherait, l'envoi partirait, la version serait jointe. Seul celui-ci
    // distingue « on demande » de « on affiche ».
    const { vue } = await monter();
    await choisirUneHeure();

    expect(screen.getByTestId('bascule-engagement')).toBeTruthy();
    expect(screen.getByTestId('confirmer').props.accessibilityState?.disabled).toBe(true);
    await vue.unmount();
  });

  it('accepter déverrouille, et la version part avec la confirmation', async () => {
    const { vue, envois } = await monter();
    await choisirUneHeure();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('bascule-engagement'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('confirmer'));
    });

    await waitFor(() => expect(envois.some((e) => e.chemin.includes('/confirm'))).toBe(true));
    const confirmation = envois.find((e) => e.chemin.includes('/confirm'));
    expect(confirmation?.corps).toEqual({ terms_version: VERSION });
    await vue.unmount();
  });

  it('la version envoyée est celle que l’écran a montrée', async () => {
    // **Servie, jamais écrite en dur.** Une constante côté client annoncerait
    // encore l'ancienne version le jour où le texte change, et le serveur
    // refuserait l'écart — ce refus n'a de sens que si la version vient de lui.
    const { vue } = await monter();
    await choisirUneHeure();

    expect(screen.getByText(`I accept the BIND terms (version ${VERSION}) and commit to publishing`))
      .toBeTruthy();
    await vue.unmount();
  });
});
