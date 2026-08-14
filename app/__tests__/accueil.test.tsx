/**
 * L'accueil : la vidéo choisie sur le format réel.
 *
 * **La forme est mesurée, pas simulée.** L'écran envoie sa propre disposition,
 * comme la plateforme la lui donne, et c'est de cette mesure que sort
 * l'orientation. Remplacer le calcul par une valeur fixe prouverait que l'écran
 * sait afficher la vidéo qu'on lui désigne — jamais qu'il désigne la bonne.
 *
 * `expo-video` est remplacé : un lecteur ne démarre pas dans un environnement
 * de test, et ce qu'on vérifie ici n'est pas qu'il lit, c'est **ce qu'on lui
 * demande de lire**. Le remplacement expose la source, et rien d'autre.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { AccueilScreen, fondDAccueil } from '../src/screens/AccueilScreen';
import { ThemeProvider } from '../src/theme';

/** Les marges d'un iPhone 13. Le bas est ce qui nous intéresse ici. */
const IPHONE_A_ENCOCHE = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function styleAplati(valeur: unknown): Record<string, unknown> {
  return Array.isArray(valeur)
    ? Object.assign({}, ...valeur.map(styleAplati))
    : ((valeur as Record<string, unknown>) ?? {});
}

/**
 * Le double est **une seule instance**, comme le vrai `useVideoPlayer` : il rend
 * le même lecteur d'un rendu à l'autre et n'en remplace que la source. Un objet
 * neuf à chaque rendu ferait rejouer à chaque image les effets qui en dépendent
 * — la reprise partirait alors toute seule, et le test ne prouverait plus que
 * l'écran écoute le retour au premier plan.
 */
const mockLecteur = {
  source: null as string | null,
  loop: false,
  muted: false,
  playing: false,
  currentTime: 0,
  play: jest.fn(),
  // `useEvent` s'abonne au lecteur : sans émetteur, le rendu lève. Il ne
  // diffuse rien — la vidéo ne joue pas en test, et c'est le cas qu'on veut
  // éprouver, celui où l'affiche reste en place.
  addListener: () => ({ remove: () => {} }),
  removeListener: () => {},
  removeAllListeners: () => {},
};

jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: string | null) => {
      mockLecteur.source = source;
      return mockLecteur;
    },
    VideoView: ({ player, testID }: { player: { source: string | null }; testID?: string }) => (
      <View testID={testID} accessibilityLabel={player?.source ?? 'aucune'} />
    ),
  };
});

beforeEach(() => {
  mockLecteur.playing = false;
  mockLecteur.play.mockClear();
});

const TOUT = {
  categories: [],
  home: {
    video_key: 'photos/home/paysage.mp4',
    poster_key: 'photos/home/paysage.jpg',
    video_portrait_key: 'photos/home/vertical.mp4',
    poster_portrait_key: 'photos/home/vertical.jpg',
  },
};

const TELEPHONE = { width: 390, height: 844 };
const BUREAU = { width: 1512, height: 982 };

async function afficher(medias: unknown = TOUT) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => medias }) as Response,
  });

  return render(
    <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
      <ThemeProvider role="creator">
        <I18nProvider initialLocale="en">
          <ApiProvider client={api}>
            <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
          </ApiProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

/** Ce que la plateforme envoie quand elle a posé la vue. */
async function poser({ width, height }: { width: number; height: number }) {
  await fireEvent(screen.getByTestId('ecran-accueil'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height } },
  });
}

/** L'adresse réellement confiée au lecteur. */
function sourceJouee(): string {
  return screen.getByTestId('video-accueil').props.accessibilityLabel as string;
}

