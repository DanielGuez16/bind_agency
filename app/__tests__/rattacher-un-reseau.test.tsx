/**
 * Rattacher un réseau : un appui produit toujours quelque chose.
 *
 * **Le défaut que ce fichier rend impossible à réécrire.** Les deux écrans qui
 * proposent de rattacher un réseau portaient chacun leur copie du geste ; l'une
 * s'est retrouvée avec un `try` vide. L'appui posait l'état de chargement, ne
 * faisait rien, et le retirait dans le `finally` : aucune vue, aucun message,
 * aucun état — rien. Le silence exact qu'on traque partout ailleurs, et aucun
 * test ne touchait ces boutons.
 *
 * On presse donc réellement, et on vérifie les trois issues : la vue s'ouvre,
 * l'échec se dit, l'abandon se tait.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { AudienceScreen } from '../src/screens/AudienceScreen';
import { BienvenueScreen } from '../src/screens/BienvenueScreen';

/**
 * La vue d'authentification, remplacée : on veut savoir si elle est ouverte.
 *
 * Préfixées `mock` : la fabrique de `jest.mock` est hissée avant les
 * déclarations du fichier, et Jest n'autorise qu'elles à en franchir la
 * frontière.
 */
const mockOuvertures: { url: string; retour: string }[] = [];
let mockReponseDuNavigateur: { type: string; url?: string } = {
  type: 'success',
  url: 'exp://test/--/oauth?statut=rattache&handle=daniel',
};

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async (url: string, retour: string) => {
    mockOuvertures.push({ url, retour });
    return mockReponseDuNavigateur;
  }),
}));

jest.mock('expo-linking', () => ({
  createURL: (chemin: string) => `exp://test/--/${chemin}`,
  parse: (url: string) => {
    const requete = url.split('?')[1] ?? '';
    const queryParams = Object.fromEntries(new URLSearchParams(requete));
    return { queryParams };
  },
}));

const coffre = { lire: async () => null, ecrire: async () => {} };

/** Ce que l'app a envoyé au serveur en ouvrant le parcours. */
const ouverturesDemandees: unknown[] = [];

/** Ce que le serveur répond à l'ouverture d'un parcours. */
let ouvertureDuServeur: () => Promise<{ ok: boolean; status: number; corps: unknown }> = async () => ({
  ok: true,
  status: 200,
  corps: { authorization_url: 'https://www.instagram.com/oauth/authorize?client_id=1' },
});

function client() {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, init) => {
      const chemin = String(url);
      if (chemin.includes('/connect')) {
        ouverturesDemandees.push(JSON.parse(String(init?.body ?? '{}')));
        const { ok, status, corps } = await ouvertureDuServeur();
        return { ok, status, json: async () => corps } as Response;
      }
      // Le reste de l'écran : aucun compte, aucun contrôle.
      return { ok: true, status: 200, json: async () => [] } as Response;
    },
  });
}

function monter(noeud: React.ReactElement) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={client()}>{noeud}</ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  mockOuvertures.length = 0;
  ouverturesDemandees.length = 0;
  mockReponseDuNavigateur = {
    type: 'success',
    url: 'exp://test/--/oauth?statut=rattache&handle=daniel',
  };
  ouvertureDuServeur = async () => ({
    ok: true,
    status: 200,
    corps: { authorization_url: 'https://www.instagram.com/oauth/authorize?client_id=1' },
  });
});

const ECRANS = [
  {
    nom: 'audience',
    rendre: () => <AudienceScreen />,
    attendre: () => screen.findByTestId('rattacher-un-reseau'),
  },
  {
    nom: 'accueil après inscription',
    rendre: () => <BienvenueScreen onPlusTard={() => {}} />,
    attendre: () => screen.findByTestId('ecran-bienvenue'),
  },
] as const;

