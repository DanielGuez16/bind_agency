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
import { ThemeProvider } from '../src/theme';

jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: 1512, large: true }),
}));

const coffre = { lire: async () => null, ecrire: async () => {} };
const fetchImpl = (async () =>
  ({ ok: true, status: 200, json: async () => ({}) }) as Response) as unknown as typeof fetch;

async function afficher(motif: 'session_expiree' | null = null) {
  const api = new ApiClient({ baseUrl: 'https://api.test', coffre, fetchImpl });
  return render(
    <ThemeProvider role="creator">
      <I18nProvider initialLocale="en">
        <SessionProvider baseUrl="https://api.test" coffre={coffre} fetchImpl={fetchImpl}>
          <ApiProvider client={api}>
            <AuthScreen motif={motif} />
          </ApiProvider>
        </SessionProvider>
      </I18nProvider>
    </ThemeProvider>,
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

  it('donne au formulaire de connexion la même mise en page qu’à l’inscription', async () => {
    // Le panneau était conditionné à l'inscription : « Sign in » restait une
    // colonne de 480 dans du vide, sur l'écran le plus visité du produit.
    await afficher();
    await fireEvent.press(screen.getByTestId('vers-connexion'));

    expect(screen.getByTestId('champ-email')).toBeTruthy();
    expect(screen.getByTestId('panneau-de-promesse')).toBeTruthy();
    // Sans porte franchie, le panneau porte la promesse commune.
    expect(screen.getByText(en.auth.accroche)).toBeTruthy();
  });

  it('garde le panneau après une porte, avec la promesse choisie', async () => {
    await afficher();
    await fireEvent.press(screen.getByTestId('choisir-business_member'));

    const panneau = screen.getByTestId('panneau-de-promesse');
    expect(panneau).toHaveTextContent(new RegExp(en.auth.porteCommerce));
    expect(panneau).toHaveTextContent(new RegExp(en.auth.etapeCommerce1));
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
