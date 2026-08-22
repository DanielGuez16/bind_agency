/**
 * Ce que le salon voit d'une reprise, sur sa journée et dans ses réglages.
 *
 * **Le décor divergent est un motif que personne ne voudrait résumer.** Une
 * implémentation qui tronque à quarante caractères, qui met une majuscule, ou
 * qui range la phrase sous une catégorie rend un écran qui a l'air juste — et
 * elle détruit le mécanisme, qui est que l'administrateur sait que sa phrase
 * exacte sera lue. Le motif du décor est donc long, ponctué, et vérifié **mot
 * pour mot**.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type RepriseDuCompte } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { JourneeScreen } from '../src/screens/JourneeScreen';
import { ThemeProvider } from '../src/theme';

const MOTIF =
  'You wrote in on Aug 21 saying Thursday shows as closed although you now open. I am fixing the weekly hours.';

const IL_Y_A_UNE_HEURE = new Date(Date.now() - 3_600_000).toISOString();
const DANS_UNE_HEURE = new Date(Date.now() + 3_600_000).toISOString();

function reprise(extra: Partial<RepriseDuCompte> = {}): RepriseDuCompte {
  return {
    id: 'r1',
    business_id: 'b1',
    admin_user_id: 'a1',
    reason: MOTIF,
    started_at: IL_Y_A_UNE_HEURE,
    expires_at: DANS_UNE_HEURE,
    ended_at: null,
    ...extra,
  } as unknown as RepriseDuCompte;
}

const JOURNEE = {
  jour: '2026-08-22',
  timezone: 'America/New_York',
  debut: '2026-08-22T13:00:00Z',
  fin: '2026-08-22T23:00:00Z',
  items: [],
  a_trancher: [],
};

async function monter(reprises: RepriseDuCompte[]) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL) => {
      if (String(url).includes('/support-access')) {
        return { ok: true, status: 200, json: async () => reprises } as Response;
      }
      return { ok: true, status: 200, json: async () => JOURNEE } as Response;
    }) as unknown as typeof fetch,
  });
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api}>
          <JourneeScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('le bandeau de reprise, sur la journée du salon', () => {
  it('cite le motif mot pour mot, sans le résumer', async () => {
    await monter([reprise()]);

    const motif = await screen.findByTestId('reprise-motif');
    // Mot pour mot : la phrase entière est présente, ponctuation comprise.
    expect(motif).toHaveTextContent(MOTIF, { exact: false });
  });

  it('ne se rend pas quand la reprise a été refermée', async () => {
    await monter([reprise({ ended_at: IL_Y_A_UNE_HEURE })]);

    // La journée s'affiche, le bandeau non.
    await waitFor(() => expect(screen.queryByTestId('journee-vide')).toBeTruthy());
    expect(screen.queryByTestId('bandeau-reprise')).toBeNull();
  });

  it('ne se rend pas quand la reprise a expiré, bien qu’elle ne soit pas close', async () => {
    // **Le cas qui compte.** `ended_at` est nul — personne n'a refermé — et une
    // implémentation qui ne regarde que ce champ laisserait le bandeau allumé
    // pour toujours, en citant un motif vieux de trois semaines.
    await monter([reprise({ expires_at: IL_Y_A_UNE_HEURE, ended_at: null })]);

    await waitFor(() => expect(screen.queryByTestId('journee-vide')).toBeTruthy());
    expect(screen.queryByTestId('bandeau-reprise')).toBeNull();
  });

  it('ne se rend pas quand il n’y a jamais eu de reprise', async () => {
    await monter([]);

    await waitFor(() => expect(screen.queryByTestId('journee-vide')).toBeTruthy());
    expect(screen.queryByTestId('bandeau-reprise')).toBeNull();
  });
});
