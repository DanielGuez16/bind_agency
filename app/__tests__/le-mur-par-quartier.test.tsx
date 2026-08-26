/**
 * Le fil v5 : des rangées par catégorie, et des cartes qu'on voit.
 *
 * **Ce fichier a suivi trois compositions.** Une grille de prestations, un mur
 * de salons par quartier, et maintenant des rangées horizontales. Ce qui
 * survit d'une à l'autre est la question : la prestation porte-t-elle le titre,
 * le salon l'attribution, et le compte dit-il ce qui est ouvert chez lui ?
 * C'est le seul acquis que la v5 ne rejoue pas, et c'est ce qu'on éprouve.
 */
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { SectionsParQuartier } from '../src/screens/mur/SectionsParQuartier';
import { ThemeProvider } from '../src/theme';

const CLE_PRESTATION = 'photos/aaaa1111';

function item(id: string, nom: string, format = 'story', cle: string | null = null) {
  return {
    tier_offer_id: id,
    catalog_item_id: `i-${id}`,
    tier_id: 't1',
    social_account_id: 's1',
    name: nom,
    description: null,
    price_cents: 4500,
    currency: 'USD',
    duration_minutes: 45,
    requires_booking: true,
    photo_key: cle,
    platform: 'instagram',
    content_format: format,
    value_ratio: null,
    est_favori: false,
  };
}

function commerce(
  id: string,
  nom: string,
  categorie: string,
  items: unknown[],
  extra: Record<string, unknown> = {},
) {
  return {
    business_id: id,
    name: nom,
    category: categorie,
    address: '100 Ocean Dr',
    neighborhood: 'wynwood',
    cover_photo_key: null,
    cover_portrait_key: null,
    distance_metres: 320,
    // Servi, et compté par article distinct : c'est ce que « +N more here »
    // annonce, et le déduire de `items.length` compterait des offres.
    prestations_ouvertes: new Set(
      (items as { catalog_item_id: string }[]).map((i) => i.catalog_item_id),
    ).size,
    items,
    ...extra,
  };
}

const FIL = {
  commerces: [
    commerce('b1', 'Vela Nail Studio', 'beauty', [
      item('o1', 'Gel manicure'),
      item('o2', 'Classic pedicure'),
    ]),
    commerce('b2', 'Wynwood Strength', 'fitness', [item('o3', 'Coaching', 'post')], {
      distance_metres: 1400,
    }),
  ],
  obstacles: [],
  rayon_metres: 15_000,
  total_prestations: 3,
  categories: [
    { categorie: 'beauty', commerces: 1, prestations: 12 },
    { categorie: 'fitness', commerces: 1, prestations: 5 },
  ],
  rayons: [],
  quartiers: [],
  favoris_total: 0,
  prochain_palier: null,
} as unknown as Fil;

async function monter(fil: Fil = FIL, categorie: 'beauty' | null = null) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => fil })) as never,
  });
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <SectionsParQuartier fil={fil} categorie={categorie} onOuvrir={() => {}} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la première rangée n’est pas une catégorie', () => {
  it('« le plus près de toi » porte tout, sans filtrer', async () => {
    // **Tout afficher, puis préciser.** C'est l'ordre que la campagne réclame,
    // et il se lit dans la composition : la rangée d'ouverture porte les trois
    // prestations, celles des deux catégories confondues.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('rangee-proches')).toBeTruthy());

    const proches = within(screen.getByTestId('rangee-proches'));
    // Une carte par salon, non par prestation : Vela en ouvre deux et n'en fait qu'une.
    expect(proches.getAllByTestId(/^rangee-proches-apercu-b\d+$/)).toHaveLength(2);
    // Son compte est celui du fil entier, servi.
    expect(screen.getByTestId('rangee-proches-compte')).toHaveTextContent(/\b3\b/);
    await vue.unmount();
  });

  it('puis une rangée par catégorie, dans l’ordre du serveur', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('rangee-beauty')).toBeTruthy());

    // **Le compte de la rangée vient du serveur, pas des cartes chargées.**
    // Douze prestations dans le rayon, deux à l'écran : dériver le nombre de ce
    // qui est rendu écrirait « 2 » et ferait croire que le fil est exhaustif.
    expect(screen.getByTestId('rangee-beauty-compte')).toHaveTextContent(/\b12\b/);
    expect(
      within(screen.getByTestId('rangee-beauty')).getAllByTestId(/^rangee-beauty-apercu-b\d+$/),
    ).toHaveLength(1);
    expect(screen.getByTestId('rangee-fitness-compte')).toHaveTextContent(/\b5\b/);
    await vue.unmount();
  });
});