describe('accueil, orientation mesurée', () => {
  it('prend la verticale sur un téléphone tenu droit', async () => {
    // Une vidéo paysage y donnerait des bandes noires ou couperait le sujet.
    await afficher();
    await poser(TELEPHONE);

    await waitFor(() => expect(sourceJouee()).toContain('vertical.mp4'));
  });

  it('prend la paysage sur un grand écran', async () => {
    await afficher();
    await poser(BUREAU);

    await waitFor(() => expect(sourceJouee()).toContain('paysage.mp4'));
  });

  it('suit le format et non l’appareil, quand la fenêtre change', async () => {
    // Un iPad en paysage n'est pas un téléphone, et une fenêtre de navigateur
    // étroite n'est pas un écran de bureau.
    await afficher();
    await poser(BUREAU);
    await waitFor(() => expect(sourceJouee()).toContain('paysage.mp4'));

    await poser(TELEPHONE);
    await waitFor(() => expect(sourceJouee()).toContain('vertical.mp4'));
  });
});

describe('accueil, ce qui manque', () => {
  it('se replie sur l’autre orientation plutôt que de n’afficher aucune vidéo', async () => {
    await afficher({ ...TOUT, home: { ...TOUT.home, video_portrait_key: null } });
    await poser(TELEPHONE);

    // Mal cadrée vaut mieux qu'absente : le recadrage est centré.
    await waitFor(() => expect(sourceJouee()).toContain('paysage.mp4'));
  });

  it('garde l’affiche seule quand aucune vidéo n’existe', async () => {
    await afficher({
      ...TOUT,
      home: { ...TOUT.home, video_key: null, video_portrait_key: null },
    });
    await poser(BUREAU);

    await waitFor(() => expect(screen.getByTestId('affiche-accueil')).toBeTruthy());
    expect(screen.queryByTestId('video-accueil')).toBeNull();
  });

  it('rend l’entrée sans fond plutôt qu’un écran vide', async () => {
    // C'est la première chose qu'on voit du produit : un rectangle noir y
    // ressemblerait à une panne.
    await afficher({
      categories: [],
      home: {
        video_key: null,
        poster_key: null,
        video_portrait_key: null,
        poster_portrait_key: null,
      },
    });
    await poser(BUREAU);

    await waitFor(() => expect(screen.getByTestId('porte-createur')).toBeTruthy());
    expect(screen.getByTestId('porte-commerce')).toBeTruthy();
    // Le satin et son voile restent : ce ne sont pas des accompagnements du
    // média, c'est le fond de l'écran. Sans eux, « pas de vidéo » redeviendrait
    // une composition à part.
    expect(screen.getByTestId('satin-accueil', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('voile-accueil')).toBeTruthy();
  });

  it('rend les portes même si la route échoue', async () => {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async () => {
        throw new Error('hors ligne');
      },
    });
    await render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <ThemeProvider role="creator">
          <I18nProvider initialLocale="en">
            <ApiProvider client={api}>
              <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
            </ApiProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId('porte-createur')).toBeTruthy();
  });

  it('porte le mot accentué sous son propre point d’accroche', async () => {
    // **La suite de bout en bout lit la fonte sur ce nœud-là.** Un titre à bloc
    // est une pile de vues dont un seul enfant porte du texte ; interroger le
    // conteneur rendait la pile système — aucune famille n'y est déclarée — et
    // le test de fonte tombait sur la structure au lieu de la police. Ce test
    // garde le point d'accroche : le renommer ici casse la suite ailleurs, et
    // il vaut mieux l'apprendre en trois secondes qu'en dix minutes de CI.
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async () => {
        throw new Error('hors ligne');
      },
    });
    await render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <ThemeProvider role="creator">
          <I18nProvider initialLocale="en">
            <ApiProvider client={api}>
              <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
            </ApiProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId('promesse-accueil-mot')).toBeTruthy();
    // Et le mot est bien celui de la clé d'accent, pas le titre entier.
    expect(screen.getByTestId('promesse-accueil-mot').props.children).toBe(en.auth.accrocheAccent);
  });
});

