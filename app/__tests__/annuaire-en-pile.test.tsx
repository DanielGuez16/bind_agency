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
import { StyleSheet } from 'react-native';

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

async function monter(largeur: number, combien = 2) {
  const appels: string[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL) => {
      const chemin = String(url);
      appels.push(chemin);
      if (chemin.includes('/creators')) {
        return { ok: true, status: 200, json: async () => annuaireDe(combien) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch,
  });

  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <GabaritProvider>
          <ApiProvider client={api}>
            <AnnuaireScreen businessId="b1" onRetour={() => {}} retourVers="More" />
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
    // **Et l'ordre est du texte, pas une étiquette.** « Sorted by access, then
    // distance » énonce une règle de tri : trente et un signes, au-delà de la
    // borne de la passation. On éprouve la casse rendue plutôt que le nom du
    // jeton — c'est ce que l'œil reçoit.
    expect(
      StyleSheet.flatten(screen.getByTestId('ordre-de-la-grille').props.style).textTransform,
    ).not.toBe('uppercase');
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


/**
 * Ce que la virtualisation économise, mesuré.
 *
 * **`Image` décode avant de réduire** : une photo occupe sa taille en pixels en
 * mémoire quel que soit le cadre où on la pose. Le nombre de portraits montés
 * est donc la mesure — pas leur taille à l'écran, pas leur poids sur le réseau.
 *
 * **La grille large les montait tous.** Quatre-vingts créatrices : six montées
 * sur le téléphone, quatre-vingts sur la grille, pour le même contenu. C'est
 * treize fois le même coût sur l'écran qui a le plus de place et pas le plus de
 * mémoire — et c'est ce chiffre qui a décidé d'ajouter les colonnes au
 * contrat plutôt que de le laisser en attente d'un cas mesuré.
 *
 * La garde tient le chiffre plutôt que la disposition : elle tomberait aussi si
 * quelqu'un remettait la grille en bloc, ce qui est le seul retour en arrière
 * possible.
 */
describe('la mesure qui a décidé', () => {
  const portraits = () => screen.queryAllByTestId(/^photo-c\d+-image$/).length;

  it.each([
    ['le téléphone', 390],
    ['la grille large', breakpoint.expanded],
  ])('%s ne monte pas les quatre-vingts portraits', async (_nom, largeur) => {
    await monter(largeur, 80);

    const montes = portraits();
    expect(montes).toBeGreaterThan(0);
    // Le seuil est large exprès : ce qui est éprouvé est qu'on virtualise, pas
    // le réglage de fenêtre de `FlatList`, qui peut bouger sans que la règle
    // change.
    expect(montes).toBeLessThan(40);
  });
});

it('porte le retour nommé sur l’écran qu’on voit, pas sur le mur', async () => {
  // **Le défaut que rien n'attrapait.** `AnnuaireScreen` rend deux `Ecran` :
  // le mur d'abonnement, et l'annuaire. La prop avait été posée sur le premier
  // — celui qu'on ne voit qu'en l'absence d'abonnement —, donc la flèche
  // existait dans le code et nulle part à l'écran.
  //
  // Le décor a un abonnement : c'est l'annuaire qui se rend, et c'est là que
  // la question se pose. Sur le mur, le test d'à côté n'aurait rien prouvé.
  await monter(390);

  /**
   * **La destination a quitté l'écran et vit dans l'annonce.**
   *
   * Cette assertion lisait « More » écrit à côté de la flèche. Le mot répétait
   * sur chaque sous-page le nom du menu qu'on venait de quitter, là où la
   * flèche le dit déjà — à qui voit l'écran. À qui l'écoute, elle ne dit rien,
   * et c'est exactement ce que le libellé accessible porte maintenant.
   *
   * Ce qui est éprouvé reste le même défaut qu'à l'origine : la prop posée sur
   * le mur d'abonnement plutôt que sur l'annuaire, donc nommée dans le code et
   * nulle part à l'usage.
   */
  const retour = screen.getByTestId('retour');
  expect(retour.props.accessibilityLabel).toBe('More');
  expect(screen.queryByTestId('retour-vers')).toBeNull();
  expect(screen.queryByText('More')).toBeNull();
});
