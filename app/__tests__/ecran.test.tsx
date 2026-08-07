/**
 * Le diagnostic de connexion.
 *
 * C'était l'écran d'amorçage : il portait le nom de l'application, le sélecteur
 * de langue et ses propres couleurs. Ces trois-là ont trouvé leur place —
 * réglages, réglages, système de design — et il ne reste que ce qu'il fait :
 * dire si cet appareil joint BIND, et à quelle adresse.
 *
 * **Il ne lit pas la configuration, il lit ce que l'application utilise.** Un
 * diagnostic branché ailleurs que le produit répond juste à côté de la
 * question, ce qui est pire que de ne pas répondre.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// `render` est **asynchrone** depuis @testing-library/react-native 14 : elle
// rend une promesse, et `screen` n'est peuplé qu'une fois celle-ci résolue.
// L'oublier ne fait pas échouer le test tout de suite — `waitFor` réessaie —
// mais la résolution dépend alors d'un ordonnancement qu'on ne contrôle pas.
// C'est exactement ce qui a rendu la CI rouge en permanence tout en passant en
// local.

import { I18nProvider, type SupportedLocale } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { ThemeProvider } from '../src/theme';
import { HealthScreen } from '../src/screens/HealthScreen';

function repondSante(status: 'ok' | 'unavailable' = 'ok') {
  global.fetch = jest.fn().mockResolvedValue({
    status: status === 'ok' ? 200 : 503,
    json: async () => ({
      status,
      dependencies: { database: status === 'ok' ? 'ok' : 'unavailable' },
      failed: status === 'ok' ? [] : ['database'],
    }),
  }) as unknown as typeof fetch;
}

/** `null` veut dire « aucune adresse » ; l'omettre veut dire « déduis-la ». */
function monter(adresse: string | null, locale: SupportedLocale = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <ThemeProvider role="creator">
        <HealthScreen apiUrl={adresse} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('diagnostic de connexion', () => {
  beforeEach(() => repondSante());

  it('annonce que l’API répond, et sur quelle adresse', async () => {
    await monter('http://test/api/v1');

    await waitFor(() => expect(screen.getByText(en.health.reachable)).toBeTruthy());
    // L'adresse interrogée est à l'écran : « API reachable » tout seul ne dit
    // pas *laquelle* a répondu, et c'est justement la question quand une page
    // reste vide.
    expect(screen.getByText('http://test/api/v1')).toBeTruthy();
    expect(screen.getByText(en.health.dependencyOk)).toBeTruthy();
  });

  it('bascule tous ses libellés en espagnol', async () => {
    await monter('http://test/api/v1', 'es');

    await waitFor(() => expect(screen.getByText(es.health.reachable)).toBeTruthy());
    expect(screen.getByText(es.common.retry)).toBeTruthy();
    expect(screen.queryByText(en.health.reachable)).toBeNull();
    expect(screen.queryByText(en.common.retry)).toBeNull();
  });

  it('affiche un message traduit quand l’API ne répond pas', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await monter('http://test/api/v1', 'es');

    await waitFor(() => expect(screen.getByText(es.health.unreachable)).toBeTruthy());
    expect(screen.getByText(es.errors.generic)).toBeTruthy();
  });

  it('nomme la variable quand aucune adresse n’est trouvée', async () => {
    await monter(null);

    await waitFor(() => expect(screen.getByText(en.health.missingApiUrl)).toBeTruthy());
    // Le cas ne survient que dans une application compilée. Y afficher
    // « API unreachable » enverrait chercher un problème de réseau qui n'existe
    // pas ; le texte nomme le fichier et la variable.
    expect(screen.getByText(en.health.missingApiUrlHelp)).toBeTruthy();
  });

  it('la relance se voit travailler et redemande', async () => {
    await monter('http://test/api/v1');
    await waitFor(() => expect(screen.getByText(en.health.reachable)).toBeTruthy());

    const appelsAvant = (global.fetch as jest.Mock).mock.calls.length;
    await fireEvent.press(screen.getByTestId('diagnostic-refaire'));

    // Le bouton ne faisait rien de visible : sans adresse, la sonde repassait
    // en échec dans la même frappe, et rien à l'écran ne changeait.
    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(appelsAvant),
    );
    expect(screen.getByTestId('diagnostic-refaire')).toBeTruthy();
  });

  it('ne laisse aucun code d’erreur brut à l’écran', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 503,
      json: async () => ({ detail: 'code_que_l_app_ne_connait_pas' }),
    }) as unknown as typeof fetch;

    await monter('http://test/api/v1');

    await waitFor(() => expect(screen.getByText(en.errors.generic)).toBeTruthy());
    expect(screen.queryByText('code_que_l_app_ne_connait_pas')).toBeNull();
  });
});
