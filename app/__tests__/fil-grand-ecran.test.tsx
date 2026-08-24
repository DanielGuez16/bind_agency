/**
 * Le fil créateur en grille, sur grand écran.
 *
 * `rules.md` §8 bornait le contenu créateur à 760 centré : c'est exactement la
 * colonne étroite perdue dans du vide relevée en campagne de test. La v0.6 le
 * porte à 1120 et met les cartes en grille de trois à quatre.
 *
 * **Le défilement horizontal reste la forme mobile.** Sur grand écran il cache
 * du contenu sans raison : on ne sait pas combien de salons attendent derrière
 * le bord, et on ne pense pas à pousser.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { FilScreen } from '../src/screens/FilScreen';
import { ThemeProvider } from '../src/theme';

// Préfixé `mock` : jest n'autorise que ces noms dans une fabrique de mock.
let mockLargeur = 1120;

jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  // `place` vient de la règle elle-même : la recopier ici ferait un
  // double qui dérive le jour où le seuil bouge.
  useGabarit: () => ({
    largeur: mockLargeur,
    large: true,
    place: (besoin: number) =>
      (require('../src/shell/placeDisponible') as typeof import('../src/shell/placeDisponible'))
        .placeDisponible(mockLargeur, besoin),
  }),
}));

function commerce(id: string) {
  return {
    business_id: id,
    name: `Salon ${id}`,
    category: 'beauty',
    address: '100 Ocean Dr',
    // Le quartier n'est plus décoratif : c'est lui qui range le mur. Un
    // montage qui l'omettrait rendrait un mur vide et ferait passer ce test
    // sur un écran sans contenu.
    neighborhood: 'wynwood',
    cover_photo_key: null,
    cover_portrait_key: null,
    distance_metres: 420,
    items: [
      {
        tier_offer_id: `o-${id}`,
        catalog_item_id: `i-${id}`,
        tier_id: 't1',
        social_account_id: 's1',
        name: 'Gel manicure',
        description: null,
        price_cents: 4500,
        currency: 'USD',
        duration_minutes: 45,
        requires_booking: true,
        photo_key: null,
        platform: 'instagram',
        content_format: 'story',
        value_ratio: null,
      },
    ],
  };
}

function monter(nombre: number) {
  const fil = {
    commerces: Array.from({ length: nombre }, (_, rang) => commerce(`b${rang}`)),
    obstacles: [],
    // Le type les déclare obligatoires et le serveur les rend toujours : un
    // montage qui les omet fabrique une réponse qui n'existe pas, et rendrait
    // le composant défensif contre un cas qu'aucun appel n'atteint.
    rayons: [],
    quartiers: [
      { quartier: 'wynwood', commerces: nombre, prestations: nombre, distance_metres: 420 },
    ],
    categories: [],
    total_prestations: nombre,
    prochain_palier: null,
  };
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => fil }) as Response,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onVoirMesFavoris={() => {}}
            onOuvrirLeCommerce={() => {}}
            onConnecterUnReseau={() => {}}
            onVoirMonAudience={() => {}}
            onVoirMesPaliers={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

/**
 * **Deux colonnes, à toutes les largeurs.**
 *
 * La v3 range le mur en grille de deux, et Design écrit pourquoi pas trois : à
 * trois, la colonne tombe à 111 points et « Brow lamination » passe sur trois
 * lignes. C'est un arbitrage sur la lisibilité d'un nom de prestation, pas sur
 * la place disponible — il ne se relâche donc pas parce que l'écran s'élargit.
 *
 * Le fichier a porté trois compositions successives : une grille de cartes de
 * trois à quatre, puis un mur de six formats, maintenant la grille de deux. Ce
 * qui survit d'une à l'autre est la question, et elle est bonne : est-ce que le
 * grand écran change la composition ? La réponse a toujours été non.
 */
describe('le mur garde ses deux colonnes sur grand écran', () => {
  it('rend les mêmes aperçus, dans le même ordre, quelle que soit la largeur', async () => {
    const vus: string[][] = [];
    const parRangee: number[][] = [];

    for (const largeur of [390, 1120, 1512]) {
      mockLargeur = largeur;
      const vue = await monter(5);
      await waitFor(() => expect(screen.getByTestId('le-mur')).toBeTruthy());

      vus.push(screen.getAllByTestId(/^apercu-o-b\d+$/).map((n) => String(n.props.testID)));

      // Le nombre d'aperçus par rangée, rangée par rangée. C'est la seule
      // mesure qui distingue « deux colonnes » de « autant que ça rentre » —
      // compter les aperçus de l'écran donnerait cinq dans les deux cas.
      //
      // **Compté sur les rangées rendues, et non sur les enfants d'un
      // conteneur.** Le mur est une liste virtualisée depuis qu'il montait
      // quatre-vingts images d'un coup : ses rangées sont posées une à une par
      // le défileur, et il n'y a plus de nœud dont elles soient les enfants.
      // Le décor tient en cinq prestations, donc tout est rendu.
      parRangee.push(
        screen
          .getAllByTestId('rangee-du-mur')
          .map(
            (rangee) =>
              (rangee.props.children as unknown[]).flat().filter(Boolean).length,
          ),
      );
      await vue.unmount();
    }

    // Cinq prestations : deux, deux, et une seule accompagnée de sa colonne
    // vide — c'est elle qui empêche le dernier aperçu de s'étaler.
    expect(vus[0]).toEqual(['apercu-o-b0', 'apercu-o-b1', 'apercu-o-b2', 'apercu-o-b3', 'apercu-o-b4']);
    expect(vus[1]).toEqual(vus[0]);
    expect(vus[2]).toEqual(vus[0]);
    expect(parRangee[0]).toEqual([2, 2, 2]);
    expect(parRangee[1]).toEqual(parRangee[0]);
    expect(parRangee[2]).toEqual(parRangee[0]);
  });
});


