/**
 * Le mur rangé par quartier : ce qu'il montre, et ce qui s'ouvre.
 *
 * **Ce que ces tests protègent n'est pas une mise en page, c'est la réponse à
 * « qu'est-ce que je réserve ».** L'unité rendue est la prestation : un salon
 * qui en ouvre trois occupe trois aperçus. C'est la conséquence directe de
 * l'inversion de hiérarchie, et c'est ce qui se perdrait en premier si
 * quelqu'un « optimisait » en rendant un aperçu par salon.
 *
 * **Le quartier structure, il ne navigue pas.** Le plus proche est ouvert, les
 * autres sont des carrés au pied ; appuyer sur un carré ouvre sa section et
 * referme la précédente. Empiler une troisième bande au-dessus du contenu était
 * le défaut signalé, et rien ici ne doit y ramener.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { SectionsParQuartier } from '../src/screens/mur/SectionsParQuartier';
import { ThemeProvider } from '../src/theme';

function item(id: string, nom: string, duree: number | null, format: string) {
  return {
    tier_offer_id: id,
    catalog_item_id: `i-${id}`,
    tier_id: 't1',
    social_account_id: 's1',
    name: nom,
    description: null,
    price_cents: 4500,
    currency: 'USD',
    duration_minutes: duree,
    requires_booking: true,
    photo_key: null,
    platform: 'instagram',
    content_format: format,
    value_ratio: null,
  };
}

function commerce(id: string, nom: string, quartier: string, items: unknown[]) {
  return {
    business_id: id,
    name: nom,
    category: 'beauty',
    address: '100 Ocean Dr',
    neighborhood: quartier,
    cover_photo_key: null,
    cover_portrait_key: null,
    distance_metres: 420,
    items,
  };
}

/**
 * **Deux quartiers, et le premier porte deux salons dont un à deux
 * prestations.** Un montage à un seul quartier ferait passer le test des
 * carrés sans qu'aucun carré existe ; un salon à une seule prestation ferait
 * passer « l'unité est la prestation » sans jamais l'éprouver — un aperçu par
 * salon et un aperçu par prestation rendraient alors le même écran.
 */
const FIL = {
  commerces: [
    commerce('b1', 'Vela Nail Studio', 'wynwood', [
      item('o1', 'Gel manicure', 45, 'story'),
      item('o2', 'Classic pedicure', 50, 'story'),
    ]),
    commerce('b2', 'Casa Bruma Spa', 'wynwood', [item('o3', 'Signature facial', 60, 'post')]),
    commerce('b3', 'Aurora Brow Bar', 'brickell', [item('o4', 'Brow lamination', 40, 'reel')]),
  ],
  obstacles: [],
  rayon_metres: 15_000,
  total_prestations: 4,
  rayons: [],
  categories: [],
  quartiers: [
    { quartier: 'wynwood', commerces: 2, prestations: 3, distance_metres: 320 },
    { quartier: 'brickell', commerces: 1, prestations: 1, distance_metres: 4100 },
  ],
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

describe('le quartier le plus proche est ouvert', () => {
  it('et c’est le premier que le serveur rend, jamais un tri refait ici', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('quartier-ouvert-nom')).toBeTruthy());

    expect(screen.getByTestId('quartier-ouvert-nom')).toHaveTextContent(en.quartiers.wynwood);
    // Le compte vient du serveur et non d'un décompte des aperçus : les deux
    // valent trois ici, et c'est voulu — mais le serveur compte sur le rayon
    // entier, pas sur ce qui est rendu.
    // Expression régulière et non chaîne : `toHaveTextContent` compare le
    // contenu **entier** quand on lui donne une chaîne. Passer « 3 » aurait
    // exigé que la ligne ne dise que « 3 ».
    expect(screen.getByTestId('quartier-ouvert-compte')).toHaveTextContent(/\b3\b/);
    await vue.unmount();
  });

  it('l’unité rendue est la prestation, pas le salon', async () => {
    // **Le montage est celui qui sépare les deux implémentations.** Vela ouvre
    // deux prestations : un mur qui rendrait un aperçu par salon en montrerait
    // deux au lieu de trois, et porterait « Vela Nail Studio » en titre au lieu
    // de « Gel manicure ». C'est l'inversion que la revue signale.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('apercu-o1')).toBeTruthy());

    expect(screen.getByTestId('apercu-o1-nom')).toHaveTextContent('Gel manicure');
    expect(screen.getByTestId('apercu-o2-nom')).toHaveTextContent('Classic pedicure');
    expect(screen.getByTestId('apercu-o3-nom')).toHaveTextContent('Signature facial');
    // Le salon est en attribution sur les deux prestations qu'il ouvre.
    expect(screen.getByTestId('apercu-o1-attribution')).toHaveTextContent(/Vela Nail Studio/);
    expect(screen.getByTestId('apercu-o2-attribution')).toHaveTextContent(/Vela Nail Studio/);
    // Et rien du quartier voisin n'est rendu tant qu'il n'est pas ouvert.
    expect(screen.queryByTestId('apercu-o4')).toBeNull();
    await vue.unmount();
  });

  it('la rangée impaire garde sa colonne vide', async () => {
    // Trois prestations : la seconde rangée n'en porte qu'une. Sans la colonne
    // vide, ce dernier aperçu s'étale sur toute la largeur et son image double
    // de hauteur — une mise en avant que personne n'a décidée.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('apercu-o3')).toBeTruthy());

    expect(screen.getAllByTestId('colonne-vide')).toHaveLength(1);
    await vue.unmount();
  });
});

