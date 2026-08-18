/**
 * Notifications côté app : l'autorisation et le jeton.
 *
 * **Les sept réglages ont été retirés du produit**, et les tests qui les
 * couvraient avec eux. Ce qui reste est ce qui n'était pas une préférence :
 * demander l'autorisation, poser le jeton, le révoquer.
 *
 * **Non vérifiées de bout en bout**, comme côté serveur : Expo ne délivre de
 * jeton distant que sur un build de développement, et personne n'a encore vu
 * une notification arriver. Ce qui s'éprouve ici est ce que l'app **décide** —
 * quand elle demande, quand elle s'abstient, et ce qu'elle envoie.
 *
 * La règle qui porte ce fichier : **on ne redemande que là où la fenêtre
 * s'ouvrira**. C'est la leçon de la position, où un bouton qui ne produisait
 * plus rien a coûté une campagne.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Api, ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { enregistrerCeTerminal } from '../src/shell/useNotificationsPush';
import { ThemeProvider } from '../src/theme';

const permissions = {
  actuel: { granted: false, canAskAgain: true },
  demandee: false,
};

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => permissions.actuel,
  requestPermissionsAsync: async () => {
    permissions.demandee = true;
    return { granted: true };
  },
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[abc]' }),
}));

const coffre = { lire: async () => null, ecrire: async () => {} };

function clientDe(
  table: Record<string, unknown>,
  espion?: (chemin: string, methode: string, corps: unknown) => void,
): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, init) => {
      const chemin = String(url);
      espion?.(chemin, init?.method ?? 'GET', init?.body ? JSON.parse(String(init.body)) : null);
      const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
      if (!trouve) throw new Error(`route non simulée : ${chemin}`);
      return { ok: true, status: 200, json: async () => trouve[1] } as Response;
    },
  });
}

beforeEach(() => {
  permissions.actuel = { granted: false, canAskAgain: true };
  permissions.demandee = false;
});

// --------------------------------------------------------------------------
// l'autorisation et le jeton
// --------------------------------------------------------------------------

describe('l’enregistrement du terminal', () => {
  it('demande l’autorisation, puis donne le jeton au serveur', async () => {
    const envois: { chemin: string; methode: string; corps: unknown }[] = [];
    const api = clientDe({ '/me/devices': { id: 'd1' } }, (chemin, methode, corps) =>
      envois.push({ chemin, methode, corps }),
    );

    const issue = await enregistrerCeTerminal(new Api(api));

    expect(issue).toEqual({ issue: 'enregistre', token: 'ExponentPushToken[abc]' });
    expect(permissions.demandee).toBe(true);
    expect(envois[0].methode).toBe('PUT');
    expect(envois[0].corps).toMatchObject({ token: 'ExponentPushToken[abc]' });
  });

  it('ne redemande rien quand le système ne reposera plus la question', async () => {
    // Après un refus, `requestPermissionsAsync` répond « refusé » sans rien
    // afficher : insister ne rouvre rien, et le prétendre serait le défaut
    // qu'on a déjà réparé sur la position.
    permissions.actuel = { granted: false, canAskAgain: false };
    const api = clientDe({ '/me/devices': { id: 'd1' } });

    const issue = await enregistrerCeTerminal(new Api(api));

    expect(issue).toEqual({ issue: 'refusee' });
    expect(permissions.demandee).toBe(false);
  });

  it('ne redemande pas une autorisation déjà accordée', async () => {
    // Rappelé à chaque démarrage : reposer la question à quelqu'un qui a déjà
    // dit oui est un geste de plus pour rien.
    permissions.actuel = { granted: true, canAskAgain: true };
    const api = clientDe({ '/me/devices': { id: 'd1' } });

    const issue = await enregistrerCeTerminal(new Api(api));

    expect(issue).toMatchObject({ issue: 'enregistre' });
    expect(permissions.demandee).toBe(false);
  });

  it('ne fait pas tomber l’app quand le serveur refuse', async () => {
    // Le produit fonctionne sans notifications ; il prévient seulement moins
    // bien. Lever ferait tomber la frontière d'erreur sur un manque supportable.
    const api = clientDe({});

    const issue = await enregistrerCeTerminal(new Api(api));

    expect(issue).toEqual({ issue: 'echec' });
  });
});
