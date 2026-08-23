/**
 * L'entrée du produit, sur grand écran.
 *
 * Deux défauts relevés en ligne, tous deux sur la première chose qu'on voit :
 *
 * **Les portes n'étaient pas l'entrée.** L'écran démarrait sur « Sign in », et
 * le choix du rôle vivait derrière un lien : on demandait de se connecter à
 * quelqu'un qui n'a pas encore de compte. La maquette 06a montre l'inverse.
 *
 * **Et « Sign in » n'avait aucune mise en page de bureau.** Le panneau d'encre
 * était conditionné à l'inscription : l'écran le plus visité du produit restait
 * une colonne de 480 centrée dans du vide — le défaut de fond que la v0.6
 * devait corriger, laissé là où il se voit le plus.
 *
 * Le gabarit est simulé ici, la coquille étant éprouvée ailleurs par une vraie
 * mesure : ce qu'on vérifie est ce que l'écran fait de la largeur, pas d'où
 * elle vient.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { AuthScreen } from '../src/screens/AuthScreen';
import { SessionProvider } from '../src/session';
import { ApiProvider, ApiClient } from '../src/api';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '../src/theme';

jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  // `place` vient de la règle elle-même : la recopier ici ferait un
  // double qui dérive le jour où le seuil bouge.
  useGabarit: () => ({
    largeur: 1512,
    large: true,
    place: (besoin: number) =>
      (require('../src/shell/placeDisponible') as typeof import('../src/shell/placeDisponible'))
        .placeDisponible(1512, besoin),
  }),
}));

/** Un écran de bureau : aucune encoche, aucune barre d'accueil. */
const ECRAN_LARGE = {
  frame: { x: 0, y: 0, width: 1512, height: 982 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const coffre = { lire: async () => null, ecrire: async () => {} };
const fetchImpl = (async () =>
  ({ ok: true, status: 200, json: async () => ({}) }) as Response) as unknown as typeof fetch;

async function afficher(motif: 'session_expiree' | null = null) {
  const api = new ApiClient({ baseUrl: 'https://api.test', coffre, fetchImpl });
  return render(
    // Les marges système sont fournies comme dans `App`, où elles enveloppent
    // tout. L'écran de connexion pose lui-même celle du bas : aucune barre
    // d'onglets n'existe avant la connexion pour la poser à sa place, et sans
    // elle le dernier bouton finit sous la barre d'accueil de l'iPhone.
    <SafeAreaProvider initialMetrics={ECRAN_LARGE}>
      <ThemeProvider role="creator">
        <I18nProvider initialLocale="en">
          <SessionProvider baseUrl="https://api.test" coffre={coffre} fetchImpl={fetchImpl}>
            <ApiProvider client={api}>
              <AuthScreen motif={motif} />
            </ApiProvider>
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('l’entrée du produit, grand écran', () => {
  it('ouvre sur les deux portes, pas sur un formulaire de connexion', async () => {
    await afficher();

    expect(screen.getByTestId('porte-createur')).toBeTruthy();
    expect(screen.getByTestId('porte-commerce')).toBeTruthy();
    // On ne demande pas de se connecter à qui n'a pas encore de compte.
    expect(screen.queryByTestId('champ-email')).toBeNull();
  });

  /**
   * **Le panneau d'encre est parti, et quatre tests avec lui.**
   *
   * Ils disaient qu'il se rendait aussi à la connexion, qu'il portait la
   * promesse de la porte franchie, qu'il ne faisait plus trois lignes sur 604,
   * et qu'il ne numérotait pas des faits comme une mise en route. Chacun
   * corrigeait un vrai défaut **du panneau**. La planche v3 le retire sans le
   * remplacer : il expliquait le produit à quelqu'un qui a déjà un compte,
   * c'est-à-dire à la seule personne qui n'a pas besoin qu'on le lui explique.
   *
   * Ce qui reste ici est ce qui ne dépendait pas de lui : que les portes soient
   * l'entrée, et qu'on ne repose pas la question du rôle à qui revient.
   */
  it('ne rend plus le panneau d’encre, sur aucune des deux étapes', async () => {
    // **Les deux étapes, et c'est ce qui compte.** Il était conditionné à
    // l'inscription avant de valoir partout ; ne vérifier que la connexion
    // laisserait revenir la moitié qu'on vient de retirer.
    await afficher();
    expect(screen.queryByTestId('panneau-de-promesse')).toBeNull();

    await fireEvent.press(screen.getByTestId('choisir-creator'));
    expect(screen.queryByTestId('panneau-de-promesse')).toBeNull();
  });

  it('ne repose pas la question du rôle à qui revient d’une session expirée', async () => {
    // Il a un compte, donc un rôle. Le lui redemander serait une question dont
    // on connaît la réponse.
    await afficher('session_expiree');

    expect(screen.getByTestId('champ-email')).toBeTruthy();
    expect(screen.queryByTestId('porte-createur')).toBeNull();
    expect(screen.getByTestId('motif-de-sortie')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// campagne 2 : un grand aplat noir presque vide
// --------------------------------------------------------------------------

/**
 * **Le bloc du panneau d'encre est retiré en entier.**
 *
 * Ses deux tests corrigeaient de vrais défauts — trois lignes sur 604 à la
 * connexion, et des faits numérotés comme une mise en route. Ils portaient sur
 * un panneau que la planche v3 supprime : les garder demanderait de le
 * remettre pour les faire passer.
 */
