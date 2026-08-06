/**
 * Écran des paliers.
 *
 * Ce qui compte ici n'est pas la mise en page : c'est qu'un créateur qui débute
 * comprenne pourquoi un palier lui est fermé. Un écran qui dirait seulement
 * « bloqué » serait pire qu'un écran vide — il donnerait l'impression d'une
 * porte sans serrure.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { TiersScreen, type VueDesPaliers } from '../src/screens/TiersScreen';

const PALIER_OUVERT = {
  tier_id: 'a',
  platform: 'instagram',
  content_format: 'story',
  min_followers: 1000,
  value_ratio_hint: '1.000',
  accessible: true,
  obstacles: [],
};

const PALIER_FERME = {
  tier_id: 'b',
  platform: 'instagram',
  content_format: 'reel',
  min_followers: 10000,
  value_ratio_hint: '3.000',
  accessible: false,
  obstacles: [{ raison: 'not_enough_followers', requis: 10000, constate: 8600, ecart: 1400 }],
};

function repond(vue: Partial<VueDesPaliers>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      creator_id: 'c',
      is_new_creator: false,
      paliers: [],
      ...vue,
    }),
  }) as unknown as typeof fetch;
}

function afficher(locale: 'en' | 'es' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <TiersScreen apiUrl="http://test/api/v1" accessToken="un-jeton" />
    </I18nProvider>,
  );
}

describe('écran des paliers', () => {
  it('montre les paliers ouverts et fermés', async () => {
    repond({ paliers: [PALIER_OUVERT, PALIER_FERME] });
    afficher();

    await waitFor(() => expect(screen.getByText(en.tiers.title)).toBeTruthy());
    expect(screen.getByText(en.tiers.unlocked)).toBeTruthy();
    // Le fermé est affiché lui aussi : le masquer donnerait un écran vide à
    // tout créateur qui débute.
    expect(screen.getByText(en.tiers.locked)).toBeTruthy();
  });

  it('dit pourquoi un palier est fermé, avec l’écart chiffré', async () => {
    repond({ paliers: [PALIER_FERME] });
    afficher();

    await waitFor(() => expect(screen.getByText(en.tiers.locked)).toBeTruthy());
    // La raison vient d'un code traduit, jamais d'une phrase fabriquée ici.
    expect(screen.getByText(new RegExp(en.errors.not_enough_followers))).toBeTruthy();
    expect(screen.getByText(/1400/)).toBeTruthy();
  });

  it('affiche le badge nouveau créateur et son explication', async () => {
    repond({ is_new_creator: true, paliers: [PALIER_OUVERT] });
    afficher();

    await waitFor(() => expect(screen.getByText(en.tiers.newCreatorBadge)).toBeTruthy());
    expect(screen.getByText(en.tiers.newCreatorHelp)).toBeTruthy();
  });

  it('n’affiche pas le badge à un créateur qui a un historique', async () => {
    repond({ is_new_creator: false, paliers: [PALIER_OUVERT] });
    afficher();

    await waitFor(() => expect(screen.getByText(en.tiers.title)).toBeTruthy());
    expect(screen.queryByText(en.tiers.newCreatorBadge)).toBeNull();
  });

  it('dit quoi faire à un créateur sans compte social', async () => {
    repond({
      is_new_creator: true,
      paliers: [
        {
          ...PALIER_FERME,
          obstacles: [{ raison: 'no_social_account', requis: null, constate: null, ecart: null }],
        },
      ],
    });
    afficher();

    // Sans cette raison nommée, l'écran dirait « bloqué » sans dire quoi faire.
    await waitFor(() => expect(screen.getByText(en.errors.no_social_account)).toBeTruthy());
  });

  it('bascule entièrement en espagnol', async () => {
    repond({ is_new_creator: true, paliers: [PALIER_OUVERT] });
    afficher('es');

    await waitFor(() => expect(screen.getByText(es.tiers.title)).toBeTruthy());
    expect(screen.getByText(es.tiers.newCreatorBadge)).toBeTruthy();
    expect(screen.queryByText(en.tiers.title)).toBeNull();
  });
});