describe.each(ECRANS)('sur l’écran $nom', ({ rendre, attendre }) => {
  it('ouvre la vue d’autorisation', async () => {
    await monter(rendre());
    await attendre();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('connecter-instagram'));
    });

    // Le silence constaté sur appareil : le bouton ne produisait rien du tout.
    await waitFor(() => expect(mockOuvertures).toHaveLength(1));
    expect(mockOuvertures[0].url).toContain('instagram.com/oauth/authorize');
    // L'adresse de retour part avec : sans elle, le rappel se termine dans le
    // navigateur et l'app ne sait jamais que le compte est rattaché.
    expect(mockOuvertures[0].retour).toBe('exp://test/--/oauth');
    // Et elle part **aussi** au serveur : c'est lui qui redirige dessus une
    // fois le compte rattaché. La vue se refermerait sans que rien ne revienne.
    expect(ouverturesDemandees).toEqual([{ return_url: 'exp://test/--/oauth' }]);
  });

  it('dit pourquoi quand le serveur refuse d’ouvrir', async () => {
    // Le cas signalé : `SOCIAL_PROVIDER=live` avec une redirection morte.
    ouvertureDuServeur = async () => ({
      ok: false,
      status: 503,
      corps: { detail: 'social_provider_unavailable' },
    });

    await monter(rendre());
    await attendre();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('connecter-instagram'));
    });

    await waitFor(() => expect(screen.getByTestId('echec-connexion')).toBeTruthy());
    expect(mockOuvertures).toHaveLength(0);
    // Jamais le code brut du catalogue.
    expect(screen.queryByText(/social_provider_unavailable/)).toBeNull();
  });

  it('dit pourquoi quand l’autorisation elle-même échoue', async () => {
    mockReponseDuNavigateur = {
      type: 'success',
      url: 'exp://test/--/oauth?statut=erreur&code=social_account_taken',
    };

    await monter(rendre());
    await attendre();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('connecter-instagram'));
    });

    await waitFor(() => expect(screen.getByTestId('echec-connexion')).toBeTruthy());
    expect(screen.getByText(en.errors.social_account_taken)).toBeTruthy();
  });

  it('se tait quand la personne ferme la vue elle-même', async () => {
    // Un abandon est un geste volontaire. Y répondre par une erreur est
    // agressif, et apprend à se méfier des messages du produit.
    mockReponseDuNavigateur = { type: 'dismiss' };

    await monter(rendre());
    await attendre();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('connecter-instagram'));
    });

    await waitFor(() => expect(mockOuvertures).toHaveLength(1));
    expect(screen.queryByTestId('echec-connexion')).toBeNull();
  });
});

describe('un compte venu d’un autre fournisseur', () => {
  /** L'audience d'un créateur, avec un compte que rien ne récupérera. */
  function clientAvecCompte(reconnectable: boolean) {
    return new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      fetchImpl: async (url) => {
        const chemin = String(url);
        if (chemin.includes('/me/audience')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                social_account_id: 'c1',
                platform: 'instagram',
                handle: 'daniel_guez16',
                status: 'expired',
                verification_status: 'verified',
                followers_count: 570,
                following_count: 300,
                media_count: 40,
                avg_views: null,
                engagement_rate: null,
                captured_at: '2026-08-07T12:00:00Z',
                reconnectable,
              },
            ],
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      },
    });
  }

  async function monterAudience(reconnectable: boolean) {
    return render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={clientAvecCompte(reconnectable)}>
            <AudienceScreen />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
  }

  it('le dit, au lieu d’envoyer dans une impasse', async () => {
    // Un compte rattaché en démonstration porte un jeton qui n'existe chez
    // personne. Le fil propose « reconnecter » ; le faire créerait un autre
    // compte et laisserait celui-ci mort à côté.
    await monterAudience(false);

    await waitFor(() =>
      expect(screen.getByTestId('compte-d-un-autre-fournisseur')).toBeTruthy(),
    );
    expect(screen.getByText(en.errors.social_account_from_other_provider)).toBeTruthy();
  });

  it('ne le dit pas quand le compte est récupérable', async () => {
    // L'autre sens : un avertissement affiché partout ne veut plus rien dire.
    await monterAudience(true);

    await waitFor(() => expect(screen.getByTestId('rattacher-un-reseau')).toBeTruthy());
    expect(screen.queryByTestId('compte-d-un-autre-fournisseur')).toBeNull();
  });
});