describe('les autres quartiers sont des carrés, et ils s’ouvrent', () => {
  it('le carré porte le nom et le compte du quartier fermé', async () => {
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('carre-brickell')).toBeTruthy());

    expect(screen.getByTestId('carre-brickell')).toHaveTextContent(
      new RegExp(en.quartiers.brickell),
    );
    expect(screen.getByTestId('carre-brickell-compte')).toHaveTextContent(/\b1\b/);
    // Le quartier ouvert n'est pas aussi un carré : il serait alors dans les
    // deux états à la fois, et l'appuyer ne ferait rien de visible.
    expect(screen.queryByTestId('carre-wynwood')).toBeNull();
    await vue.unmount();
  });

  it('appuyer sur un carré ouvre sa section et referme la précédente', async () => {
    // **C'est tout le mécanisme, et les deux moitiés comptent.** Ouvrir sans
    // refermer laisserait deux sections déroulées, c'est-à-dire la liste à plat
    // que le découpage existe pour éviter.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('carre-brickell')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('carre-brickell'));

    await waitFor(() =>
      expect(screen.getByTestId('quartier-ouvert-nom')).toHaveTextContent(en.quartiers.brickell),
    );
    expect(screen.getByTestId('apercu-o4-nom')).toHaveTextContent('Brow lamination');
    // Wynwood est refermé : il n'a plus d'aperçus, et il est devenu un carré.
    expect(screen.queryByTestId('apercu-o1')).toBeNull();
    expect(screen.getByTestId('carre-wynwood')).toBeTruthy();
    expect(screen.queryByTestId('carre-brickell')).toBeNull();
    await vue.unmount();
  });
});

describe('le compte de la section nomme la catégorie quand il y en a une', () => {
  it('sans filtre, la phrase générale ; avec, la catégorie', async () => {
    // Deux clés et non une phrase à trous : l'espagnol n'ordonne pas la
    // catégorie et le nom commun comme l'anglais. Le test lit les deux phrases
    // du fichier de langue plutôt que de les réécrire — les recopier ici ferait
    // passer le test le jour où l'une change sans l'autre.
    const sans = await monter(FIL, null);
    await waitFor(() => expect(screen.getByTestId('quartier-ouvert-compte')).toBeTruthy());
    expect(screen.getByTestId('quartier-ouvert-compte')).toHaveTextContent(
      en.parcours.murServicesOuverts.replace('{{count}}', '3'),
    );
    // Et pas l'autre phrase : sans cette moitié, un composant qui rendrait
    // toujours la forme catégorisée passerait le premier cas dès que le libellé
    // de la catégorie serait vide.
    expect(screen.getByTestId('quartier-ouvert-compte')).not.toHaveTextContent(
      new RegExp(en.categories.beauty),
    );
    await sans.unmount();

    const avec = await monter(FIL, 'beauty');
    await waitFor(() => expect(screen.getByTestId('quartier-ouvert-compte')).toBeTruthy());
    expect(screen.getByTestId('quartier-ouvert-compte')).toHaveTextContent(
      en.parcours.murServicesDeCategorie
        .replace('{{count}}', '3')
        .replace('{{categorie}}', en.categories.beauty),
    );
    await avec.unmount();
  });
});

