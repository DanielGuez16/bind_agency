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

import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { RedemptionScreen, type Scanner } from '../src/screens/RedemptionScreen';
import { ThemeProvider } from '../src/theme';

const VERIFICATION = {
  booking_id: 'b1',
  redemption_code_id: 'c1',
  creator_name: 'Rebecca Alvarez',
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
        <RedemptionScreen
          apiUrl="http://test/api/v1"
          accessToken="un-jeton"
          scanner={options.scanner}
        />
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
    expect(vue.getByText(/Rebecca Alvarez/)).toBeTruthy();
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
});
