/**
 * La caisse sur grand écran.
 *
 * Ce que la version de bureau ajoute et que rien n'éprouvait : la barre sur
 * encre, le pavé de douze touches, et le fait que les deux entrées — pavé et
 * clavier — arrivent dans la même valeur.
 *
 * Le gabarit est simulé : l'environnement de test rend toujours une largeur
 * nulle, et sans ce remplacement aucun de ces éléments ne serait monté.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { RedemptionScreen, type Scanner } from '../src/screens/RedemptionScreen';
import { ThemeProvider } from '../src/theme';

jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  useGabarit: () => ({ largeur: 1512, large: true }),
}));

const scannerFactice: Scanner = ({ onCode }) => (
  <Pressable accessibilityRole="button" onPress={() => onCode('c1:123456')}>
    <Text>scanner-factice</Text>
  </Pressable>
);

function repond(reponses: Array<{ ok: boolean; corps: object }>) {
  const file = [...reponses];
  global.fetch = jest.fn().mockImplementation(async () => {
    const suivante = file.shift() ?? { ok: true, corps: {} };
    return { ok: suivante.ok, status: suivante.ok ? 200 : 409, json: async () => suivante.corps };
  }) as unknown as typeof fetch;
}

async function afficher(scanner?: Scanner) {
  return render(
    <ThemeProvider role="merchant">
      <I18nProvider initialLocale="en">
        <RedemptionScreen apiUrl="http://test/api/v1" accessToken="un-jeton" scanner={scanner} />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('caisse, grand écran', () => {
  it('pose la barre de caisse sur encre', async () => {
    // Le seul écran commerce qui se lit debout, à un mètre, entre deux
    // clientes : le contraste maximal y est un choix de lisibilité.
    repond([]);
    await afficher();

    expect(screen.getByTestId('barre-de-caisse')).toBeTruthy();
  });

  it('garde le pavé, et le fait entrer dans le même champ que le clavier', async () => {
    // Au comptoir on tape d'une main. Les deux entrées arrivent dans la même
    // valeur : rien ne les distingue à l'arrivée.
    repond([]);
    await afficher();

    await fireEvent.changeText(screen.getByTestId('champ-code'), '9K');
    await fireEvent.press(screen.getByTestId('touche-4'));
    await fireEvent.press(screen.getByTestId('touche-A'));

    expect(screen.getByTestId('champ-code').props.value).toBe('9K4A');
  });

  it('n’offre aucune touche absente de l’alphabet des codes', async () => {
    // `0`, `1`, `I` et `O` n'existent pas dans un code de secours : les
    // proposer ne fabriquerait que des refus, et le comptoir accuserait la
    // cliente.
    repond([]);
    await afficher();

    for (const interdit of ['0', '1', 'I', 'O']) {
      expect(screen.queryByTestId(`touche-${interdit}`)).toBeNull();
    }
  });

  it('efface la saisie sans rien envoyer', async () => {
    repond([]);
    await afficher();

    await fireEvent.press(screen.getByTestId('touche-7'));
    await fireEvent.press(screen.getByTestId('effacer-code'));

    expect(screen.getByTestId('champ-code').props.value).toBe('');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('garde la saisie manuelle au premier rang, scanner ou non', async () => {
    // Dans un salon, une caméra sale ou une lumière rasante arrivent tous les
    // jours. Le champ est utilisable d'emblée.
    repond([]);
    await afficher(scannerFactice);

    expect(screen.getByTestId('champ-code')).toBeTruthy();
    expect(screen.getByText(en.redemption.manualHint)).toBeTruthy();
  });
});
