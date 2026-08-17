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
  useGabarit: () => ({ largeur: mockLargeur, large: true }),
}));

function commerce(id: string) {
  return {
    business_id: id,
    name: `Salon ${id}`,
    category: 'beauty',
    address: '100 Ocean Dr',
    cover_photo_key: null,
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
    quartiers: [],
    categories: [],
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
 * **La grille de cartes n'existe plus.** Le fil est devenu le mur : six
 * positions dans un ordre fixe, un salon qui occupe l'écran, et plus aucune
 * rangée à compléter. Les quatre tests qui vivaient ici décrivaient une
 * composition retirée — ils ne sont pas « à mettre à jour », ils n'ont plus
 * d'objet, et les garder en les tordant aurait fait croire que la grille tient
 * encore quelque part.
 *
 * Ce qui les remplace : `le-cycle-du-mur` pour le placement, `les-regles-du-mur`
 * pour les trois arbitrages, et le bloc ci-dessous pour ce que le grand écran
 * change — c'est-à-dire rien. Le mur est vertical par construction : il ne se
 * réorganise pas en colonnes, et c'est une propriété qui mérite d'être tenue.
 */
describe('le mur ne devient pas une grille sur grand écran', () => {
  it('rend les mêmes blocs, dans le même ordre, quelle que soit la largeur', async () => {
    // Un mur qui passerait en trois colonnes au-delà d'un seuil redeviendrait
    // un catalogue — ce que le cycle existe pour éviter.
    const vus: string[][] = [];
    for (const largeur of [390, 1120, 1512]) {
      mockLargeur = largeur;
      const vue = await monter(8);
      await waitFor(() => expect(screen.getByTestId('le-mur')).toBeTruthy());
      vus.push(
        screen
          .getAllByTestId(/^bloc-\d+-/)
          .map((noeud) => String(noeud.props.testID).replace(/^bloc-\d+-/, '')),
      );
      await vue.unmount();
    }

    expect(vus[0]).toEqual(['heros', 'duo', 'bande', 'herosGalerie', 'triptyque']);
    expect(vus[1]).toEqual(vus[0]);
    expect(vus[2]).toEqual(vus[0]);
  });
});
