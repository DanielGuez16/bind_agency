/**
 * Le premier écran du produit : deux portes, et rien derrière elles.
 *
 * **Ce fichier a beaucoup rétréci, et c'est ce que la planche v3 fait.** Il
 * portait huit blocs, dont six sur la vidéo de fond : l'orientation mesurée sur
 * la forme du conteneur, les replis quand un média manque, le retour au premier
 * plan, la composition qui ne devait pas changer à l'arrivée du manifeste, et
 * les fonds que chaque texte devait porter pour survivre à ce qu'il y avait
 * dessous. La vidéo part ; ces six n'ont plus d'objet, et les garder en les
 * tordant aurait fait croire qu'un fond tient encore quelque part.
 *
 * **Ce qui survit ne survit pas par hasard.** La marque une fois et une seule,
 * et le chemin vers la connexion atteignable : les deux étaient des défauts
 * rapportés, pas des propriétés décoratives, et ils valent encore sur un écran
 * sans média.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { AccueilScreen } from '../src/screens/AccueilScreen';
import { ThemeProvider } from '../src/theme';

/** Un iPhone à encoche : 47 points en haut, 34 en bas. */
const IPHONE = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function accueil(onSeConnecter = () => {}) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    // **Aucun appel n'est attendu, et c'est le sujet.** L'écran interrogeait le
    // manifeste des médias au montage ; il ne le fait plus. Un client qui
    // échoue à toute requête est donc le bon montage : si l'écran se remet à
    // appeler, il tombera ici plutôt que de continuer en silence.
    fetchImpl: (async () => {
      throw new Error('aucune requête ne doit partir de cet écran');
    }) as unknown as typeof fetch,
  });

  return render(
    <SafeAreaProvider initialMetrics={IPHONE}>
      <ThemeProvider role="creator">
        <I18nProvider initialLocale="en">
          <ApiProvider client={api}>
            <AccueilScreen onChoisir={() => {}} onSeConnecter={onSeConnecter} />
          </ApiProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('l’écran ne porte plus de média', () => {
  it('ni vidéo, ni affiche, ni voile, ni satin', async () => {
    // **Les quatre ensemble.** Retirer la vidéo en laissant le satin et son
    // voile laisserait un fond de marque sous des cartes blanches — la moitié
    // d'un écran que la planche veut plat. Chacun est nommé pour que sa
    // réapparition tombe ici.
    const vue = await accueil();
    await waitFor(() => expect(screen.getByTestId('ecran-accueil')).toBeTruthy());

    expect(screen.queryByTestId('video-accueil')).toBeNull();
    expect(screen.queryByTestId('affiche-accueil')).toBeNull();
    expect(screen.queryByTestId('voile-accueil')).toBeNull();
    expect(screen.queryByTestId('satin-accueil')).toBeNull();
    await vue.unmount();
  });

  it('et ne défile plus, parce qu’il n’a plus besoin de défiler', async () => {
    // Le défilement existait parce que deux cartes **empilées** dépassaient la
    // hauteur d'un iPhone. Côte à côte, elles tiennent : sur 390 × 844, barre
    // d'état et marge basse retirées, il reste 728 points.
    const vue = await accueil();
    await waitFor(() => expect(screen.getByTestId('ecran-accueil')).toBeTruthy());

    expect(screen.queryByTestId('accueil-defilant')).toBeNull();
    await vue.unmount();
  });
});

describe('les deux portes', () => {
  it('sont côte à côte, et de largeur égale', async () => {
    // **La contrainte qui dessine tout.** Empilées, il faut défiler ; côte à
    // côte, l'écran tient. Le test lit la direction de la rangée et le `flex`
    // des deux cartes : une colonne, ou une carte plus large que l'autre,
    // ramènerait le défilement ou romprait la comparaison d'un regard.
    const vue = await accueil();
    await waitFor(() => expect(screen.getByTestId('porte-createur')).toBeTruthy());

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    const createur = screen.getByTestId('porte-createur');
    const commerce = screen.getByTestId('porte-commerce');
    expect(aplati(createur.parent?.props?.style).flexDirection).toBe('row');
    expect(aplati(createur.props.style).flex).toBe(1);
    expect(aplati(commerce.props.style).flex).toBe(1);
    await vue.unmount();
  });

  it('portent leur intitulé sur deux lignes, en gros', async () => {
    // **Deux colonnes de 171 points ne portent pas « CREATOR ACCOUNT » sur une
    // ligne au-delà de 13 points**, ce qui n'est pas « en gros ». Empilé,
    // chaque mot tient à 22. Le test lit la taille rendue : c'est elle qui
    // décide, et une variante renommée sans changer de taille passerait un test
    // qui ne lirait que le nom.
    const vue = await accueil();
    await waitFor(() => expect(screen.getByTestId('porte-createur-role')).toBeTruthy());

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    const role = screen.getByTestId('porte-createur-role');
    expect(role).toHaveTextContent(en.auth.porteRoleCreateur.toUpperCase());
    expect(Number(aplati(role.props.style).fontSize)).toBeGreaterThanOrEqual(22);
    // **Deux fois, une par porte**, et chacun sur son propre nœud : c'est ce
    // qui met le mot sur sa ligne, et ce qui lui permet de porter l'orange sans
    // le donner au premier. Un seul nœud « CREATOR ACCOUNT » passerait un test
    // qui ne chercherait que la présence du mot.
    expect(screen.getAllByText(en.auth.porteCompte.toUpperCase())).toHaveLength(2);
    await vue.unmount();
  });

  it('et un seul aplat orange pour deux portes de poids égal', async () => {
    // Le rôle créateur est celui qu'on attend en masse ; la porte commerce a le
    // même intitulé, la même taille et un contour d'encre. C'est un ordre de
    // fréquence, pas de valeur — et deux aplats côte à côte ne diraient ni
    // l'un ni l'autre.
    const vue = await accueil();
    await waitFor(() => expect(screen.getByTestId('choisir-creator')).toBeTruthy());

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    const fond = (id: string) => aplati(screen.getByTestId(id).props.style).backgroundColor;
    expect(fond('choisir-creator')).not.toBe(fond('choisir-business_member'));
    await vue.unmount();
  });
});

describe('ce qui survit de l’ancien écran', () => {
  it('la marque se présente une fois, et une seule', async () => {
    // Elle a été rendue deux fois — une dans l'en-tête, une dans le fond — et
    // un logotype qui apparaît deux fois sur le premier écran se lit comme un
    // défaut d'assemblage.
    const vue = await accueil();
    await waitFor(() => expect(screen.getByTestId('logotype')).toBeTruthy());

    expect(screen.getAllByTestId('logotype')).toHaveLength(1);
    await vue.unmount();
  });

  it('et le chemin vers la connexion reste atteignable', async () => {
    // **Un défaut rapporté, pas une propriété décorative.** Le lien sortait par
    // le bas d'un conteneur qui coupait, et l'app n'ayant qu'une adresse et
    // aucune route web, un créateur déjà inscrit n'avait plus aucun chemin vers
    // son compte depuis son téléphone.
    const vue = await accueil();
    await waitFor(() => expect(screen.getByTestId('vers-connexion')).toBeTruthy());

    expect(screen.getByTestId('vers-connexion')).toHaveTextContent(en.auth.versConnexion);
    await vue.unmount();
  });

  it('et la sous-ligne du titre est partie', async () => {
    // Ce qu'elle disait — l'échange, l'absence d'argent — est déjà dit par les
    // puces des deux portes, mieux et deux fois. Un premier écran qui dit deux
    // fois la même chose la dit une fois de trop.
    const vue = await accueil();
    await waitFor(() => expect(screen.getByTestId('promesse-accueil')).toBeTruthy());

    expect(screen.queryByText(en.auth.sousAccroche)).toBeNull();
    await vue.unmount();
  });
});
