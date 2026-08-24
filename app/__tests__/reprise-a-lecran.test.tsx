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
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type RepriseDuCompte } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { JourneeScreen } from '../src/screens/JourneeScreen';
import { RepriseDuCompte as SectionDesReprises } from '../src/screens/reglages/RepriseDuCompte';
import { CommerceProvider } from '../src/shell/useMonCommerce';
import { ThemeProvider } from '../src/theme';

const MOTIF =
  'You wrote in on Aug 21 saying Thursday shows as closed although you now open. I am fixing the weekly hours.';

const IL_Y_A_UNE_HEURE = new Date(Date.now() - 3_600_000).toISOString();
const DANS_UNE_HEURE = new Date(Date.now() + 3_600_000).toISOString();

function reprise(extra: Partial<RepriseDuCompte> = {}): RepriseDuCompte {
  return {
    id: 'r1',
    business_id: 'b1',
    admin_name: 'Amélie R.',
    reason: MOTIF,
    // **Une seule portée dans le décor par défaut.** Toutes les sept feraient
    // passer un écran qui affiche la liste entière quoi qu'il arrive aussi bien
    // qu'un écran qui lit celle de la reprise.
    scope: ['fiche'],
    spontaneous: true,
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
  const envois: { url: string; method: string }[] = [];
  // La liste est relue après la fermeture : un 204 ne rend rien, et c'est la
  // relecture qui éteint le bandeau. Un double qui rendrait toujours la même
  // liste ferait passer une implémentation qui ne recharge pas.
  let restantes = reprises;
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const methode = (init?.method ?? 'GET').toUpperCase();
      envois.push({ url: String(url), method: methode });
      if (String(url).includes('/support-access')) {
        if (methode === 'DELETE') {
          restantes = [];
          return { ok: true, status: 204, json: async () => null } as Response;
        }
        return { ok: true, status: 200, json: async () => restantes } as Response;
      }
      return { ok: true, status: 200, json: async () => JOURNEE } as Response;
    }) as unknown as typeof fetch,
  });
  Object.assign(globalThis, { __envoisDeLaJournee: envois });
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


// --------------------------------------------------------------------------
// la section des réglages : qui est entré, ce qu'il ouvrait, et la sortie
// --------------------------------------------------------------------------

const MES_COMMERCES = [{ id: 'b1', name: 'Salon Ocean', timezone: 'America/New_York' }];

/** Monte la section, sous le fournisseur qui porte le salon regardé. */
async function monterLesReglages(
  reprises: RepriseDuCompte[],
  envois: { chemin: string; methode: string }[] = [],
) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const chemin = String(url);
      const methode = init?.method ?? 'GET';
      envois.push({ chemin, methode });
      if (chemin.includes('/me/businesses')) {
        return { ok: true, status: 200, json: async () => MES_COMMERCES } as Response;
      }
      if (methode === 'DELETE') {
        return { ok: true, status: 204, json: async () => null } as Response;
      }
      return { ok: true, status: 200, json: async () => reprises } as Response;
    }) as unknown as typeof fetch,
  });
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api}>
          <CommerceProvider>
            <SectionDesReprises />
          </CommerceProvider>
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('ce que le salon lit de chaque reprise', () => {
  it('nomme celui qui est entré, et dit qu’il est venu tout seul', async () => {
    await monterLesReglages([reprise()]);

    const qui = await screen.findByTestId('reprise-qui-r1');
    expect(qui).toHaveTextContent('Amélie R.', { exact: false });
    expect(qui).toHaveTextContent('own initiative', { exact: false });
  });

  it('et dit l’inverse quand le salon avait demandé', async () => {
    // **Le décor divergent.** Sans ce second cas, un écran qui écrirait « de sa
    // propre initiative » sur toutes les reprises passerait le premier test —
    // et c'est précisément la phrase qu'il ne faut pas poser au hasard, puisque
    // celle-là accuse.
    await monterLesReglages([reprise({ spontaneous: false })]);

    const qui = await screen.findByTestId('reprise-qui-r1');
    expect(qui).toHaveTextContent('after you asked', { exact: false });
    expect(qui).not.toHaveTextContent('own initiative', { exact: false });
  });

  it('nomme les écrans que la reprise ouvrait, et pas les autres', async () => {
    await monterLesReglages([reprise({ scope: ['catalogue', 'chiffres'] })]);

    const portee = await screen.findByTestId('reprise-portee-r1');
    expect(portee).toHaveTextContent('your services', { exact: false });
    expect(portee).toHaveTextContent('your numbers', { exact: false });
    // Ce qu'elle n'ouvrait pas ne doit pas y figurer : une liste qui montre
    // tout ne borne rien, et se lirait comme un accès complet.
    expect(portee).not.toHaveTextContent('your page', { exact: false });
  });
});

