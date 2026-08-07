/**
 * Écran de relecture d'une carte importée.
 *
 * Ce que ces tests protègent : **rien ne part avant la validation**, et la
 * durée est un champ vide que le commerce remplit — jamais une valeur
 * préremplie qu'il validerait sans la lire.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { MenuReviewScreen, type LigneExtraite } from '../src/screens/MenuReviewScreen';

const SURE: LigneExtraite = {
  name: 'Soin visage',
  price_cents: 8000,
  description: null,
  confidence: '0.95',
};
const DOUTEUSE: LigneExtraite = {
  name: 'Ligne floue',
  price_cents: 100,
  description: null,
  confidence: '0.3',
};

function repond(reponse: { ok: boolean; corps: object }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: reponse.ok,
    status: reponse.ok ? 200 : 422,
    json: async () => reponse.corps,
  }) as unknown as typeof fetch;
}

async function afficher(lignes: LigneExtraite[], locale: 'en' | 'es' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <MenuReviewScreen
        apiUrl="http://test/api/v1"
        accessToken="un-jeton"
        businessId="b1"
        importId="i1"
        lignesExtraites={lignes}
      />
    </I18nProvider>,
  );
}

describe('écran de relecture', () => {
  it('n’envoie rien tant que le commerce n’a pas validé', async () => {
    repond({ ok: true, corps: { items_crees: 1 } });
    const vue = await afficher([SURE]);

    await fireEvent.changeText(vue.getByLabelText(`${en.menuImport.nameLabel} 1`), 'Soin premium');

    // Modifier n'envoie rien : seul le bouton final touche au catalogue.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('laisse la durée vide, à saisir', async () => {
    repond({ ok: true, corps: { items_crees: 1 } });
    const vue = await afficher([SURE]);

    // Préremplir avec un chiffre plausible ferait valider une durée que
    // personne n'a choisie.
    expect(vue.getByLabelText(`${en.menuImport.durationLabel} 1`).props.value).toBe('');
    expect(vue.getByText(en.menuImport.durationHint)).toBeTruthy();
  });

  it('envoie ce que le commerce a corrigé, pas ce qui a été extrait', async () => {
    repond({ ok: true, corps: { items_crees: 1 } });
    const vue = await afficher([SURE]);

    await fireEvent.changeText(vue.getByLabelText(`${en.menuImport.nameLabel} 1`), 'Soin premium');
    await fireEvent.changeText(vue.getByLabelText(`${en.menuImport.priceLabel} 1`), '9500');
    await fireEvent.changeText(vue.getByLabelText(`${en.menuImport.durationLabel} 1`), '60');
    await fireEvent.press(vue.getByText(en.menuImport.validate));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const corps = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(corps.lignes[0]).toMatchObject({
      name: 'Soin premium',
      price_cents: 9500,
      duration_minutes: 60,
      retenue: true,
    });
  });

  it('signale les lignes de faible confiance', async () => {
    repond({ ok: true, corps: { items_crees: 0 } });
    const vue = await afficher([SURE, DOUTEUSE]);

    // Une seule alerte : tout signaler reviendrait à ne rien signaler.
    expect(vue.getAllByText(en.menuImport.lowConfidence)).toHaveLength(1);
  });

  it('permet d’écarter une ligne', async () => {
    repond({ ok: true, corps: { items_crees: 0 } });
    const vue = await afficher([DOUTEUSE]);

    await fireEvent(vue.getByLabelText(`${en.menuImport.keep} 1`), 'valueChange', false);
    await fireEvent.changeText(vue.getByLabelText(`${en.menuImport.durationLabel} 1`), '30');
    await fireEvent.press(vue.getByText(en.menuImport.validate));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const corps = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(corps.lignes[0].retenue).toBe(false);
  });

  it('cache la durée pour un article qui ne se réserve pas', async () => {
    repond({ ok: true, corps: { items_crees: 1 } });
    const vue = await afficher([SURE]);

    await fireEvent(vue.getByLabelText(`${en.menuImport.bookable} 1`), 'valueChange', false);

    // Un plat ou une entrée de musée ne bloque aucun poste : demander une durée
    // ferait saisir un chiffre sans objet.
    expect(vue.queryByLabelText(`${en.menuImport.durationLabel} 1`)).toBeNull();
  });

  it('traduit le refus depuis son code', async () => {
    repond({ ok: false, corps: { detail: 'menu_import_duration_required' } });
    const vue = await afficher([SURE]);

    await fireEvent.press(vue.getByText(en.menuImport.validate));

    await waitFor(() =>
      expect(vue.getByText(en.errors.menu_import_duration_required)).toBeTruthy(),
    );
  });

  it('dit quoi faire quand rien n’a été lu', async () => {
    repond({ ok: true, corps: {} });
    const vue = await afficher([]);

    // Un écran vide sans explication laisserait le commerce croire à une panne.
    expect(vue.getByText(en.menuImport.empty)).toBeTruthy();
  });

  it('bascule entièrement en espagnol', async () => {
    repond({ ok: true, corps: { items_crees: 1 } });
    const vue = await afficher([SURE], 'es');

    expect(vue.getByText(es.menuImport.title)).toBeTruthy();
    expect(vue.queryByText(en.menuImport.title)).toBeNull();
  });
});