/**
 * Le mur ne monte plus tout ce qu'il a.
 *
 * **Ce que ça répare, et le chiffre qui l'a décidé.** La grille était un
 * `ScrollView` et un `.map` : un fil de vingt salons montait quatre-vingts
 * `Image` à la première image. Le poids du réseau a été réglé en servant la
 * vignette — 10,5 Mo devenus 0,8 — mais `Image` **décode avant de réduire**, et
 * le coût du décodage ne dépend pas du cadre où on pose la photo. C'était donc
 * le plafond suivant, et il ne se voyait pas dans les octets.
 *
 * **Le décor est ce qui sépare les deux implémentations.** Quarante salons font
 * vingt rangées ; en bloc elles sont toutes rendues, en liste seules celles que
 * le défileur juge utiles le sont. Avec cinq salons — le décor des autres tests
 * ici — les deux rendraient exactement la même chose, et le test ne dirait rien.
 */
describe('le mur ne monte plus tout ce qu’il a', () => {
  it('ne rend qu’une partie des rangées, et l’en-tête quand même', async () => {
    mockLargeur = 390;
    const vue = await monter(40);
    await waitFor(() => expect(screen.getByTestId('le-mur')).toBeTruthy());

    const rangees = screen.getAllByTestId('rangee-du-mur');

    // Vingt rangées existent, moins sont montées. La borne haute est ce qui
    // compte ; le nombre exact appartient au défileur et changerait avec ses
    // réglages, l'asséner ferait un test qui casse sans rien apprendre.
    expect(rangees.length).toBeGreaterThan(0);
    expect(rangees.length).toBeLessThan(20);

    // **Et l'en-tête est là.** Une liste qui virtualiserait aussi sa tête
    // ferait disparaître le nom du quartier et son compte — c'est-à-dire ce
    // qui dit où l'on est, au moment où l'écran s'ouvre.
    expect(screen.getByTestId('quartier-ouvert-nom')).toBeTruthy();
    await vue.unmount();
  });
});


/**
 * Le fil traverse la bascule de la position sans se démonter.
 *
 * **Le défaut que ce test épingle a existé, et il a coûté deux exécutions
 * d'intégration continue.** Le mur en liste a amené un crochet dans `FilScreen`,
 * posé *après* le retour anticipé « pas de position ». Il n'existait donc pas
 * tant qu'aucune position n'était accordée, puis apparaissait au premier
 * relevé : React voyait plus de crochets qu'au rendu précédent, levait, et
 * l'application entière disparaissait — barre d'onglets comprise, puisque rien
 * ne rattrape une erreur de rendu à cet endroit.
 *
 * **Aucun décor d'ici ne le traversait** : ils partent tous d'une position
 * accordée, et un composant dont les crochets sont mal ordonnés rend
 * parfaitement bien tant qu'on ne change pas de branche. C'est l'e2e qui l'a
 * dit, sur un écran qui ne montrait plus rien.
 */
describe('le fil traverse la bascule de la position', () => {
  it('passe de « pas de position » au mur sans lever', async () => {
    mockLargeur = 390;
    const fil = {
      commerces: [commerce('b1')],
      obstacles: [],
      rayons: [],
      quartiers: [
        { quartier: 'wynwood', commerces: 1, prestations: 1, distance_metres: 420 },
      ],
      categories: [],
      total_prestations: 1,
      prochain_palier: null,
    };
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => fil }) as Response,
    });
    const ecran = (position: { longitude: number; latitude: number } | null) => (
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={api}>
            <FilScreen
              position={position}
              onDemanderLaPosition={() => {}}
              onVoirMesFavoris={() => {}}
              onOuvrirLeCommerce={() => {}}
              onConnecterUnReseau={() => {}}
              onVoirMonAudience={() => {}}
              onVoirMesPaliers={() => {}}
            />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>
    );

    // Sans position d'abord : c'est l'état où l'application s'ouvre.
    const vue = await render(ecran(null));
    // Puis le relevé arrive, et la branche change.
    await vue.rerender(ecran({ longitude: -80.19, latitude: 25.76 }));

    await waitFor(() => expect(screen.getByTestId('le-mur')).toBeTruthy());
    await vue.unmount();
  });
});