describe('le salon referme la porte lui-même', () => {
  it('propose de refermer quand quelqu’un est dedans, et appelle la route', async () => {
    const envois: { chemin: string; methode: string }[] = [];
    await monterLesReglages([reprise()], envois);

    const bouton = await screen.findByTestId('reprise-refermer');
    await fireEvent.press(bouton);

    await waitFor(() =>
      expect(
        envois.some(
          (envoi) =>
            envoi.methode === 'DELETE' &&
            envoi.chemin.includes('/business/b1/support-access') &&
            !envoi.chemin.includes('/admin/'),
        ),
      ).toBe(true),
    );
  });

  it('ne le propose pas quand la porte est déjà close', async () => {
    // **Le sens qui manquait.** Un bouton qui paraît toujours ferait douter le
    // gérant que la porte soit close, ce qui est exactement ce qu'il vient
    // vérifier. Le décor garde une reprise — sans elle, la section entière ne
    // se rend pas et le test passerait pour la mauvaise raison.
    await monterLesReglages([reprise({ ended_at: IL_Y_A_UNE_HEURE })]);

    await screen.findByTestId('reprise-r1');
    expect(screen.queryByTestId('reprise-refermer')).toBeNull();
  });

  it('et pas davantage quand la dernière a expiré toute seule', async () => {
    await monterLesReglages([reprise({ expires_at: IL_Y_A_UNE_HEURE, ended_at: null })]);

    await screen.findByTestId('reprise-r1');
    expect(screen.queryByTestId('reprise-refermer')).toBeNull();
  });
});


/**
 * Refermer depuis la journée, là où le salon regarde chaque matin.
 *
 * **Le décor divergent est l'absence de question.** Une implémentation qui
 * ouvre une confirmation rend un écran qui a l'air prudent et met une
 * négociation entre le gérant et sa porte : le test presse **une fois** et
 * exige que la fermeture soit partie. Le second décor est la relecture — un
 * double qui rendrait toujours la même liste laisserait passer un bandeau qui
 * ne s'éteint jamais.
 */
describe('refermer depuis la journée', () => {
  const envois = () =>
    (globalThis as unknown as { __envoisDeLaJournee: { url: string; method: string }[] })
      .__envoisDeLaJournee;

  it('un seul appui referme, et sur la route du salon', async () => {
    await monter([reprise()]);

    await fireEvent.press(await screen.findByTestId('reprise-refermer-journee'));

    await waitFor(() =>
      expect(envois().some((e) => e.method === 'DELETE')).toBe(true),
    );
    // Chez lui, jamais par la porte d'administration : le gérant ferme sa
    // propre porte, il ne pilote pas l'administration.
    const fermeture = envois().find((e) => e.method === 'DELETE');
    expect(fermeture?.url).toContain('/business/');
    expect(fermeture?.url).not.toContain('/admin/');
  });

  it('le bandeau s’éteint une fois la porte close', async () => {
    await monter([reprise()]);

    await fireEvent.press(await screen.findByTestId('reprise-refermer-journee'));

    await waitFor(() => expect(screen.queryByTestId('bandeau-reprise')).toBeNull());
  });

  it('la portée est écrite sur le bandeau, dans les mots de la liste', async () => {
    await monter([reprise({ scope: ['agenda', 'catalogue'] as never })]);

    const portee = await screen.findByTestId('reprise-portee-journee');
    // Les mots de la liste, par le même aiguillage — mais le verbe au présent :
    // la porte est ouverte pendant qu'on lit.
    expect(portee).toHaveTextContent(/open now/i);
    expect(portee).toHaveTextContent(/the day's bookings/i);
    expect(portee).toHaveTextContent(/your services/i);
  });

  it('et le bandeau ne crie pas', async () => {
    // **L'assertion au-dessus est insensible à la casse**, donc elle passait
    // aussi bien sur « OPEN NOW: THE DAY'S BOOKINGS, YOUR SERVICES » — ce que
    // le bandeau affichait vraiment. Décor et défaut rendaient le même verdict.
    //
    // Les capitales détruisent la silhouette des mots, donc ce qui permet de
    // lire sans épeler, et un bandeau de reprise est justement ce qu'on lit
    // vite. Le mono capitales du système désigne une étiquette — un format, un
    // réseau, un mois — pas une phrase, et pas deux dates.
    await monter([reprise({ scope: ['agenda', 'catalogue'] as never })]);

    const portee = await screen.findByTestId('reprise-portee-journee');
    expect(portee).toHaveTextContent(/Open now/);
    expect(portee).not.toHaveTextContent(/OPEN NOW/);

    const quand = screen.getByTestId('reprise-quand');
    expect(quand).not.toHaveTextContent(/STARTED/);
  });
});
