/**
 * L'abonnement s'atteint depuis les réglages du commerce.
 *
 * **Il existait, il fonctionnait, et personne ne pouvait l'ouvrir.** Sa seule
 * entrée était le mur de l'annuaire — lequel ne s'affiche qu'à un salon **sans**
 * abonnement. Un salon abonné ne pouvait donc ni voir sa formule, ni en
 * changer, ni résilier : la moitié des gestes que l'écran sait faire n'avait
 * aucun chemin.
 *
 * C'est la famille de la carte du fil : construit, branché, et derrière une
 * porte que personne n'ouvre. Rien ne pouvait le dire — l'écran a ses propres
 * tests, et ils passaient tous.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ReglagesScreen } from '../src/screens/ReglagesScreen';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { SessionProvider } from '../src/session';
import { ApiClient, ApiProvider } from '../src/api';

const client = () =>
  new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never,
  });

async function monter(props: Parameters<typeof ReglagesScreen>[0] = {}) {
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={client()}>
          <SessionProvider
            baseUrl="https://api.test"
            coffre={{ lire: async () => null, ecrire: async () => {} }}
            fetchImpl={(async () => ({ ok: true, status: 200, json: async () => ({}) })) as never}
          >
            <ReglagesScreen {...props} />
          </SessionProvider>
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

it('porte une entrée vers l’abonnement, et elle mène quelque part', async () => {
  const ouvrir = jest.fn();
  await monter({ onVoirLAbonnement: ouvrir });

  await waitFor(() => expect(screen.getByTestId('ouvrir-l-abonnement')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('ouvrir-l-abonnement'));
  expect(ouvrir).toHaveBeenCalled();
});

it('et ne la rend pas là où il n’y a rien à ouvrir', async () => {
  // **Le pendant.** Un créateur n'a pas d'abonnement, et un compte dont le
  // commerce n'existe pas encore n'a pas de salon à abonner : rendre la ligne
  // partout donnerait une entrée qui ne mène nulle part, ce qui est pire que
  // l'absence qu'on vient de corriger.
  await monter();

  expect(screen.queryByTestId('ouvrir-l-abonnement')).toBeNull();
  expect(screen.queryByTestId('abonnement-depuis-les-reglages')).toBeNull();
});
