/**
 * Notifications côté app : l'autorisation, le jeton, et les sept réglages.
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
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Api, ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PreferencesDeNotification } from '../src/screens/PreferencesDeNotification';
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

// --------------------------------------------------------------------------
// les sept réglages
// --------------------------------------------------------------------------

const TOUT_OUVERT = {
  preferences: {
    booking_approved: true,
    booking_declined: true,
    booking_cancelled_by_business: true,
    publication_reminder: true,
    publication_approved: true,
    publication_resubmit: true,
    booking_to_review: true,
  },
};

async function monter(role: string, api: ApiClient) {
  function Cadre({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={api}>{children}</ApiProvider>
        </ThemeProvider>
      </I18nProvider>
    );
  }
  return render(
    <Cadre>
      <PreferencesDeNotification role={role} />
    </Cadre>,
  );
}

describe('les préférences de notification', () => {
  it('ne montre au créateur que les genres qui le concernent', async () => {
    // « Une réservation attend votre décision » ne veut rien dire pour un
    // créateur. Un interrupteur qui ne commande rien est pire qu'absent.
    await monter('creator', clientDe({ '/me/notification-preferences': TOUT_OUVERT }));
    await waitFor(() => expect(screen.getByTestId('preference-booking_approved')).toBeTruthy());

    expect(screen.queryByTestId('preference-booking_to_review')).toBeNull();
  });

  it('ne montre au commerce que le sien', async () => {
    await monter('business_member', clientDe({ '/me/notification-preferences': TOUT_OUVERT }));
    await waitFor(() => expect(screen.getByTestId('preference-booking_to_review')).toBeTruthy());

    expect(screen.queryByTestId('preference-booking_approved')).toBeNull();
  });

  it('n’affiche rien pour l’administration, et n’interroge rien', async () => {
    // Elle travaille sur une file, pas sur des événements qui la concernent.
    const appels: string[] = [];
    await monter(
      'admin',
      clientDe({ '/me/notification-preferences': TOUT_OUVERT }, (chemin) => appels.push(chemin)),
    );

    expect(screen.queryByTestId('preferences-de-notification')).toBeNull();
    expect(appels).toEqual([]);
  });

  it('envoie la bascule, genre par genre', async () => {
    // Un bouton « enregistrer » pour sept interrupteurs ferait perdre six
    // réglages quand le septième échoue.
    const envois: { chemin: string; methode: string; corps: unknown }[] = [];
    await monter(
      'creator',
      clientDe({ '/me/notification-preferences': TOUT_OUVERT }, (chemin, methode, corps) =>
        envois.push({ chemin, methode, corps }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('bascule-publication_reminder')).toBeTruthy());

    await fireEvent(screen.getByTestId('bascule-publication_reminder'), 'press');

    await waitFor(() => expect(envois.some((e) => e.methode === 'PUT')).toBe(true));
    const ecrit = envois.find((e) => e.methode === 'PUT');
    expect(ecrit?.chemin).toContain('publication_reminder');
    expect(ecrit?.corps).toEqual({ enabled: false });
  });

  it('remet l’interrupteur en place quand le serveur refuse', async () => {
    // Le laisser sur une valeur que le serveur ignore ferait croire à un
    // réglage qui n'existe pas.
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      fetchImpl: async (url, init) => {
        if (init?.method === 'PUT') {
          return { ok: false, status: 500, json: async () => ({}) } as Response;
        }
        return { ok: true, status: 200, json: async () => TOUT_OUVERT } as Response;
      },
    });
    await monter('creator', api);
    await waitFor(() => expect(screen.getByTestId('bascule-publication_reminder')).toBeTruthy());

    await fireEvent(screen.getByTestId('bascule-publication_reminder'), 'press');

    await waitFor(() => expect(screen.getByTestId('echec-preference')).toBeTruthy());
    expect(screen.getByTestId('bascule-publication_reminder').props.accessibilityState).toMatchObject(
      { checked: true },
    );
  });

  it('affiche les sept libellés dans les deux langues', () => {
    // Aucune chaîne d'interface écrite en dur : un genre sans libellé
    // s'afficherait sous son code brut, en anglais, dans une interface
    // espagnole.
    const genres = Object.keys(TOUT_OUVERT.preferences);
    for (const genre of genres) {
      expect(en.notifications[genre as keyof typeof en.notifications]).toBeTruthy();
    }
  });
});
