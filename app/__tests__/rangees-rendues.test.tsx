/**
 * Ce que le filtre change à l'écran : le mur devient des rangées.
 *
 * **Le mur reste le fil par défaut**, et les rangées sont ce que montre une
 * catégorie choisie. C'est l'arbitrage que Design a écrit au bas de la planche
 * « Fil v2 » : le mur répond à « je descends sans intention », les rangées à
 * « je cherche quelque chose près de chez moi » — et appuyer sur une catégorie
 * est exactement la seconde phrase.
 *
 * Ce qui est éprouvé ici est la **bascule** et les deux règles qui ne se voient
 * que rendues : la première carte est plus large que les suivantes, et la
 * prestation ne s'écrit que sur elle.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { FilScreen } from '../src/screens/FilScreen';
import { ThemeProvider } from '../src/theme';

function salon(id: string, quartier: string | null, metres: number) {
  return {
    business_id: id,
    name: `Salon ${id}`,
    category: 'beauty',
    address: null,
    cover_photo_key: null,
    cover_portrait_key: null,
    neighborhood: quartier,
    distance_metres: metres,
    items: [
      {
        tier_offer_id: `o${id}`,
        catalog_item_id: `i${id}`,
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

const FIL = {
  commerces: [
    salon('a', 'wynwood', 320),
    salon('b', 'wynwood', 900),
    salon('c', 'brickell', 4200),
  ],
  obstacles: [],
  rayon_metres: 15_000,
  total_prestations: 3,
  categories: [
    { categorie: 'beauty', commerces: 5, prestations: 9 },
    { categorie: 'fitness', commerces: 4, prestations: 6 },
  ],
  rayons: [],
  quartiers: [
    { quartier: 'wynwood', commerces: 2, prestations: 2, distance_metres: 320 },
    { quartier: 'brickell', commerces: 1, prestations: 1, distance_metres: 4200 },
  ],
  prochain_palier: null,
} as unknown as Fil;

async function monter(donnees: Fil = FIL) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => donnees }) as Response,
  });

  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onOuvrirLeCommerce={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

/** Choisit une catégorie, comme une créatrice le ferait. */
async function filtrer() {
  await waitFor(() => expect(screen.getByTestId('categorie-beauty')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('categorie-beauty'));
  await waitFor(() => expect(screen.getByTestId('rangees-par-quartier')).toBeTruthy());
}

describe('la bascule', () => {
  it('sans filtre, le fil est le mur', async () => {
    await monter();
    await waitFor(() => expect(screen.getByTestId('le-mur')).toBeTruthy());

    expect(screen.queryByTestId('rangees-par-quartier')).toBeNull();
  });

  it('une catégorie choisie, ce sont les rangées', async () => {
    await monter();
    await filtrer();

    expect(screen.queryByTestId('le-mur')).toBeNull();
    expect(screen.getByTestId('rangee-wynwood')).toBeTruthy();
    expect(screen.getByTestId('rangee-brickell')).toBeTruthy();
  });

  it('et retirer le filtre ramène le mur', async () => {
    // Le sens inverse : une bascule qui ne revient pas est un cul-de-sac, et
    // le mur est le fil par défaut, pas un état de départ qu'on quitte.
    await monter();
    await filtrer();

    await fireEvent.press(screen.getByTestId('categorie-beauty'));
    await waitFor(() => expect(screen.getByTestId('le-mur')).toBeTruthy());
    expect(screen.queryByTestId('rangees-par-quartier')).toBeNull();
  });
});

describe('l’inégalité des cartes est le rythme de la rangée', () => {
  it('la première est plus large que les suivantes', async () => {
    // Ce n'est pas une hiérarchie de mérite : c'est le salon le plus proche du
    // quartier, et rien d'autre ne le désigne.
    await monter();
    await filtrer();

    const premiere = screen.getByTestId('salon-a').props.style;
    const suivante = screen.getByTestId('salon-b').props.style;
    expect(premiere.width).toBeGreaterThan(suivante.width);
  });

  it('et la prestation ne s’écrit que sur elle', async () => {
    // La même règle que le mur : le texte suit la largeur, pas la hauteur. À
    // 150 points, un nom et une prestation deviennent illisibles ensemble
    // plutôt que l'un des deux utile.
    await monter();
    await filtrer();

    expect(screen.getByTestId('salon-a-prestation')).toBeTruthy();
    expect(screen.queryByTestId('salon-b-prestation')).toBeNull();
    // Le nom, lui, reste sur les deux : une carte sans nom ne se choisit pas.
    expect(screen.getByTestId('salon-b-nom')).toBeTruthy();
  });

  it('une rangée courte se ferme sur ce qu’il y a plus loin', async () => {
    await monter();
    await filtrer();

    // Wynwood tient deux salons, donc rien ne dépasse : la carte d'os dit
    // Brickell, sa distance, et ce qu'on y trouve.
    const apercu = screen.getByTestId('apercu-de-la-suite');
    expect(apercu).toHaveTextContent(/BRICKELL/i);
    expect(apercu).toHaveTextContent(/4[.,]2/);
  });
});
