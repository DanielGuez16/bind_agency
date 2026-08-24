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

function item(id: string, nom: string, duree: number | null, format: string, estFavori = false) {
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
    // **Servi, et non omis.** Absent, l'état du cœur arrive `undefined` chez
    // le geste, et le compte de la porte ne saurait plus dire si l'appui
    // ajoute ou rétablit. Le serveur le rend toujours ; le décor aussi.
    est_favori: estFavori,
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
    // **Servi, et compté comme le serveur le compte** : par article distinct,
    // jamais par offre. Le poser à `items.length` dans le décor referait ici la
    // faute que la route a corrigée, et le test la validerait.
    prestations_ouvertes: new Set(
      (items as { catalog_item_id: string }[]).map((item) => item.catalog_item_id),
    ).size,
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

  it('l’unité rendue est le salon, et la carte montre ce qu’il contient', async () => {
    // **Le montage est celui qui sépare les deux implémentations.** Vela ouvre
    // deux prestations : un mur resté au grain d'avant poserait trois cartes
    // pour deux salons, et « Gel manicure » y serait un titre au lieu d'une
    // ligne. C'est l'inversion que la v4 défait — un salon apparaissait autant
    // de fois qu'il avait de prestations ouvertes.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('salon-b1')).toBeTruthy());

    expect(screen.getAllByTestId('carte-du-mur')).toHaveLength(2);
    expect(screen.getByTestId('salon-b1-nom')).toHaveTextContent(/Vela Nail Studio/);
    // **Et la carte nomme son contenu.** Sans ces deux lignes, elle se lirait
    // comme une seule chose — l'ambiguïté que l'inversion avait fermée, et
    // qu'une phrase de plus ne referme pas.
    expect(screen.getByTestId('salon-b1-ligne-i-o1')).toHaveTextContent(/Gel manicure/);
    expect(screen.getByTestId('salon-b1-ligne-i-o2')).toHaveTextContent(/Classic pedicure/);
    expect(screen.getByTestId('salon-b2-nom')).toHaveTextContent(/Casa Bruma Spa/);
    // Et rien du quartier voisin n'est rendu tant qu'il n'est pas ouvert.
    expect(screen.queryByTestId('salon-b3')).toBeNull();
    await vue.unmount();
  });

  it('la même prestation ouverte à deux paliers ne fait qu’une ligne', async () => {
    // **Le décor qui sépare les deux implémentations, et il manquait.** Sans
    // lui, une carte qui ne dédoublonne pas rend exactement la même chose :
    // tous les décors du fichier donnent un article par offre. Ici, deux
    // offres partagent leur article — un mur qui listerait les offres écrirait
    // « Gel manicure » deux fois, sous deux badges, et compterait deux
    // services là où le serveur en compte un.
    const deuxPaliers = {
      ...commerce('b1', 'Vela Nail Studio', 'wynwood', [
        { ...item('o1', 'Gel manicure', 45, 'story'), catalog_item_id: 'i-partage' },
        { ...item('o2', 'Gel manicure', 45, 'post'), catalog_item_id: 'i-partage' },
      ]),
    };
    const vue = await monter({
      ...FIL,
      commerces: [deuxPaliers],
      quartiers: [{ quartier: 'wynwood', commerces: 1, prestations: 1, distance_metres: 320 }],
    } as unknown as Fil);
    await waitFor(() => expect(screen.getByTestId('salon-b1')).toBeTruthy());

    expect(screen.getByTestId('salon-b1-compte')).toHaveTextContent(/\b1\b/);
    expect(screen.getAllByTestId(/^salon-b1-ligne-/)).toHaveLength(1);
    await vue.unmount();
  });

  it('elle compte ce qu’elle montre, et annonce ce qu’elle cache', async () => {
    // Vela ouvre deux prestations : tout est nommé, rien à annoncer. Le
    // décompte du reste n'apparaît qu'au-delà de deux — écrire « and 0 more »
    // ferait chercher ce qui n'est pas caché.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('salon-b1')).toBeTruthy());

    expect(screen.getByTestId('salon-b1-compte')).toHaveTextContent(/\b2\b/);
    expect(screen.queryByTestId('salon-b1-reste')).toBeNull();
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
    expect(screen.getByTestId('salon-b3-nom')).toHaveTextContent(/Aurora Brow Bar/);
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
      en.parcours.murServicesOuverts
        .replace('{{salons}}', '2')
        .replace('{{count}}', '3')
        .replace('{{quartier}}', en.quartiers.wynwood),
    );
    // **Et la phrase nomme le quartier, quoi qu'elle dise par ailleurs.** Le
    // test du dessus recopie le gabarit : il passerait le jour où celui-ci
    // perdrait `{{quartier}}`, ce qui est exactement le défaut signalé — un
    // testeur a lu « 3 services open to you » comme un total de ville. Vérifié
    // par mutation : sans cette ligne, retirer le quartier du gabarit ne
    // faisait rien tomber.
    expect(screen.getByTestId('quartier-ouvert-compte')).toHaveTextContent(
      new RegExp(en.quartiers.wynwood),
    );
    expect(screen.getByTestId('quartier-ouvert-compte')).toHaveTextContent(/\b2\b/);
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
        .replace('{{salons}}', '2')
        .replace('{{count}}', '3')
        .replace('{{categorie}}', en.categories.beauty)
        .replace('{{quartier}}', en.quartiers.wynwood),
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
  it('demande la vignette pour la couverture d’une carte de salon', async () => {
    // **La carte montre le lieu, plus la prestation.** Le grain a changé en
    // v4 : la couverture du salon remplace la photo de la première prestation,
    // parce que la carte contient maintenant plusieurs prestations et qu'en
    // illustrer une seule mettrait en avant celle que personne n'a choisie.
    const vue = await monter(FIL_AVEC_PHOTOS);
    // Le composant `Photo` porte le cadre, et son `Image` le suffixe `-image` :
    // c'est celle-là qui tient l'adresse réellement demandée.
    await waitFor(() => expect(screen.getByTestId('salon-b1-photo-image')).toBeTruthy());

    const uri = String(screen.getByTestId('salon-b1-photo-image').props.source.uri);
    expect(uri).toContain(CLE_COUVERTURE);
    // **L'assertion qui sépare les deux implémentations.** `toContain(cle)`
    // seule passerait avec l'original, puisque les deux URL portent la clé :
    // c'est le suffixe qui dit laquelle des deux dérivées part sur le réseau.
    expect(uri).toContain('@vignette');
    await vue.unmount();
  });

  it('et pour la couverture qui illustre le quartier ouvert', async () => {
    const vue = await monter(FIL_AVEC_PHOTOS);
    await waitFor(() => expect(screen.getByTestId('quartier-ouvert')).toBeTruthy());

    // **Le testID nomme la zone, l'image porte le suffixe.** `Photo` réserve
    // la place avant que la photo arrive : le nœud extérieur est l'aplat qui
    // tient la hauteur, et c'est celui-là qu'on garde quand il n'y a rien.
    const uri = String(screen.getByTestId('quartier-ouvert-photo-image').props.source.uri);

    expect(uri).toContain(CLE_COUVERTURE);
    expect(uri).toContain('@vignette');
    await vue.unmount();
  });
});