// --------------------------------------------------------------------------
// ce qui dépasse de l'écran
// --------------------------------------------------------------------------

describe('accueil, atteindre le bas de la page', () => {
  /**
   * Le contenu tenait dans un `View` centré en `flex: 1`. Sur un iPhone, les
   * deux cartes empilées dépassent la hauteur de l'écran : le titre sortait
   * par le haut, et « Already have an account? Sign in » par le bas — hors
   * d'atteinte, sans contournement, l'app n'ayant qu'une adresse et aucune
   * route web. Un créateur déjà inscrit n'avait plus de chemin vers son compte
   * depuis son téléphone.
   */
  it('laisse défiler le contenu au lieu de le couper', async () => {
    await afficher();
    await poser(TELEPHONE);

    const defilant = screen.getByTestId('accueil-defilant');
    // Un `View` ne défile pas. C'est bien une vue défilante qu'on veut ici,
    // pas une boîte dont on aurait seulement changé les marges.
    expect(defilant.props.scrollEnabled ?? true).toBe(true);
    expect(typeof defilant.props.onScroll === 'function' || defilant.props.horizontal !== true).toBe(
      true,
    );

    const contenu = styleAplati(defilant.props.contentContainerStyle);
    // `flexGrow` et non `flex` : le premier centre tant que la place suffit et
    // laisse déborder ensuite, le second borne le contenu à la fenêtre et
    // rendrait le défilement inutile.
    expect(contenu.flexGrow).toBe(1);
    expect(contenu.flex).toBeUndefined();
    expect(contenu.justifyContent).toBe('center');
  });

  it('pose la marge du bas que la barre d’onglets ne pose pas ici', async () => {
    // `ZoneSure` laisse le bas à la barre d'onglets — qui n'existe pas avant
    // la connexion. Sans cette marge, le lien de connexion se termine sous la
    // barre d'accueil de l'iPhone : visible en fin de défilement, impressable.
    await afficher();
    await poser(TELEPHONE);

    const contenu = styleAplati(
      screen.getByTestId('accueil-defilant').props.contentContainerStyle,
    );
    expect(contenu.paddingBottom).toBe(24 + IPHONE_A_ENCOCHE.insets.bottom);
  });

  it('fait défiler les portes, pas le fond', async () => {
    // Le lien de connexion doit défiler — c'est le défaut qu'on répare. La
    // vidéo, l'affiche et le voile non : un fond qui remonte avec le contenu
    // laisserait le bas de la page sur du vide, et le voile cesserait de
    // protéger le texte qu'il couvre.
    await afficher();
    await poser(TELEPHONE);

    const defilant = screen.getByTestId('accueil-defilant');
    expect(defilant).toContainElement(screen.getByTestId('vers-connexion'));
    expect(defilant).not.toContainElement(screen.getByTestId('video-accueil'));
    expect(defilant).not.toContainElement(screen.getByTestId('voile-accueil'));
  });
});

describe('le choix du fond, isolé', () => {
  const home = TOUT.home;

  it('accorde l’affiche à la vidéo retenue, pas à l’orientation demandée', async () => {
    // Une affiche verticale sous une vidéo paysage recadre au chargement, puis
    // la vidéo démarre sur un autre cadrage : le saut se voit.
    const sansVerticale = { ...home, video_portrait_key: null };
    expect(fondDAccueil(sansVerticale, true)).toEqual({
      video: 'photos/home/paysage.mp4',
      affiche: 'photos/home/paysage.jpg',
    });
  });

  it('ne rend rien quand rien n’est encore chargé', async () => {
    expect(fondDAccueil(null, true)).toEqual({ video: null, affiche: null });
  });
});

