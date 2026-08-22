/**
 * Couper les notifications de cet appareil, et que ça tienne.
 *
 * **Une capacité de sécurité qui n'avait pas d'écran.** `revoquerUnTerminal`
 * existait, documentée, appelant la bonne route — et personne ne l'appelait.
 *
 * **Révoquer ne suffit pas**, et c'est ce que ces tests éprouvent d'abord : le
 * jeton se réenregistre à chaque session, donc couper sans mémoriser le choix
 * ferait un geste qui s'annule tout seul au lancement suivant. Un bouton qui
 * ment est pire qu'un bouton absent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  noterLeRefus,
  refuseesSurCetAppareil,
} from '../src/shell/notificationsDeCetAppareil';
import { enregistrerCeTerminal } from '../src/shell/useNotificationsPush';

jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('le refus tient au relancement', () => {
  it('un appareil qui n’a rien demandé reçoit ses notifications', async () => {
    // **Le défaut est de notifier**, parce que c'est ce que l'utilisateur a
    // accordé au système. L'inverse ferait taire quelqu'un qui n'a rien demandé.
    expect(await refuseesSurCetAppareil()).toBe(false);

    const api = { enregistrerUnTerminal: jest.fn(async () => ({})) } as never;
    expect(await enregistrerCeTerminal(api)).toMatchObject({ issue: 'enregistre' });
  });

  it('et un appareil qui a coupé ne se réenregistre pas', async () => {
    // **Le cas qui diverge de « révoque et c'est fini ».** Sans cette lecture,
    // le crochet réenregistrerait le jeton à la session suivante et les
    // notifications reviendraient — le geste se serait annulé tout seul.
    await noterLeRefus(true);

    const api = { enregistrerUnTerminal: jest.fn(async () => ({})) } as never;
    expect(await enregistrerCeTerminal(api)).toEqual({ issue: 'refusee-ici' });
    expect((api as unknown as { enregistrerUnTerminal: jest.Mock }).enregistrerUnTerminal)
      .not.toHaveBeenCalled();
  });

  it('et le refus se lève', async () => {
    await noterLeRefus(true);
    await noterLeRefus(false);
    expect(await refuseesSurCetAppareil()).toBe(false);
  });

  it('« refusé ici » n’est pas « refusé par le système »', async () => {
    // Les deux se lèvent à des endroits différents — l'un dans les réglages de
    // l'application, l'autre dans ceux du téléphone. Les confondre enverrait
    // quelqu'un chercher au mauvais endroit.
    await noterLeRefus(true);
    const api = { enregistrerUnTerminal: jest.fn(async () => ({})) } as never;
    expect((await enregistrerCeTerminal(api)).issue).not.toBe('refusee');
  });
});
