/**
 * Le chemin vers les paliers, depuis Audience.
 *
 * **Il était sur le fil, et la revue v3 l'en sort.** « Douze prestations vous
 * sont ouvertes » y annonçait un nombre et ouvrait l'explication ; l'écran
 * devait répondre à « qu'est-ce que je réserve », et cette ligne répondait à
 * autre chose. Audience porte déjà les abonnés, les collaborations tenues et le
 * score de fiabilité — c'est-à-dire les trois grandeurs qui ouvrent un palier.
 * Le chemin y est donc chez lui.
 *
 * **Ce qui est éprouvé ici est un chemin, pas un nombre.** Le compte du fil
 * était borné au rayon ; Audience ne connaît pas la position, et reconduire la
 * phrase y aurait donné un second nombre pour la même question. Ce test dit
 * donc trois choses : le chemin existe, il n'est pas offert quand il ne mène
 * nulle part, et il est le **seul** que le produit garde vers les paliers en
 * dehors du fil vide — sans quoi les créateurs qui ont quelque chose à
 * réserver n'y accéderaient plus du tout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { AudienceScreen } from '../src/screens/AudienceScreen';
import { ThemeProvider } from '../src/theme';

const COMPTE = {
  social_account_id: 'sa1',
  platform: 'instagram',
  handle: 'ocean',
  followers_count: 5200,
  engagement_rate: '3.10',
  avg_views: 1800,
  media_count: 42,
  following_count: 300,
  captured_at: '2026-08-01T10:00:00Z',
};

const PALIERS = {
  creator_id: 'c1',
  is_new_creator: false,
  // **La fiabilité vient du service, pas d'une valeur posée à la main.** Un
  // score écrit dans le montage masquerait l'absence du mécanisme qui le
  // produit ; ici on ne l'éprouve pas, on le laisse à sa valeur neutre.
  fiabilite: { reliability_score: null, completed_collabs_count: 3 },
  paliers: [],
};

async function monter(onVoirMesPaliers?: () => void) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL) =>
      ({
        ok: true,
        status: 200,
        // Les chemins réels, relus dans `routes.ts` : `/me/tiers`,
        // `/me/verification`, `/me/audience`. Un montage qui devine les URL
        // rend la mauvaise charge à la bonne requête, et l'écran tombe sur un
        // champ absent — ce qui s'est produit ici avant qu'ils soient vérifiés.
        json: async () =>
          String(url).includes('/me/tiers')
            ? PALIERS
            : String(url).includes('/me/verification')
              ? []
              : [COMPTE],
      }) as Response) as unknown as typeof fetch,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <AudienceScreen onVoirMesPaliers={onVoirMesPaliers} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('les paliers s’ouvrent depuis Audience', () => {
  it('le passage est rendu, et il appelle', async () => {
    const ouvrir = jest.fn();
    const vue = await monter(ouvrir);
    await waitFor(() => expect(screen.getByTestId('voir-mes-paliers')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('voir-mes-paliers'));
    expect(ouvrir).toHaveBeenCalledTimes(1);
    await vue.unmount();
  });

  it('et il ne se rend pas quand il ne mène nulle part', async () => {
    // Le sens inverse, et c'est celui qui compte : un lien qui ne mène nulle
    // part vaut moins que pas de lien. La même règle valait sur le fil, où la
    // ligne restait une phrase — ici elle disparaît, parce qu'elle n'apporte
    // rien d'autre que le chemin.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('ce-qui-compte')).toBeTruthy());

    expect(screen.queryByTestId('voir-mes-paliers')).toBeNull();
    await vue.unmount();
  });

  it('et l’onglet le lui passe vraiment', async () => {
    // **Sans cette lecture, les deux tests au-dessus passeraient sur un écran
    // que personne ne câble.** C'est exactement le défaut qui a coûté seize PR
    // ailleurs : un composant qui accepte un rappel, un test qui le lui donne,
    // et aucun appelant dans l'application. Monter la pile d'onglets entière
    // pour éprouver un câblage reviendrait à monter six écrans pour une ligne ;
    // la source suffit à dire que le fil est branché.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'shell', 'Navigation.tsx'),
      'utf-8',
    );

    expect(source).toMatch(/<AudienceScreen onVoirMesPaliers=\{onVoirMesPaliers\} \/>/);
  });
});
