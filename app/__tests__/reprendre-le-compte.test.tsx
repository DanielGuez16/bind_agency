/**
 * Reprendre un compte : les trois freins, et aucun n'est un contrôle d'accès.
 *
 * **Le décor divergent est ce qui part sur le réseau.** Un écran qui affiche
 * des cases de portée sans les envoyer rend exactement la même image : les
 * chips se cochent, le bouton s'active, la reprise s'ouvre. C'est le pire des
 * défauts possibles ici — le gérant lirait une borne qui n'en est pas une, et
 * la liste qu'il consulte mentirait. Le corps est donc lu, pas seulement
 * l'écran.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { ReprendreLeCompte, toutEstDemande, PORTEES } from '../src/screens/reprise/ReprendreLeCompte';
import { ThemeProvider } from '../src/theme';

const OUVERTE = {
  id: 'r1',
  business_id: 'b1',
  admin_name: 'Amélie R.',
  reason: 'Fixing the weekly hours.',
  scope: ['agenda'],
  spontaneous: true,
  started_at: '2026-08-22T15:00:00Z',
  expires_at: '2026-08-22T15:30:00Z',
  ended_at: null,
  reprises_recentes_de_l_appelant: 4,
  fenetre_en_jours: 7,
};

async function monter() {
  const envois: { url: string; corps: Record<string, unknown> }[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        envois.push({ url: String(url), corps: JSON.parse(String(init?.body ?? '{}')) });
        return { ok: true, status: 201, json: async () => OUVERTE } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    }) as unknown as typeof fetch,
  });
  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="admin">
        <ApiProvider client={api}>
          <ReprendreLeCompte businessId="b1" nomDuSalon="Vela Nail Studio" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { envois };
}

describe('le motif part au salon mot pour mot', () => {
  it('l’écran le dit au-dessus du champ, pas en note de bas de page', async () => {
    await monter();

    const avertissement = await screen.findByTestId('reprise-avertissement');
    expect(avertissement).toHaveTextContent(/Vela Nail Studio reads exactly what you write/i);
    expect(avertissement).toHaveTextContent(/word for word/i);
  });

  it('et il part intact, sans être retouché', async () => {
    const MOTIF = 'You wrote in on Aug 21: Thursday shows as closed although you now open.';
    const { envois } = await monter();

    await fireEvent.changeText(await screen.findByTestId('champ-motif'), MOTIF);
    await fireEvent.press(await screen.findByTestId('portee-agenda'));
    await fireEvent.press(await screen.findByTestId('ouvrir-la-reprise'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].corps.reason).toBe(MOTIF);
  });
});

describe('la portée borne, elle ne décore pas', () => {
  it('rien ne s’ouvre sans motif ni sans portée', async () => {
    await monter();

    const bouton = await screen.findByTestId('ouvrir-la-reprise');
    expect(bouton.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(await screen.findByTestId('champ-motif'), 'x');
    // Un motif seul ne suffit pas : une portée vide ouvrirait tout ou rien.
    expect((await screen.findByTestId('ouvrir-la-reprise')).props.accessibilityState?.disabled).toBe(
      true,
    );
  });

  it('ce qui est coché part sur le réseau, et rien d’autre', async () => {
    const { envois } = await monter();

    await fireEvent.changeText(await screen.findByTestId('champ-motif'), 'x');
    await fireEvent.press(await screen.findByTestId('portee-agenda'));
    await fireEvent.press(await screen.findByTestId('portee-catalogue'));
    await fireEvent.press(await screen.findByTestId('ouvrir-la-reprise'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].corps.scope).toEqual(['agenda', 'catalogue']);
  });

  it('« tout » n’est pas interdit, il est écrit', async () => {
    await monter();

    await fireEvent.changeText(await screen.findByTestId('champ-motif'), 'x');
    for (const ecran of PORTEES) {
      await fireEvent.press(await screen.findByTestId(`portee-${ecran}`));
    }

    const dit = await screen.findByTestId('reprise-tout');
    expect(dit).toHaveTextContent(/asking for everything/i);
    expect(dit).toHaveTextContent(/stays in their list/i);
    // Et le bouton reste pressable : ce n'est pas une interdiction.
    expect(
      (await screen.findByTestId('ouvrir-la-reprise')).props.accessibilityState?.disabled,
    ).toBeFalsy();
  });

  it('« tout » se lit sur les sept, jamais sur une valeur à part', () => {
    expect(toutEstDemande(PORTEES)).toBe(true);
    expect(toutEstDemande(PORTEES.slice(0, 6))).toBe(false);
    expect(toutEstDemande([])).toBe(false);
  });
});

describe('spontanée est le défaut, et se déclare', () => {
  it('sans rien toucher, la reprise part comme spontanée', async () => {
    const { envois } = await monter();

    await fireEvent.changeText(await screen.findByTestId('champ-motif'), 'x');
    await fireEvent.press(await screen.findByTestId('portee-agenda'));
    await fireEvent.press(await screen.findByTestId('ouvrir-la-reprise'));

    await waitFor(() => expect(envois).toHaveLength(1));
    // **Le défaut compte.** Sans lui, toute reprise se présenterait comme
    // sollicitée sans que personne ne l'ait sollicitée.
    expect(envois[0].corps.spontaneous).toBe(true);
    expect(await screen.findByTestId('reprise-ouverte')).toBeTruthy();
  });

  it('déclarer que le salon a demandé change ce qui part', async () => {
    const { envois } = await monter();

    await fireEvent.changeText(await screen.findByTestId('champ-motif'), 'x');
    await fireEvent.press(await screen.findByTestId('portee-agenda'));
    await fireEvent.press(await screen.findByTestId('origine-demandee'));
    await fireEvent.press(await screen.findByTestId('ouvrir-la-reprise'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].corps.spontaneous).toBe(false);
  });

  it('et le mot « unprompted » est annoncé avant l’appui, pas découvert après', async () => {
    await monter();

    expect(await screen.findByTestId('reprise-spontanee-note')).toHaveTextContent(
      /unprompted in their list, permanently/i,
    );
  });
});

describe('le compte des reprises de l’appelant', () => {
  it('se lit avec sa fenêtre : un nombre sans période ne veut rien dire', async () => {
    await monter();

    await fireEvent.changeText(await screen.findByTestId('champ-motif'), 'x');
    await fireEvent.press(await screen.findByTestId('portee-agenda'));
    await fireEvent.press(await screen.findByTestId('ouvrir-la-reprise'));

    const compte = await screen.findByTestId('reprise-compte');
    expect(compte).toHaveTextContent(/4 takeovers/i);
    expect(compte).toHaveTextContent(/7 days/i);
    // Tous salons confondus : se comparer à soi-même, pas au salon.
    expect(compte).toHaveTextContent(/across all salons/i);
  });
});
