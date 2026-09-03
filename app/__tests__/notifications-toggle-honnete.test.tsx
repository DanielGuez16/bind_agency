/**
 * L'interrupteur des notifications dit l'état réel, jamais le geste.
 *
 * **Deux mensonges, tous deux corrigés ici.**
 *
 * Le premier était le plus discret : l'interrupteur se dessinait sur
 * `!refusees` seul. Sans rien en mémoire — le cas de tout navigateur, où rien
 * n'a jamais pu s'enregistrer — il s'affichait donc « activé » **au premier
 * rendu, avant qu'on y touche**. Il annonçait des notifications qu'aucun jeton
 * ne portait.
 *
 * Le second : `basculer` appelait `enregistrerCeTerminal` et jetait son
 * résultat, puis posait l'interrupteur sur « activé » quoi qu'il arrive. Un
 * refus du système ou une panne réseau laissaient donc un interrupteur allumé
 * sur un enregistrement qui n'avait pas eu lieu.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { NotificationsDeCetAppareil } from '../src/screens/reglages/NotificationsDeCetAppareil';
import { ThemeProvider } from '../src/theme';

const permission = { granted: true, canAskAgain: true };

jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => permission),
  requestPermissionsAsync: jest.fn(async () => permission),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
}));

const coffre = { lire: async () => null, ecrire: async () => {} };
const original = Platform.OS;

async function monter(reponseDuServeur: () => Response) {
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider
          client={
            new ApiClient({
              baseUrl: 'https://api.test',
              coffre,
              fetchImpl: async () => reponseDuServeur(),
            })
          }
        >
          <NotificationsDeCetAppareil />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

const ok = () => ({ ok: true, status: 200, json: async () => ({ id: 'd1' }) }) as Response;

beforeEach(async () => {
  await AsyncStorage.clear();
  permission.granted = true;
  permission.canAskAgain = true;
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
});

describe('sur un navigateur sans clé VAPID', () => {
  it('l’interrupteur part éteint et inerte, et dit pourquoi', async () => {
    // **Le mensonge d'avant l'interaction.** Rien en mémoire, donc
    // `refusees === false`, donc l'ancien `value={!refusees}` allumait
    // l'interrupteur — sur une plateforme où aucun jeton n'est obtenable.
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });

    await monter(ok);

    const bouton = await screen.findByTestId('notifications-actives');
    expect(bouton.props.accessibilityState.checked).toBe(false);
    expect(bouton.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('notifications-indisponibles')).toBeTruthy();
  });
});

describe('sur un appareil où l’enregistrement peut aboutir', () => {
  it('l’interrupteur s’allume quand le jeton est bien parti', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    await AsyncStorage.setItem('bind.notifications.refusees', 'oui');

    await monter(ok);

    const bouton = await screen.findByTestId('notifications-actives');
    await waitFor(() => expect(bouton.props.accessibilityState.checked).toBe(false));

    fireEvent.press(bouton);

    await waitFor(() =>
      expect(
        screen.getByTestId('notifications-actives').props.accessibilityState.checked,
      ).toBe(true),
    );
    expect(screen.queryByTestId('echec-notifications')).toBeNull();
  });

  it('et il retombe, en disant quoi, quand le système refuse', async () => {
    // **Le cas qui allumait un interrupteur sur rien.** `enregistrerCeTerminal`
    // rend `refusee`, et l'ancien code posait quand même « activé ».
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    await AsyncStorage.setItem('bind.notifications.refusees', 'oui');
    permission.granted = false;
    permission.canAskAgain = false;

    await monter(ok);

    const bouton = await screen.findByTestId('notifications-actives');
    fireEvent.press(bouton);

    await waitFor(() => expect(screen.getByTestId('echec-notifications')).toBeTruthy());
    expect(
      screen.getByTestId('notifications-actives').props.accessibilityState.checked,
    ).toBe(false);
    expect(screen.getByText(en.reglages.notificationsEchecRefusee)).toBeTruthy();
  });
});
