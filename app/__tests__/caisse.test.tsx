/**
 * Écran de caisse.
 *
 * Le scanner réel n'est pas éprouvé ici — aucune caméra en test — et c'est
 * pourquoi il est injecté : tout le reste de l'écran l'est.
 *
 * Ce que ces tests protègent surtout, c'est l'ordre : la saisie manuelle est le
 * chemin de premier rang, disponible d'emblée, y compris quand la caméra
 * manque. Dans un salon, elle manque souvent.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { RedemptionScreen, type Scanner } from '../src/screens/RedemptionScreen';
import { ThemeProvider } from '../src/theme';

/**
 * Un client d'API branché sur le `fetch` que `repond` vient de poser.
 *
 * **L'écran ne reçoit plus de jeton brut.** Il passait `accessToken` et
 * construisait ses requêtes ; à l'expiration du jeton, la caisse affichait
 * « authentification requise » sur chaque code présenté, sans rotation ni
 * retour à la connexion. Le monter derrière un vrai client fait passer ces
 * tests par le même chemin que la production — rotation comprise.
 *
 * Construit **après** `repond`, jamais avant : le client capture le `fetch`
 * global à sa construction, et le prendre plus tôt le figerait sur le vrai.
 */
function clientDeTest() {
  let jetons: { access_token: string; refresh_token: string } | null = {
    access_token: 'un-jeton',
    refresh_token: 'de-rotation',
  };
  return new ApiClient({
    baseUrl: 'http://test',
    coffre: {
      lire: async () => jetons,
      ecrire: async (nouveaux) => {
        jetons = nouveaux;
      },
    },
  });
}

const VERIFICATION = {
  booking_id: 'b1',
  redemption_code_id: 'c1',
  creator_handle: 'rebecca.miami',
  item_name: 'Soin visage',
  item_photo_key: null,
  starts_at: null,
  valid_until: '2026-09-01T10:00:00Z',
  status: 'confirmed',
  par_secours: false,
};

function repond(reponses: Array<{ ok: boolean; corps: object }>) {
  const file = [...reponses];
  global.fetch = jest.fn().mockImplementation(async () => {
    const suivante = file.shift() ?? { ok: true, corps: {} };
    return { ok: suivante.ok, status: suivante.ok ? 200 : 409, json: async () => suivante.corps };
  }) as unknown as typeof fetch;
}

/** Un scanner factice : un bouton qui rend un code, sans caméra. */
const scannerFactice: Scanner = ({ onCode }) => (
  <Pressable accessibilityRole="button" onPress={() => onCode('c1:123456')}>
    <Text>scanner-factice</Text>
  </Pressable>
);

