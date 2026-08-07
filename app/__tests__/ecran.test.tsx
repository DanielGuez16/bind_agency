/**
 * Basculer la locale doit changer l'intégralité des libellés de l'écran,
 * pas seulement ceux qu'on a pensé à traduire.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// `render` est **asynchrone** depuis @testing-library/react-native 14 : elle
// rend une promesse, et `screen` n'est peuplé qu'une fois celle-ci résolue.
// L'oublier ne fait pas échouer le test tout de suite — `waitFor` réessaie —
// mais la résolution dépend alors d'un ordonnancement qu'on ne contrôle pas.
// C'est exactement ce qui a rendu la CI rouge en permanence tout en passant en
// local.

import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
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

describe('écran d’amorçage', () => {
  beforeEach(() => repondSante());

  it('s’affiche en anglais', async () => {
    await render(
      <I18nProvider initialLocale="en">
        <HealthScreen apiUrl="http://test/api/v1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText(en.health.reachable)).toBeTruthy());
    expect(screen.getByText(en.common.retry)).toBeTruthy();
    expect(screen.getByText(en.health.title)).toBeTruthy();
  });

  it('bascule tous les libellés en espagnol', async () => {
    await render(
      <I18nProvider initialLocale="en">
        <HealthScreen apiUrl="http://test/api/v1" />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText(en.health.reachable)).toBeTruthy());

    await fireEvent.press(screen.getByText('ES'));

    await waitFor(() => expect(screen.getByText(es.health.reachable)).toBeTruthy());
    expect(screen.getByText(es.common.retry)).toBeTruthy();
    expect(screen.getByText(es.health.title)).toBeTruthy();
    expect(screen.queryByText(en.common.retry)).toBeNull();
    expect(screen.queryByText(en.health.title)).toBeNull();
  });

  it('affiche un message traduit quand l’API ne répond pas', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await render(
      <I18nProvider initialLocale="es">
        <HealthScreen apiUrl="http://test/api/v1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText(es.health.unreachable)).toBeTruthy());
    expect(screen.getByText(es.errors.generic)).toBeTruthy();
  });

  it('signale une URL d’API absente sans planter', async () => {
    await render(
      <I18nProvider initialLocale="en">
        <HealthScreen apiUrl={undefined} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText(en.health.missingApiUrl)).toBeTruthy());
  });

  it('ne laisse aucun code d’erreur brut à l’écran', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 503,
      json: async () => ({ detail: 'code_que_l_app_ne_connait_pas' }),
    }) as unknown as typeof fetch;

    await render(
      <I18nProvider initialLocale="en">
        <HealthScreen apiUrl="http://test/api/v1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText(en.errors.generic)).toBeTruthy());
    expect(screen.queryByText('code_que_l_app_ne_connait_pas')).toBeNull();
  });
});