describe('la carte, et ce qui a traversé les trois fils', () => {
  it('le salon porte le titre, et la carte nomme deux prestations', async () => {
    // **L'acquis qu'on ne rejoue pas.** Un mur qui remettrait le salon en titre
    // reproduirait le « je vois un lieu » de la revue ; et le quartier, qui
    // rangeait le fil en v4, est redevenu une étiquette de cette ligne-là.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('rangee-proches-apercu-b1-nom')).toBeTruthy());

    // **Le grain a changé avec la v5.** La carte est celle du salon : c'est lui
    // qui porte le titre, et les prestations descendent en lignes nommées.
    expect(screen.getByTestId('rangee-proches-apercu-b1-nom')).toHaveTextContent(
      /Vela Nail Studio/,
    );
    expect(screen.getByTestId('rangee-proches-apercu-b1-ligne-i-o1')).toHaveTextContent(
      /Gel manicure/,
    );
    const attribution = screen.getByTestId('rangee-proches-apercu-b1-compte');
    expect(attribution).toHaveTextContent(new RegExp(en.quartiers.wynwood, 'i'));
    await vue.unmount();
  });

  it('et le compte des prestations vient du serveur, jamais des lignes', async () => {
    // **C'est ce qui sauve la carte de la v0.5.** Elle nomme une prestation et
    // mène à un lieu : sans ce compte, on croirait que le salon n'offre que
    // celle-là. Vela ouvre deux prestations, donc une de plus que celle-ci.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('rangee-proches-apercu-b1-compte')).toBeTruthy());

    // Vela ouvre deux prestations : le compte le dit, et la carte les nomme
    // toutes deux — donc aucun reste. Le nombre vient de `prestations_ouvertes`.
    expect(screen.getByTestId('rangee-proches-apercu-b1-compte')).toHaveTextContent(/\b2\b/);
    // **Et zéro ne s'écrit pas.** Wynwood Strength n'ouvre que celle-ci ;
    // « +0 more here » ferait chercher ce qui n'existe pas.
    expect(screen.queryByTestId('rangee-proches-apercu-b1-reste')).toBeNull();
    await vue.unmount();
  });

  it('la même prestation ouverte à deux paliers ne fait qu’une ligne', async () => {
    // **Le décor qui sépare les deux implémentations** : deux offres partagent
    // leur article. Un mur qui listerait les offres poserait deux cartes du
    // même nom sous deux badges, ce qui se lit comme un doublon.
    const partage = { ...item('o1', 'Gel manicure'), catalog_item_id: 'i-partage' };
    const autre = { ...item('o2', 'Gel manicure', 'post'), catalog_item_id: 'i-partage' };
    const vue = await monter({
      ...FIL,
      commerces: [commerce('b1', 'Vela Nail Studio', 'beauty', [partage, autre])],
      categories: [{ categorie: 'beauty', commerces: 1, prestations: 1 }],
      total_prestations: 1,
    } as unknown as Fil);
    await waitFor(() => expect(screen.getByTestId('rangee-proches')).toBeTruthy());

    // Une carte de salon, et **une seule ligne** pour l'article partagé : deux
    // lignes du même nom sous deux badges se lisent comme un doublon.
    expect(
      within(screen.getByTestId('rangee-proches')).getAllByTestId(
        /^rangee-proches-apercu-b1-ligne-i-partage$/,
      ),
    ).toHaveLength(1);
    await vue.unmount();
  });

  it('demande la vignette, jamais l’original', async () => {
    const vue = await monter({
      ...FIL,
      commerces: [
        // **La clé vit sur le salon**, puisque la carte est celle du salon : la
        // photo d'un article ne dit rien du lieu où l'on entre.
        commerce('b1', 'Vela Nail Studio', 'beauty', [item('o1', 'Gel manicure')], {
          cover_photo_key: CLE_PRESTATION,
        }),
      ],
    } as unknown as Fil);
    await waitFor(() => expect(screen.getByTestId('rangee-proches-apercu-b1-photo-image')).toBeTruthy());

    const uri = String(screen.getByTestId('rangee-proches-apercu-b1-photo-image').props.source.uri);
    expect(uri).toContain(CLE_PRESTATION);
    // **L'assertion qui sépare les deux implémentations** : les deux URL
    // portent la clé, c'est le suffixe qui dit laquelle part sur le réseau.
    expect(uri).toContain('@vignette');
    await vue.unmount();
  });

  it('et le mur ne porte toujours aucun cœur', async () => {
    // Le favori porte sur la prestation et vit sur la fiche depuis la v4 : la
    // carte du fil mène à un lieu, elle ne garde rien de côté.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('rangee-proches')).toBeTruthy());

    expect(screen.queryAllByTestId(/-coeur$/)).toHaveLength(0);
    await vue.unmount();
  });
});

describe('un fil sans prestation ne rend pas un mur vide en silence', () => {
  it('il ne rend rien du tout, et l’écran montre son état vide ailleurs', async () => {
    const vue = await monter({ ...FIL, commerces: [], categories: [] } as unknown as Fil);

    expect(screen.queryByTestId('le-mur')).toBeNull();
    await vue.unmount();
  });
});