describe('un fil sans quartier ne rend pas un mur vide en silence', () => {
  it('il ne rend rien du tout, et l’écran montre son état vide ailleurs', async () => {
    // **Le cas que tous les anciens montages fabriquaient.** Ils déclaraient
    // `quartiers: []` en commentant que le serveur les rend toujours — vrai de
    // la clé, faux du contenu. Le mur ne peut alors rien ranger. Ce qu'on
    // vérifie ici est qu'il se tait plutôt que de rendre une section sans nom.
    const vue = await monter({ ...FIL, quartiers: [] } as unknown as Fil);

    expect(screen.queryByTestId('le-mur')).toBeNull();
    expect(screen.queryByTestId('quartier-ouvert-nom')).toBeNull();
    await vue.unmount();
  });
});

/**
 * Ce que le mur tire réellement du réseau.
 *
 * **Le mur demandait l'original, et c'était l'essentiel de sa lenteur.** Ses
 * trois cadres font 100, 52 et 44 points ; l'original est borné à 2000 pixels.
 * Mesuré sur un fil de vingt salons — quatre-vingts images, et la grille ne
 * virtualise pas : 10,5 Mo de photographies déjà réduites, 52 Mo de photos
 * sorties d'un téléphone, contre 50 Ko pour le JSON qui les nomme.
 *
 * **Le décor porte des clés distinctes par cadre.** Sans cela, un mur qui
 * demanderait la vignette pour l'aperçu et l'original pour l'en-tête passerait
 * la moitié du test sans qu'on le voie — et c'est précisément l'état d'avant,
 * où une seule des trois images était réglée.
 */
const CLE_PRESTATION = 'photos/aaaa1111';
const CLE_COUVERTURE = 'photos/bbbb2222';

const FIL_AVEC_PHOTOS = {
  ...FIL,
  commerces: [
    {
      ...commerce('b1', 'Vela Nail Studio', 'wynwood', [
        { ...item('o1', 'Gel manicure', 45, 'story'), photo_key: CLE_PRESTATION },
      ]),
      cover_photo_key: CLE_COUVERTURE,
    },
    FIL.commerces[2],
  ],
  quartiers: [
    { quartier: 'wynwood', commerces: 1, prestations: 1, distance_metres: 320 },
    { quartier: 'brickell', commerces: 1, prestations: 1, distance_metres: 4100 },
  ],
} as unknown as Fil;

describe('le mur ne tire jamais un original', () => {
  it('demande la vignette pour la photo d’une prestation', async () => {
    const vue = await monter(FIL_AVEC_PHOTOS);
    await waitFor(() => expect(screen.getByTestId('apercu-o1-photo')).toBeTruthy());

    const uri = String(screen.getByTestId('apercu-o1-photo').props.source.uri);
    expect(uri).toContain(CLE_PRESTATION);
    // **L'assertion qui sépare les deux implémentations.** `toContain(cle)`
    // seule passerait avec l'original, puisque les deux URL portent la clé :
    // c'est le suffixe qui dit laquelle des deux dérivées part sur le réseau.
    expect(uri).toContain('@vignette');
    await vue.unmount();
  });

  it('et pour la couverture qui illustre le quartier ouvert', async () => {
    const vue = await monter(FIL_AVEC_PHOTOS);
    await waitFor(() => expect(screen.getByTestId('quartier-ouvert')).toBeTruthy());

    const uri = String(screen.getByTestId('quartier-ouvert-photo').props.source.uri);

    expect(uri).toContain(CLE_COUVERTURE);
    expect(uri).toContain('@vignette');
    await vue.unmount();
  });
});
