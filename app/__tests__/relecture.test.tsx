/**
 * Écran de relecture d'une carte importée.
 *
 * Ce que ces tests protègent : **rien ne part avant la validation**, et la
 * durée est un champ vide que le commerce remplit — jamais une valeur
 * préremplie qu'il validerait sans la lire.
 *
 * **Le prix n'est plus un champ.** Il est lu par l'extraction et transmis tel
 * quel : le produit ne montre aucun montant, et celui-ci était le seul, sur le
 * seul écran qui en portait un, en centimes. Ce que le test garde est qu'il
 * arrive quand même au serveur — une donnée de reporting perdue en silence
 * serait pire qu'un champ de trop.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type LigneExtraite } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { MenuReviewScreen } from '../src/screens/MenuReviewScreen';
import { ThemeProvider } from '../src/theme';

const coffre = { lire: async () => null, ecrire: async () => {} };

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

/** Ce que le client a réellement envoyé, pour l'éprouver après validation. */
const envoyes: { url: string; corps: string | undefined }[] = [];

function clientDe(reponse: { ok: boolean; corps: object }) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, options) => {
      envoyes.push({ url: String(url), corps: options?.body as string | undefined });
      return {
        ok: reponse.ok,
        status: reponse.ok ? 200 : 422,
        json: async () => reponse.corps,
      } as Response;
    },
  });
}

async function afficher(
  lignes: LigneExtraite[],
  reponse: { ok: boolean; corps: object } = { ok: true, corps: { items_crees: 1 } },
  locale: 'en' | 'es' = 'en',
) {
  return render(
    <I18nProvider initialLocale={locale}>
      <ThemeProvider role="merchant">
        <ApiProvider client={clientDe(reponse)}>
          <MenuReviewScreen businessId="b1" importId="i1" lignesExtraites={lignes} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  envoyes.length = 0;
});

describe('écran de relecture', () => {
  it('n’envoie rien tant que le commerce n’a pas validé', async () => {
    const vue = await afficher([SURE]);

    await fireEvent.changeText(vue.getByTestId('nom-lu-0'), 'Soin premium');

    // Modifier n'envoie rien : seul le bouton final touche au catalogue.
    expect(envoyes).toHaveLength(0);
  });

  it('laisse la durée vide, à saisir', async () => {
    const vue = await afficher([SURE]);

    // Préremplir avec un chiffre plausible ferait valider une durée que
    // personne n'a choisie.
    expect(vue.getByTestId('duree-lue-0').props.value).toBe('');
    expect(vue.getByText(en.menuImport.durationHint)).toBeTruthy();
  });

  it('envoie ce que le commerce a corrigé, et le prix qu’il n’a pas touché', async () => {
    const vue = await afficher([SURE]);

    await fireEvent.changeText(vue.getByTestId('nom-lu-0'), 'Soin premium');
    await fireEvent.changeText(vue.getByTestId('duree-lue-0'), '60');
    await fireEvent.press(vue.getByTestId('valider-la-carte'));

    await waitFor(() => expect(envoyes).toHaveLength(1));
    expect(envoyes[0].url).toContain('/menu-imports/i1/validate');
    expect(JSON.parse(envoyes[0].corps ?? '{}').lignes[0]).toMatchObject({
      name: 'Soin premium',
      duration_minutes: 60,
      retenue: true,
      // Lu sur la carte, jamais montré, jamais saisi, et transmis quand même.
      price_cents: 8000,
    });
  });

  it('signale les lignes de faible confiance', async () => {
    const vue = await afficher([SURE, DOUTEUSE]);

    // Une seule alerte : tout signaler reviendrait à ne rien signaler.
    expect(vue.queryByTestId('confiance-basse-0')).toBeNull();
    expect(vue.getByTestId('confiance-basse-1')).toBeTruthy();
  });

  it('permet d’écarter une ligne', async () => {
    const vue = await afficher([DOUTEUSE]);

    await fireEvent.press(vue.getByTestId('garder-0'));
    await fireEvent.changeText(vue.getByTestId('duree-lue-0'), '30');
    await fireEvent.press(vue.getByTestId('valider-la-carte'));

    await waitFor(() => expect(envoyes).toHaveLength(1));
    expect(JSON.parse(envoyes[0].corps ?? '{}').lignes[0].retenue).toBe(false);
  });

  it('cache la durée pour un article qui ne se réserve pas', async () => {
    const vue = await afficher([SURE]);

    await fireEvent.press(vue.getByTestId('reservable-0'));

    // Un plat ou une entrée de musée ne bloque aucun poste : demander une durée
    // ferait saisir un chiffre sans objet.
    expect(vue.queryByTestId('duree-lue-0')).toBeNull();
  });

  it('traduit le refus depuis son code', async () => {
    const vue = await afficher([SURE], {
      ok: false,
      corps: { detail: 'menu_import_duration_required' },
    });

    await fireEvent.press(vue.getByTestId('valider-la-carte'));

    await waitFor(() =>
      expect(vue.getByTestId('refus-de-la-carte')).toHaveTextContent(
        en.errors.menu_import_duration_required,
      ),
    );
  });

  it('dit quoi faire quand rien n’a été lu', async () => {
    const vue = await afficher([]);

    // Un écran vide sans explication laisserait le commerce croire à une panne.
    expect(vue.getByText(en.menuImport.empty)).toBeTruthy();
  });

  it('bascule entièrement en espagnol', async () => {
    const vue = await afficher([SURE], { ok: true, corps: { items_crees: 1 } }, 'es');

    expect(vue.getByText(es.menuImport.title)).toBeTruthy();
    expect(vue.queryByText(en.menuImport.title)).toBeNull();
  });
});
