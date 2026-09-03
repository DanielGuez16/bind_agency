/**
 * Le web ne demande pas une autorisation qu'il ne peut pas utiliser.
 *
 * **Le défaut, et pourquoi rien ne l'a vu.** `useNotificationsPush` gardait
 * son entrée par `Device.isDevice`, en affirmant en commentaire que c'était
 * « le seul test fiable » pour exclure le web. `expo-device` rend pourtant
 * `isDevice: true` **en dur** sur tout navigateur : la garde ne fermait jamais,
 * une vraie fenêtre « Autoriser les notifications ? » s'ouvrait juste après la
 * connexion, et l'enregistrement échouait ensuite faute de clé VAPID.
 *
 * Aucun test ne pouvait l'attraper : tous mockaient `expo-device` avec
 * `isDevice: true` en pensant décrire un téléphone, ce qui est exactement ce
 * que le web renvoie. Le décor du bug et celui du cas nominal étaient le même.
 * Ici on éprouve la plateforme, pas le mock.
 */
import { Platform } from 'react-native';

import { pushDisponible } from '../src/shell/pushDisponible';

const vapid: { cle: string | null } = { cle: null };

jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() {
    return {
      expoConfig: vapid.cle ? { notification: { vapidPublicKey: vapid.cle } } : {},
    };
  },
}));

// Ce que rend expo-device sur un vrai téléphone **et sur tout navigateur** :
// la valeur est identique des deux côtés, c'est tout le problème.
jest.mock('expo-device', () => ({ isDevice: true }));

const original = Platform.OS;

function surPlateforme(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  vapid.cle = null;
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
});

describe('pushDisponible', () => {
  it('est faux sur le web tant qu’aucune clé VAPID n’est configurée', () => {
    // **Le cas de production aujourd'hui** : `app.json` n'en porte aucune, donc
    // `getExpoPushTokenAsync` lèverait. Demander l'autorisation avant de le
    // découvrir dérange pour rien.
    surPlateforme('web');

    expect(pushDisponible()).toBe(false);
  });

  it('devient vrai sur le web le jour où la clé est posée', () => {
    // **L'autre sens, et il compte autant.** Une garde qui refuserait le web
    // en dur resterait fermée après la configuration, et il faudrait s'en
    // souvenir. Elle lit la clé au même endroit qu'expo-notifications.
    surPlateforme('web');
    vapid.cle = 'BParVoiceKeyExample';

    expect(pushDisponible()).toBe(true);
  });

  it('ne dépend pas de la clé en natif, où c’est l’appareil qui décide', () => {
    // Sur un téléphone, VAPID ne sert à rien : c'est `Device.isDevice` qui
    // distingue un vrai appareil d'un simulateur, et il est juste là-bas.
    surPlateforme('ios');

    expect(pushDisponible()).toBe(true);
  });
});
