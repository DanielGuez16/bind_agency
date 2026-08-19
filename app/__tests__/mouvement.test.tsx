/**
 * Le mouvement sert la lecture : ce qu'il doit faire, et ce qu'il ne doit pas.
 *
 * Deux sujets, réunis parce qu'ils répondent à la même question — l'application
 * accuse-t-elle réception d'un geste, et dit-elle qu'elle change d'état.
 *
 * 1. **Le fondu de la racine.** Connexion, déconnexion, sortie de l'accueil :
 *    ces bascules ne sont pas des navigations mais un rendu conditionnel, que
 *    la pile ignore. Elles coupaient franc. Ce qui les anime est une `key` qui
 *    change ; sans elle, React garde le même nœud et seule la première bascule
 *    joue.
 * 2. **L'haptique des deux gestes qui engagent** : choisir un créneau, et
 *    réserver. Aucun des deux ne renvoyait rien — le parcours créateur entier
 *    était muet, alors que les envois du côté commerce vibraient déjà.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { brancheDeLaRacine } from '../src/shell/brancheDeLaRacine';
import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { CreneauxScreen } from '../src/screens/CreneauxScreen';
import { ThemeProvider } from '../src/theme';

// --------------------------------------------------------------------------
// 1 · la clé qui rejoue le fondu
// --------------------------------------------------------------------------

describe('la clé du fondu de la racine', () => {
  const anonyme = { etat: 'anonyme' };
  const connecte = { etat: 'connecte', vientDeSInscrire: false };
  const inscrit = { etat: 'connecte', vientDeSInscrire: true };

  it('change à chaque bascule que la pile de navigation ne voit pas', () => {
    // Quatre branches, quatre clés distinctes. Deux branches qui partageraient
    // une clé passeraient l'une à l'autre sans fondu — exactement le défaut.
    const cles = [
      brancheDeLaRacine('jeton', anonyme),
      brancheDeLaRacine(null, anonyme),
      brancheDeLaRacine(null, inscrit),
      brancheDeLaRacine(null, connecte),
    ];

    expect(new Set(cles).size).toBe(cles.length);
  });

  it('ne change pas quand rien ne change', () => {
    // **L'autre sens.** Une clé qui varierait à chaque rendu — un compteur, une
    // date — remonterait l'application entière en permanence : on perdrait la
    // position de défilement, l'état des champs, et la pile de navigation.
    expect(brancheDeLaRacine(null, connecte)).toBe(brancheDeLaRacine(null, connecte));
    expect(brancheDeLaRacine('jeton', connecte)).toBe(brancheDeLaRacine('jeton', anonyme));
  });

  it('la prise en main passe devant la connexion', () => {
    // Le gérant arrive par un lien et n'a pas de compte : la clé doit dire
    // « prise en main » même si la session est anonyme, sinon les deux branches
    // se confondraient.
    expect(brancheDeLaRacine('jeton', anonyme)).not.toBe(brancheDeLaRacine(null, anonyme));
  });
});

// --------------------------------------------------------------------------
// 2 · l'haptique des gestes qui engagent
// --------------------------------------------------------------------------

/**
 * Ce que le moteur a reçu.
 *
 * Le préfixe `mock` n'est pas décoratif : Jest hisse `jest.mock` au-dessus des
 * déclarations, et seule une variable ainsi nommée peut être lue dans la
 * fabrique. Sans lui, la fabrique lève « Cannot access before initialization »
 * et le fichier entier échoue à se charger.
 */
const mockHaptique: string[] = [];

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  impactAsync: async (style: string) => {
    mockHaptique.push(`impact:${style}`);
  },
  notificationAsync: async (type: string) => {
    mockHaptique.push(`notification:${type}`);
  },
}));

const FICHE = {
  id: 'b1',
  name: 'Salón Ocean',
  timezone: 'America/New_York',
} as never;

/**
 * **Le montage porte maintenant le palier et le réseau**, parce que l'écran les
 * lit : depuis le créneau v3, l'engagement s'écrit au-dessus du bouton — « une
 * story sur Instagram, sous 48 h » — et un montage qui les omet fait tomber
 * l'écran sur un champ absent. Un `as never` cache le manque au compilateur,
 * pas au rendu.
 */
const OFFRE = {
  tier_offer_id: 'o1',
  social_account_id: 's1',
  catalog_item_id: 'i1',
  name: 'Gel nails',
  requires_booking: true,
  content_format: 'story',
  platform: 'instagram',
  required_mention: null,
  required_geotag: false,
} as never;

/**
 * Le jour du montage, **calculé et non figé**.
 *
 * La bande commence aujourd'hui chez le commerce : une date en dur finirait
 * hors de la fenêtre, et le seul créneau du montage deviendrait invisible. Ce
 * dépôt a déjà payé ce défaut sur un `valid_until`.
 */
const JOUR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  dateStyle: 'short',
}).format(new Date());

function client(reserve: () => void) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url, init) => {
      if (init?.method === 'POST') {
        reserve();
        return { ok: true, status: 200, json: async () => ({ id: 'b-1' }) } as Response;
      }
      // **Deux routes depuis la bande de quatorze jours**, et le montage doit
      // les distinguer : le résumé rend les journées et leur état, la
      // disponibilité rend les heures. Répondre la même chose aux deux donnait
      // une bande dont les jours n'avaient pas de date.
      const resume = String(url).includes('/availability/summary');
      return {
        ok: true,
        status: 200,
        json: async () =>
          resume
            ? [{ jour: JOUR, ouvert: true, revolu: false, creneaux_libres: 1 }]
            : [
                {
                  starts_at: `${JOUR}T14:00:00Z`,
                  ends_at: `${JOUR}T14:45:00Z`,
                  places_restantes: 2,
                },
              ],
      } as Response;
    },
  });
}

async function monter(onReserve = jest.fn()) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={client(() => {})}>
          <CreneauxScreen fiche={FICHE} offre={OFFRE} onReserve={onReserve} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('les gestes qui engagent se sentent', () => {
  beforeEach(() => {
    mockHaptique.length = 0;
  });

  it('choisir un créneau rend un cran', async () => {
    // Le geste central du parcours créateur. Il ne renvoyait rien : la pastille
    // ne changeait de couleur qu'au rendu suivant, et la main n'apprenait rien.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ecran-creneaux')).toBeTruthy());

    const creneaux = screen.getAllByRole('button').filter((n) => /:/.test(String(n.props.accessibilityLabel ?? '')));
    expect(creneaux.length).toBeGreaterThan(0);

    await act(async () => {
      await fireEvent.press(creneaux[0]);
    });

    expect(mockHaptique).toContain('impact:medium');
  });
});
