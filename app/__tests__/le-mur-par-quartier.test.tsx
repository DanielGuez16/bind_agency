/**
 * Le fil v5 : des rangées par catégorie, et des cartes qu'on voit.
 *
 * **Ce fichier a suivi trois compositions.** Une grille de prestations, un mur
 * de salons par quartier, et maintenant des rangées horizontales. Ce qui
 * survit d'une à l'autre est la question : la prestation porte-t-elle le titre,
 * le salon l'attribution, et le compte dit-il ce qui est ouvert chez lui ?
 * C'est le seul acquis que la v5 ne rejoue pas, et c'est ce qu'on éprouve.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import type { FavorisDeLaCarte } from '../src/screens/mur/CarteDeSalon';
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

async function monter(
  fil: Fil = FIL,
  categorie: 'beauty' | null = null,
  favoris?: FavorisDeLaCarte,
) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => fil })) as never,
  });
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <SectionsParQuartier fil={fil} categorie={categorie} onOuvrir={() => {}} favoris={favoris} />
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
    // **Le quartier est dans la ligne du salon, et plus dans le compte.**
    // « 2 services open to you in Wynwood » disait deux choses d'un trait, dont
    // une déjà écrite juste au-dessus — et cela faisait lire le compte comme un
    // total du quartier. Les deux sens sont éprouvés : sans la seconde
    // assertion, remettre le quartier dans la phrase repasserait au vert.
    expect(screen.getByTestId('rangee-proches-apercu-b1-situation')).toHaveTextContent(
      new RegExp(en.quartiers.wynwood, 'i'),
    );
    expect(screen.getByTestId('rangee-proches-apercu-b1-compte')).not.toHaveTextContent(
      new RegExp(en.quartiers.wynwood, 'i'),
    );
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

  it('chaque palier dit sous quel délai il engage, pas seulement son nom', async () => {
    // **Le badge situe, la phrase informe** — c'est la brique elle-même qui
    // l'écrit, et ce mur était le seul écran à la rendre fausse. « POST » seul
    // ne dit ni le délai ni qu'il s'agit d'un engagement.
    //
    // **Deux paliers aux délais différents**, sans quoi une implémentation qui
    // écrirait un délai en dur rendrait le même verdict qu'une bonne : la
    // story engage sous 48 h, le reel sous 72 h.
    const vue = await monter({
      ...FIL,
      commerces: [
        commerce('b1', 'Vela Nail Studio', 'beauty', [
          item('o1', 'Gel manicure', 'story'),
          item('o2', 'Cover shoot', 'reel'),
        ]),
      ],
      categories: [{ categorie: 'beauty', commerces: 1, prestations: 2 }],
    } as unknown as Fil);
    await waitFor(() =>
      expect(screen.getByTestId('rangee-proches-apercu-b1-contrepartie-i-o1')).toBeTruthy(),
    );

    expect(screen.getByTestId('rangee-proches-apercu-b1-contrepartie-i-o1')).toHaveTextContent(
      /48/,
    );
    expect(screen.getByTestId('rangee-proches-apercu-b1-contrepartie-i-o2')).toHaveTextContent(
      /72/,
    );
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

  describe('et le mur porte un cœur, un par salon', () => {
    /**
     * **Renversement assumé, et documenté comme tel.** Cette description
     * décrivait le contraire jusqu'à ce jour — voir `CarteDeSalon.tsx` et
     * `DECISIONS.md`. Le favori reste sur la prestation ; le cœur du salon
     * n'en est que le raccourci qui les garde toutes d'un geste.
     */
    it('est plein seulement quand toutes les prestations du salon sont gardées', async () => {
      // **Le décor qui sépare les deux implémentations.** Vela a deux
      // prestations : une gardée, l'autre non. Une implémentation qui
      // remplirait le cœur dès qu'*une* est gardée rendrait le même verdict
      // qu'une bonne implémentation sur un salon à une seule prestation —
      // c'est pour ça que Wynwood Strength (une seule, gardée) ne suffit pas
      // seul à éprouver la règle.
      const favoris: FavorisDeLaCarte = {
        estFavori: (id) => id === 'i-o1' || id === 'i-o3',
        basculer: jest.fn(),
      };
      const vue = await monter(FIL, null, favoris);
      await waitFor(() =>
        expect(screen.getByTestId('rangee-proches-apercu-b1-coeur')).toBeTruthy(),
      );

      // Vela (b1) : gardée + non gardée → pas plein.
      expect(
        screen.getByTestId('rangee-proches-apercu-b1-coeur').props.accessibilityState.checked,
      ).toBe(false);
      // Wynwood Strength (b2) : sa seule prestation est gardée → plein.
      expect(
        screen.getByTestId('rangee-proches-apercu-b2-coeur').props.accessibilityState.checked,
      ).toBe(true);
      await vue.unmount();
    });

    it('ne rebascule pas ce qui l’est déjà : un salon mixte ne garde que ce qui manque', async () => {
      // **La divergence à éprouver.** Une implémentation qui rebasculerait
      // *chaque* prestation (un XOR par ligne) retirerait `i-o1`, déjà
      // gardée, en même temps qu'elle ajoute `i-o2` — ce test tombe sur cette
      // implémentation-là et passe sur celle qui ne touche que ce qui manque.
      const basculer = jest.fn();
      const favoris: FavorisDeLaCarte = {
        estFavori: (id) => id === 'i-o1',
        basculer,
      };
      const vue = await monter(FIL, null, favoris);
      await waitFor(() =>
        expect(screen.getByTestId('rangee-proches-apercu-b1-coeur')).toBeTruthy(),
      );

      await fireEvent.press(screen.getByTestId('rangee-proches-apercu-b1-coeur'));

      expect(basculer).toHaveBeenCalledTimes(1);
      expect(basculer).toHaveBeenCalledWith('i-o2', true, false, 'Classic pedicure');
      await vue.unmount();
    });

    it('un salon déjà entièrement gardé se retire d’un geste', async () => {
      // **`servi` vient de la donnée, pas du mock.** `est_favori` sur les deux
      // articles de Vela doit être vrai pour de bon : simuler « déjà gardées »
      // en forçant seulement `estFavori()` à répondre `true` laisserait
      // `servi` à sa valeur par défaut du décor — `false` — et `basculer`
      // recevrait alors une vérité serveur qu'aucune des deux implémentations
      // ne peut produire dans ce cas.
      const basculer = jest.fn();
      const favoris: FavorisDeLaCarte = {
        estFavori: (_id, servi) => servi,
        basculer,
      };
      const fil = {
        ...FIL,
        commerces: [
          commerce('b1', 'Vela Nail Studio', 'beauty', [
            { ...item('o1', 'Gel manicure'), est_favori: true },
            { ...item('o2', 'Classic pedicure'), est_favori: true },
          ]),
          commerce('b2', 'Wynwood Strength', 'fitness', [item('o3', 'Coaching', 'post')], {
            distance_metres: 1400,
          }),
        ],
      } as unknown as Fil;
      const vue = await monter(fil, null, favoris);
      await waitFor(() =>
        expect(screen.getByTestId('rangee-proches-apercu-b1-coeur')).toBeTruthy(),
      );

      await fireEvent.press(screen.getByTestId('rangee-proches-apercu-b1-coeur'));

      // Les deux prestations de Vela retirées, aucune autre touchée.
      expect(basculer).toHaveBeenCalledTimes(2);
      expect(basculer).toHaveBeenCalledWith('i-o1', false, true, 'Gel manicure');
      expect(basculer).toHaveBeenCalledWith('i-o2', false, true, 'Classic pedicure');
      await vue.unmount();
    });

    it('sans favoris fourni, lit l’état servi et ne bascule rien', async () => {
      // Le montage direct sans `favoris` — celui des écrans qui n'en ont pas
      // besoin — ne doit ni planter, ni prétendre qu'un appui a un effet.
      const vue = await monter();
      await waitFor(() =>
        expect(screen.getByTestId('rangee-proches-apercu-b1-coeur')).toBeTruthy(),
      );

      expect(
        screen.getByTestId('rangee-proches-apercu-b1-coeur').props.accessibilityState.checked,
      ).toBe(false);
      // Ne lève pas : un appui sans favoris fourni ne doit ni planter, ni
      // prétendre avoir un effet. L'absence d'exception est l'assertion.
      await fireEvent.press(screen.getByTestId('rangee-proches-apercu-b1-coeur'));
      await vue.unmount();
    });
  });
});

describe('un fil sans prestation ne rend pas un mur vide en silence', () => {
  it('il ne rend rien du tout, et l’écran montre son état vide ailleurs', async () => {
    const vue = await monter({ ...FIL, commerces: [], categories: [] } as unknown as Fil);

    expect(screen.queryByTestId('le-mur')).toBeNull();
    await vue.unmount();
  });
});