async function afficher(options: { scanner?: Scanner; locale?: 'en' | 'es' } = {}) {
  return render(
    // Le fournisseur de thème est celui du rôle commerce : l'écran lit ses
    // couleurs au lieu de les écrire en dur, et un texte noir sur fond sombre
    // ne peut plus s'y glisser.
    <ThemeProvider role="merchant">
      <I18nProvider initialLocale={options.locale ?? 'en'}>
        <ApiProvider client={clientDeTest()}>
          <RedemptionScreen scanner={options.scanner} />
        </ApiProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('écran de caisse', () => {
  it('propose la saisie manuelle d’emblée, sans caméra', async () => {
    repond([]);
    const vue = await afficher();

    // Le champ est là dès l'ouverture : c'est le chemin principal, pas un repli.
    expect(vue.getByLabelText(en.redemption.manualLabel)).toBeTruthy();
    expect(vue.getByText(en.redemption.manualSubmit)).toBeTruthy();
  });

  it('reconnaît un code saisi à la main', async () => {
    repond([{ ok: true, corps: { ...VERIFICATION, par_secours: true } }]);
    const vue = await afficher();

    await fireEvent.changeText(vue.getByLabelText(en.redemption.manualLabel), '4H29KX');
    await fireEvent.press(vue.getByText(en.redemption.manualSubmit));

    await waitFor(() => expect(vue.getByText('Soin visage')).toBeTruthy());
    // **Le pseudonyme, jamais l'état civil.** La caisse affichait « Rebecca
    // Alvarez » : le nom légal de quelqu'un, au comptoir d'un salon qui n'a
    // aucune raison de le connaître. Ce n'est pas le nom qui autorise le
    // retrait, c'est le code.
    expect(vue.getByText(/rebecca.miami/)).toBeTruthy();
    expect(vue.queryByText(/Alvarez/)).toBeNull();
    // La caisse sait qu'elle n'a pas scanné : c'est le chemin le moins fort.
    expect(vue.getByText(en.redemption.usedManualCode)).toBeTruthy();
  });

  it('ne sert pas avant qu’on le lui demande', async () => {
    repond([{ ok: true, corps: VERIFICATION }]);
    const vue = await afficher();

    await fireEvent.changeText(vue.getByLabelText(en.redemption.manualLabel), '4H29KX');
    await fireEvent.press(vue.getByText(en.redemption.manualSubmit));
    await waitFor(() => expect(vue.getByText(en.redemption.serve)).toBeTruthy());

    // Un seul appel : vérifier n'est pas consommer, et `consumed` ne se défait pas.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/redemptions/verify');
  });

  it('sert quand on le lui demande', async () => {
    repond([
      { ok: true, corps: VERIFICATION },
      { ok: true, corps: { booking_id: 'b1', status: 'consumed', consumed_at: 'x' } },
    ]);
    const vue = await afficher();

    await fireEvent.changeText(vue.getByLabelText(en.redemption.manualLabel), '4H29KX');
    await fireEvent.press(vue.getByText(en.redemption.manualSubmit));
    await waitFor(() => expect(vue.getByText(en.redemption.serve)).toBeTruthy());

    await fireEvent.press(vue.getByText(en.redemption.serve));
    await waitFor(() => expect(vue.getByText(new RegExp(en.redemption.served))).toBeTruthy());
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('/redemptions/consume');
  });

  it('traduit le refus depuis son code', async () => {
    repond([{ ok: false, corps: { detail: 'redemption_code_already_consumed' } }]);
    const vue = await afficher();

    await fireEvent.changeText(vue.getByLabelText(en.redemption.manualLabel), '4H29KX');
    await fireEvent.press(vue.getByText(en.redemption.manualSubmit));

    await waitFor(() =>
      expect(vue.getByText(en.errors.redemption_code_already_consumed)).toBeTruthy(),
    );
  });

  it('dit quoi faire quand trop d’essais ont échoué', async () => {
    repond([{ ok: false, corps: { detail: 'redemption_too_many_attempts' } }]);
    const vue = await afficher();

    await fireEvent.changeText(vue.getByLabelText(en.redemption.manualLabel), '000000');
    await fireEvent.press(vue.getByText(en.redemption.manualSubmit));

    await waitFor(() => expect(vue.getByText(en.errors.redemption_too_many_attempts)).toBeTruthy());
  });

  it('accepte un code venu du scanner', async () => {
    repond([{ ok: true, corps: VERIFICATION }]);
    const vue = await afficher({ scanner: scannerFactice });

    await fireEvent.press(vue.getByText(en.redemption.scanTab));
    await fireEvent.press(vue.getByText('scanner-factice'));

    await waitFor(() => expect(vue.getByText('Soin visage')).toBeTruthy());
  });

  it('retombe sur la saisie quand aucun scanner n’est fourni', async () => {
    repond([]);
    const vue = await afficher();

    await fireEvent.press(vue.getByText(en.redemption.scanTab));

    // Le champ reste, et l'écran dit pourquoi. Un onglet vide laisserait la
    // caisse devant un écran noir sans recours.
    expect(vue.getByLabelText(en.redemption.manualLabel)).toBeTruthy();
    expect(vue.getByText(en.redemption.cameraUnavailable)).toBeTruthy();
  });

  it('bascule entièrement en espagnol', async () => {
    repond([]);
    const vue = await afficher({ locale: 'es' });

    expect(vue.getByText(es.redemption.title)).toBeTruthy();
    expect(vue.queryByText(en.redemption.title)).toBeNull();
  });

  it("dit que le code n'a pas été vérifié quand la requête n'est jamais partie", async () => {
    /**
     * **La distinction que la caisse ne peut pas se permettre de perdre.** Un
     * refus nomme le code — déjà servi, expiré — et la cliente est en cause.
     * Une panne de transport n'a rien appris du code : afficher un refus ferait
     * redemander dix fois son code à quelqu'un dont le code est parfaitement
     * bon, parce que le réseau du salon est tombé.
     *
     * Aucun test ne couvrait cette branche : une mutation qui remplaçait la
     * panne par un refus passait toute la suite au vert.
     */
    global.fetch = jest.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch;
    const vue = await afficher();

    await fireEvent.changeText(vue.getByLabelText(en.redemption.manualLabel), '4H29KX');
    await fireEvent.press(vue.getByText(en.redemption.manualSubmit));

    await waitFor(() => expect(vue.getByText(en.redemption.unreachableHint)).toBeTruthy());
    expect(vue.getByText(en.errors.network)).toBeTruthy();
    // Et surtout : aucun code de refus, qui désignerait la cliente à tort.
    expect(vue.queryByText(en.redemption.refusedHint)).toBeNull();
  });

  it('ferme la session quand le jeton de la caisse a expiré', async () => {
    /**
     * **Le blocage que ça répare.** L'écran recevait un jeton brut, lu une fois
     * à son ouverture. Quinze minutes plus tard il était périmé, le serveur
     * répondait 401, et la caisse affichait « authentification requise » sur
     * chaque code présenté — indéfiniment, sans rotation et sans jamais
     * proposer de se reconnecter. Le seul recours était de fermer
     * l'application.
     *
     * On éprouve le signal, pas l'écran de connexion : c'est `surSessionPerdue`
     * qui fait basculer la coquille, et elle le fait au-dessus de tous les
     * écrans à la fois.
     */
    const perdue = jest.fn();
    // 401 sur le retrait *et* sur la rotation : la session est prouvée morte.
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'authentication_required' }),
    })) as unknown as typeof fetch;

    const client = new ApiClient({
      baseUrl: 'http://test',
      coffre: {
        lire: async () => ({ access_token: 'perime', refresh_token: 'perime-aussi' }),
        ecrire: async () => {},
      },
      surSessionPerdue: perdue,
    });

    const vue = await render(
      <ThemeProvider role="merchant">
        <I18nProvider initialLocale="en">
          <ApiProvider client={client}>
            <RedemptionScreen />
          </ApiProvider>
        </I18nProvider>
      </ThemeProvider>,
    );

    await fireEvent.changeText(vue.getByLabelText(en.redemption.manualLabel), '4H29KX');
    await fireEvent.press(vue.getByText(en.redemption.manualSubmit));

    await waitFor(() => expect(perdue).toHaveBeenCalled());
  });
});

it('ouvre sur le scan, et laisse la saisie à un geste', async () => {
  /**
   * **L'ordre dit quel chemin est le principal.** La saisie était devant, et
   * l'argument tenait : une caméra sale arrive dans un salon. Mais ce sont les
   * mauvais jours, et le geste ordinaire est de présenter un téléphone à un
   * autre — six caractères tapés à chaque passage pour se prémunir d'un cas
   * rare, c'est le cas rare qui décidait de l'écran.
   *
   * Vérifié dans les deux sens : le scanner est là d'emblée, et la saisie reste
   * accessible d'un seul geste. Un test qui ne regarderait que le premier
   * laisserait passer un écran où le secours a disparu.
   */
  const vue = await afficher({ scanner: scannerFactice });

  expect(vue.getByText('scanner-factice')).toBeTruthy();

  await fireEvent.press(vue.getByText(en.redemption.manualTab));
  expect(vue.getByText(en.redemption.manualSubmit)).toBeTruthy();
});