/**
 * **Les deux rendus du mur offrent les mêmes gestes.**
 *
 * Le mur existe en deux formes : une liste virtualisée, montée par `FilScreen`,
 * et ce bloc, qui partage le même crochet. Le bloc ne recevait pas le
 * branchement des favoris — donc pas de cœur du tout, puisqu'un cœur sans
 * branchement ne se rend pas. Un second rendu amputé du premier est une
 * version que personne ne regarde et que personne ne teste.
 */
describe('le mur ne porte plus de cœur', () => {
  it('aucune carte de salon n’en rend un', async () => {
    // **Le cœur a quitté le fil en v4.** Une carte de salon contient plusieurs
    // prestations : un cœur y désignerait quoi ? Le favori porte sur la
    // prestation, donc il vit sur la fiche, ligne par ligne — et le seul cœur
    // du fil est la porte de la barre de recherche, qui porte le compte.
    const vue = await monter();
    await waitFor(() => expect(screen.getByTestId('salon-b1')).toBeTruthy());

    expect(screen.queryAllByTestId(/-coeur$/)).toHaveLength(0);
    await vue.unmount();
  });
});

/**
 * « Ailleurs à Miami », en fin de mur.
 *
 * **Ce que ça répare.** `useMur` filtre les prestations par quartier ouvert ;
 * sans quartier déclaré, un salon n'apparaissait **nulle part** — et l'écran ne
 * montrait pas non plus son état vide, puisque des commerces étaient bien
 * rendus. Un fil de deux salons réservables sans quartier donnait une barre de
 * recherche au-dessus d'un mur blanc.
 *
 * **Une section nommée plutôt qu'un repli sur liste plate.** Le cas courant est
 * mixte, pas binaire : les salons démarchés portent un quartier, ceux qui
 * s'inscrivent seuls parfois pas. Un repli aurait ajouté une seconde mise en
 * page dont l'apparition dépend d'une donnée invisible, et le cas mixte n'y
 * serait de toute façon pas entré.
 */
