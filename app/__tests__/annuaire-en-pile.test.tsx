/**
 * L'annuaire : une grille au-dessus du seuil, une pile virtualisée en dessous.
 *
 * **Le cas grave est le téléphone.** « Voir plus » empile vingt créatrices par
 * appui : après quatre appuis, quatre-vingts portraits sont montés d'un coup.
 * `Image` décode avant de réduire — la vignette réduit ce que chacun coûte, la
 * virtualisation réduit combien en coûtent à la fois, et les deux se cumulent.
 *
 * **Le décor divergent est le pied.** Une implémentation qui passe en liste
 * sans porter « voir plus » dans `ListFooterComponent` rend un écran qui a
 * l'air juste — les fiches sont là, l'entête aussi — et retire la seule façon
 * de voir les créatrices suivantes. Il n'y a pas de crochet de fin de liste
 * dans le contrat, volontairement : « voir plus » est un appui explicite.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { AnnuaireScreen } from '../src/screens/AnnuaireScreen';
import { GabaritProvider } from '../src/shell/gabarit';
import { breakpoint, ThemeProvider } from '../src/theme';

const CREATEUR = (n: number) => ({
  creator_id: `c${n}`,
  distance_metres: 1200,
  acces: 'ouvert',
  comptes: [
    {
      platform: 'instagram',
      handle: `@lea${n}`,
      followers: 4200,
      avatar_key: `photos/creatrices/lea${n}.jpg`,
    },
  ],
});

const PORTEE = {
  createurs: 128,
  peuvent_reserver: 41,
  rayon_metres: 15000,
  gains_par_palier: [],
};

function annuaireDe(combien: number, total = 128) {
  return {
    total,
    portee: PORTEE,
    createurs: Array.from({ length: combien }, (_, i) => CREATEUR(i + 1)),
  };
}

async function monter(largeur: number) {
  const appels: string[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL) => {
      const chemin = String(url);
      appels.push(chemin);
      if (chemin.includes('/creators')) {
        return { ok: true, status: 200, json: async () => annuaireDe(2) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch,
  });

  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <GabaritProvider>
          <ApiProvider client={api}>
            <AnnuaireScreen businessId="b1" />
          </ApiProvider>
        </GabaritProvider>
      </ThemeProvider>
    </I18nProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());
  await fireEvent(screen.getByTestId('gabarit'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: largeur, height: 982 } },
  });
  return { appels };
}

describe('sur le téléphone, la pile est virtualisée', () => {
  it('porte l’entête, les fiches et le pied — les trois morceaux survivent au découpage', async () => {
    await monter(390);

    // L'entête : la portée et l'ordre, qui défilent avec la liste.
    expect(screen.getByTestId('ordre-de-la-grille')).toBeTruthy();
    // Les fiches.
    expect(screen.getByTestId('createur-c1')).toBeTruthy();
    expect(screen.getByTestId('createur-c2')).toBeTruthy();
    // Le pied : le compte, et le seul chemin vers la suite.
    expect(screen.getByTestId('compte-affiche')).toBeTruthy();
    expect(screen.getByTestId('voir-plus')).toBeTruthy();
  });

  it('et « voir plus » pagine toujours depuis le pied', async () => {
    // **Il n'y a pas de crochet de fin de liste dans le contrat**, et il n'en
    // faut pas : « voir plus » est un appui explicite. S'il ne partait plus, la
    // pagination disparaîtrait sans qu'aucune erreur ne le dise.
    const { appels } = await monter(390);

    await fireEvent.press(screen.getByTestId('voir-plus'));

    await waitFor(() =>
      expect(appels.filter((a) => a.includes('decalage=2'))).toHaveLength(1),
    );
  });
});

describe('au-dessus du seuil, la grille reste un bloc', () => {
  it('les mêmes trois morceaux, posés autrement', async () => {
    // Trois colonnes en `flexWrap` ne sont pas une liste : le contrat de
    // `liste` rend un élément par rangée et n'a aucune notion de colonnes.
    // Changer la disposition pour pouvoir virtualiser serait prendre le
    // problème par le mauvais bout.
    await monter(breakpoint.expanded);

    expect(screen.getByTestId('ordre-de-la-grille')).toBeTruthy();
    expect(screen.getByTestId('createur-c1')).toBeTruthy();
    expect(screen.getByTestId('voir-plus')).toBeTruthy();
  });
});

describe('le portrait demande la vignette', () => {
  it('sur une clé nue, et pas l’original', async () => {
    await monter(390);

    expect(String(screen.getByTestId('photo-c1-image').props.source.uri)).toMatch(
      /lea1\.jpg@vignette$/,
    );
  });
});
