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

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { AccueilScreen, fondDAccueil } from '../src/screens/AccueilScreen';
import { ThemeProvider } from '../src/theme';

jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: string | null) => ({ source, loop: false, muted: false }),
    VideoView: ({ player, testID }: { player: { source: string | null }; testID?: string }) => (
      <View testID={testID} accessibilityLabel={player?.source ?? 'aucune'} />
    ),
  };
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
    <ThemeProvider role="creator">
      <I18nProvider initialLocale="en">
        <ApiProvider client={api}>
          <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
        </ApiProvider>
      </I18nProvider>
    </ThemeProvider>,
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
    expect(screen.queryByTestId('voile-accueil')).toBeNull();
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
      <ThemeProvider role="creator">
        <I18nProvider initialLocale="en">
          <ApiProvider client={api}>
            <AccueilScreen onChoisir={() => {}} onSeConnecter={() => {}} />
          </ApiProvider>
        </I18nProvider>
      </ThemeProvider>,
    );

    expect(screen.getByTestId('porte-createur')).toBeTruthy();
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