describe('accueil, le retour au premier plan', () => {
  /**
   * Le retour d'onglet, tel que la plateforme l'annonce. `AppState` est le seul
   * chemin à écouter : sur le web, `react-native-web` l'adosse à
   * `visibilitychange`, et sur mobile il porte déjà la mise en arrière-plan.
   */
  function revenirAuPremierPlan(etat: AppStateStatus = 'active') {
    const abonnements = (AppState.addEventListener as jest.Mock).mock.calls
      .filter(([type]) => type === 'change')
      .map(([, ecouteur]) => ecouteur as (e: AppStateStatus) => void);
    // Sans abonnement, rien ne peut reprendre : l'absence est le défaut même.
    expect(abonnements.length).toBeGreaterThan(0);
    abonnements.forEach((ecouteur) => ecouteur(etat));
  }

  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: () => {} } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('relance la vidéo mise en pause par le navigateur', async () => {
    // Un onglet quitté suspend la lecture, et rien ne la reprenait au retour :
    // il fallait recharger la page pour retrouver le fond animé.
    await afficher();
    await poser(BUREAU);
    await waitFor(() => expect(sourceJouee()).toContain('paysage.mp4'));

    mockLecteur.play.mockClear();
    revenirAuPremierPlan();

    expect(mockLecteur.play).toHaveBeenCalled();
  });

  it('ne redemande rien à une vidéo qui joue déjà', async () => {
    await afficher();
    await poser(BUREAU);
    await waitFor(() => expect(sourceJouee()).toContain('paysage.mp4'));

    mockLecteur.playing = true;
    mockLecteur.play.mockClear();
    revenirAuPremierPlan();

    expect(mockLecteur.play).not.toHaveBeenCalled();
  });

  it('laisse l’écran tranquille tant qu’on n’est pas revenu', async () => {
    // Le passage en arrière-plan n'est pas un retour : relancer là relancerait
    // sur un onglet qu'on vient tout juste de quitter.
    await afficher();
    await poser(BUREAU);
    await waitFor(() => expect(sourceJouee()).toContain('paysage.mp4'));

    mockLecteur.play.mockClear();
    revenirAuPremierPlan('background');

    expect(mockLecteur.play).not.toHaveBeenCalled();
  });

  it('garde l’affiche sans la faire clignoter chez qui refuse la lecture automatique', async () => {
    // `play()` y reste refusé, donc `playing` reste faux : c'est l'état réel du
    // lecteur qui commande l'affiche, jamais la demande qu'on vient de faire.
    // Si la reprise l'effaçait pour la remettre, l'écran clignoterait à chaque
    // retour d'onglet.
    await afficher();
    await poser(BUREAU);
    await waitFor(() => expect(screen.getByTestId('affiche-accueil')).toBeTruthy());

    revenirAuPremierPlan();

    expect(screen.getByTestId('affiche-accueil')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// le satin, et le bloc unique
// --------------------------------------------------------------------------

describe('la marque se présente une fois, et une seule', () => {
  async function accueil(medias: unknown) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => medias }) as Response,
    });
    return render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <ThemeProvider role="creator">
          <I18nProvider initialLocale="en">
            <ApiProvider client={api}>
              <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
            </ApiProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  }

  // La clé est `home`, comme la carte d'API la nomme : `accueil` ici aurait
  // rendu les deux branches identiques et le test se serait cru vert.
  const SANS_MEDIA = {
    categories: [],
    home: {
      video_key: null,
      poster_key: null,
      video_portrait_key: null,
      poster_portrait_key: null,
    },
  };
  const AVEC_VIDEO = {
    categories: [],
    home: {
      video_key: 'photos/accueil/video.mp4',
      poster_key: 'photos/accueil/poster.jpg',
      video_portrait_key: null,
      poster_portrait_key: null,
    },
  };

  it('sans média, elle se présente sur un satin plutôt que de s’excuser', async () => {
    // L'écran annonçait « aucun fond » sous les portes : une phrase d'excuse à
    // l'endroit exact où le produit se montre pour la première fois.
    await accueil(SANS_MEDIA);
    await waitFor(() => expect(screen.getByTestId('porte-createur')).toBeTruthy());
    expect(
      screen.getByTestId('satin-accueil', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByTestId('accueil-sans-fond')).toBeNull();
  });

  it('avec un média, le satin reste dessous', async () => {
    // **Il ne s'efface pas quand la vidéo arrive.** C'est le fond de l'écran,
    // pas une composition de repli : ce qui arrive ensuite s'intercale, ça ne
    // remplace rien.
    await accueil(AVEC_VIDEO);
    await waitFor(() => expect(screen.getByTestId('video-accueil')).toBeTruthy());
    expect(
      screen.getByTestId('satin-accueil', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it.each([
    ['sans média', SANS_MEDIA],
    ['avec un média', AVEC_VIDEO],
  ])('%s, l’écran porte exactement un bloc accentué', async (_nom, medias) => {
    // **La garde statique ne peut pas voir ça.** Elle lit un fichier à la fois
    // et ne sait pas qu'un composant s'efface quand un autre parle : l'accueil
    // et les portes déclarent chacun leur bloc, et c'est à l'exécution que la
    // règle « un par écran » se joue. Le comptage, ici, est réel.
    await accueil(medias);
    await waitFor(() => expect(screen.getByTestId('promesse-accueil')).toBeTruthy());

    expect(screen.getAllByTestId('bloc-accentue')).toHaveLength(1);
    // Et la marque non plus ne se présente pas deux fois.
    expect(screen.getAllByTestId('signature-agence')).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------
// la page ne se refait pas sous les yeux
// --------------------------------------------------------------------------

describe('la composition ne change pas quand le manifeste arrive', () => {
  /**
   * Ce que l'écran montre, en une liste de noms.
   *
   * **C'est la mesure du défaut**, et elle vaut mieux qu'une capture : le
   * testeur avait rapporté « la vidéo met plusieurs secondes à démarrer », et
   * la vidéo n'était pas en cause. Le manifeste des médias arrive par un
   * aller-retour ; tant qu'il n'était pas là, l'écran rendait une composition
   * entièrement différente — satin dans le flux, portes sans en-tête — puis
   * basculait. Ce qu'on voyait n'était pas un délai, c'était la première chose
   * que montre le produit qui se réorganisait.
   *
   * Ce qui a le droit d'apparaître ensuite est l'affiche et la vidéo, et rien
   * d'autre : elles s'intercalent entre le satin et le voile.
   */
  const REPERES = [
    'satin-accueil',
    'bande-de-l-entete',
    'voile-accueil',
    'accueil-defilant',
    'choix-de-la-porte',
    'promesse-accueil',
    'signature-agence',
    'porte-createur',
    'porte-commerce',
  ];

  const presents = () =>
    REPERES.filter(
      (nom) => screen.queryAllByTestId(nom, { includeHiddenElements: true }).length > 0,
    );

  it('rend la même composition avant et après la réponse', async () => {
    // Une promesse qu'on tient à la main : entre le montage et sa résolution,
    // l'écran est exactement dans l'état où le testeur l'a vu.
    let repondre: (m: unknown) => void = () => {};
    const attendue = new Promise((ok) => {
      repondre = ok;
    });
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async () =>
        ({ ok: true, status: 200, json: async () => await attendue }) as Response,
    });

    await render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <ThemeProvider role="creator">
          <I18nProvider initialLocale="en">
            <ApiProvider client={api}>
              <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
            </ApiProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );

    // Manifeste inconnu : tout est déjà là.
    await waitFor(() => expect(screen.getByTestId('porte-createur')).toBeTruthy());
    const avant = presents();
    expect(avant).toEqual(REPERES);

    repondre({
      categories: [],
      home: {
        video_key: 'photos/accueil/video.mp4',
        poster_key: 'photos/accueil/poster.jpg',
        video_portrait_key: null,
        poster_portrait_key: null,
      },
    });

    // Manifeste arrivé : la vidéo s'est intercalée, et rien d'autre n'a bougé.
    await waitFor(() => expect(screen.getByTestId('video-accueil')).toBeTruthy());
    expect(presents()).toEqual(avant);
  });

  it('et la même encore quand le manifeste dit qu’il n’y a pas de média', async () => {
    // « Manifeste inconnu » et « manifeste connu et vide » donnaient tous deux
    // `null`, et appelaient pourtant deux rendus différents. Ils n'en appellent
    // plus qu'un : il n'y a plus de bascule à distinguer.
    await accueilAvec({
      categories: [],
      home: {
        video_key: null,
        poster_key: null,
        video_portrait_key: null,
        poster_portrait_key: null,
      },
    });
    await waitFor(() => expect(screen.getByTestId('porte-createur')).toBeTruthy());
    expect(presents()).toEqual(REPERES);
  });

  async function accueilAvec(medias: unknown) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => medias }) as Response,
    });
    return render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <ThemeProvider role="creator">
          <I18nProvider initialLocale="en">
            <ApiProvider client={api}>
              <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
            </ApiProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  }
});