describe('les salons sans quartier ont leur section', () => {
  const SANS_QUARTIER = {
    ...commerce('b9', 'Panaderia del Sol', 'wynwood', [item('o9', 'Cortado tasting', 20, 'story')]),
    neighborhood: null,
    distance_metres: 4200,
  };
  const PLUS_PROCHE = {
    ...commerce('b8', 'Objet Concept Store', 'wynwood', [item('o8', 'Styling hour', 45, 'story')]),
    neighborhood: null,
    distance_metres: 900,
  };

  it('elle vient après le quartier ouvert, et trie par distance', async () => {
    // **Le décor est mixte, et c'est le seul qui sépare les deux
    // implémentations.** Avec des salons tous situés, un mur qui oublierait les
    // non situés rendrait exactement la même chose.
    const vue = await monter({
      ...FIL,
      commerces: [...FIL.commerces, SANS_QUARTIER, PLUS_PROCHE],
    } as unknown as Fil);
    await waitFor(() => expect(screen.getByTestId('ailleurs-en-ville')).toBeTruthy());

    const ordre = screen
      .getAllByTestId(/^salon-b\d+$/)
      .map((n) => String(n.props.testID));
    // Le quartier ouvert d'abord, puis les non situés, du plus proche au plus
    // lointain — 900 m avant 4,2 km, alors que le serveur les rend dans
    // l'autre ordre.
    expect(ordre).toEqual(['salon-b1', 'salon-b2', 'salon-b8', 'salon-b9']);
    expect(screen.getByTestId('ailleurs-compte')).toHaveTextContent(/\b2\b/);
    await vue.unmount();
  });

  it('et leur carte ne nomme aucun quartier, puisqu’ils n’en ont pas', async () => {
    // La phrase du compte tombe sur sa variante courte. Écrire « in Wynwood »
    // sur un salon qui n'a rien déclaré serait inventer une adresse.
    const vue = await monter({
      ...FIL,
      commerces: [...FIL.commerces, PLUS_PROCHE],
    } as unknown as Fil);
    await waitFor(() => expect(screen.getByTestId('salon-b8')).toBeTruthy());

    // La phrase est en capitales à l'écran : on compare sans la casse, sinon
    // le test mesurerait le `toUpperCase` et non le quartier.
    expect(screen.getByTestId('salon-b8-compte')).not.toHaveTextContent(
      new RegExp(en.quartiers.wynwood, 'i'),
    );
    // Celle d'un salon situé, elle, le nomme — sans cette moitié, un écran qui
    // n'écrirait jamais le quartier passerait le test du dessus.
    expect(screen.getByTestId('salon-b1-compte')).toHaveTextContent(
      new RegExp(en.quartiers.wynwood, 'i'),
    );
    await vue.unmount();
  });

  it('et le mur existe même quand aucun salon n’est situé', async () => {
    // **Le défaut, dans sa forme pure.** Zéro carte et aucun état vide : le
    // mur s'arrêtait à `null` parce qu'il n'avait pas de quartier à ouvrir.
    const vue = await monter({
      ...FIL,
      commerces: [SANS_QUARTIER, PLUS_PROCHE],
      quartiers: [],
    } as unknown as Fil);
    await waitFor(() => expect(screen.getByTestId('ailleurs-en-ville')).toBeTruthy());

    expect(screen.getAllByTestId('carte-du-mur')).toHaveLength(2);
    // Et pas d'en-tête de quartier : il n'y en a aucun à nommer.
    expect(screen.queryByTestId('quartier-ouvert-nom')).toBeNull();
    await vue.unmount();
  });
});