describe('l’en-tête de l’accueil porte sa bande', () => {
  it('sur une vidéo comme sur le satin, et avec le même fond', async () => {
    // **Le voile ne suffit pas ici, et c'est mesuré.** Il descend à 0,55 en son
    // milieu, et l'en-tête tombe entre le tiers et la moitié de l'écran selon
    // la hauteur du contenu : sur une vidéo claire, cela fait entre 5,48:1 et
    // 3,72:1 — au-dessus du seuil ou en dessous selon le terminal. Une
    // garantie qui varie avec le terminal n'en est pas une.
    //
    // Sur le satin seul on est à 6,00:1 ; mais le satin n'est là que tant
    // qu'aucune vidéo ne le couvre, et une garantie qui dépend de ce qui a fini
    // de charger n'en est pas une non plus.
    const { couleurs, opaciteMinimaleDuVoile } = require('../src/theme');
    const opacite = Number(/,\s*([\d.]+)\)/.exec(couleurs['scrim.photoBottom'])![1]);

    for (const medias of [SANS_MEDIA_HAUT, AVEC_VIDEO_HAUT]) {
      const vue = await accueilBrut(medias);
      await waitFor(() => expect(screen.getByTestId('bande-de-l-entete')).toBeTruthy());
      expect(styleAplati(screen.getByTestId('bande-de-l-entete')).backgroundColor).toBe(
        couleurs['scrim.photoBottom'],
      );
      expect(opacite).toBeGreaterThanOrEqual(opaciteMinimaleDuVoile('ink.onScrim'));
      await vue.unmount();
    }
  });

  const SANS_MEDIA_HAUT = {
    categories: [],
    home: {
      video_key: null,
      poster_key: null,
      video_portrait_key: null,
      poster_portrait_key: null,
    },
  };
  const AVEC_VIDEO_HAUT = {
    categories: [],
    home: {
      video_key: 'photos/accueil/video.mp4',
      poster_key: 'photos/accueil/poster.jpg',
      video_portrait_key: null,
      poster_portrait_key: null,
    },
  };

  function styleAplati(element: { props: { style?: unknown } }): Record<string, unknown> {
    const empile = (valeur: unknown): Record<string, unknown> =>
      Array.isArray(valeur)
        ? Object.assign({}, ...valeur.map(empile))
        : ((valeur as Record<string, unknown>) ?? {});
    return empile(element.props.style);
  }

  async function accueilBrut(medias: unknown) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => medias }) as Response,
    });
    return render(
      <SafeAreaProvider initialMetrics={IPHONE_A_ENCOCHE}>
        <ThemeProvider role="creator">
          <I18nProvider initialLocale="en">
            <ApiProvider client={api}>
              <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
            </ApiProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  }
});
