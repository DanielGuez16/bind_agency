/**
 * La galerie photos, côté commerce.
 *
 * Deux flèches par ligne plutôt qu'un glisser-déposer : celui-ci n'existe pas
 * en React Native sans bibliothèque tierce, et pour dix à douze photos deux
 * flèches suffisent — elles marchent sur les deux plateformes et sont
 * accessibles au lecteur d'écran, ce qu'un glisser n'est jamais.
 *
 * Ce qui est éprouvé ici est ce qu'un déplacement peut faire de travers :
 * envoyer un ordre partiel que le serveur refusera, et offrir une flèche à la
 * photo qui ne peut pas bouger.
 */
import * as ImagePicker from 'expo-image-picker';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { Api, ApiClient, ApiProvider, type PhotoDuCommerce } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { GalerieDuCommerce } from '../src/screens/GalerieDuCommerce';
import { ThemeProvider } from '../src/theme';

const PHOTOS: PhotoDuCommerce[] = [
  { id: 'p1', storage_key: 'photos/commerces/b1/a.jpg', position: 0, alt_text: null },
  { id: 'p2', storage_key: 'photos/commerces/b1/b.jpg', position: 1, alt_text: null },
  { id: 'p3', storage_key: 'photos/commerces/b1/c.jpg', position: 2, alt_text: null },
];

type Envoi = { chemin: string; methode?: string; corps?: unknown };

function lireLeCorps(corps: BodyInit | null | undefined): unknown {
  if (!corps || typeof corps !== 'string') return undefined;
  try {
    return JSON.parse(corps);
  } catch {
    return undefined;
  }
}

function clientEspion(envois: Envoi[]) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url, init) => {
      envois.push({
        chemin: String(url),
        methode: init?.method,
        // Un corps de fichier n'est pas du JSON : `String(FormData)` donne
        // « [object FormData] », et l'analyser lèverait — ce que le client
        // rapporterait en panne réseau, loin de la vraie cause.
        corps: lireLeCorps(init?.body),
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ storage_key: 'photos/commerces/b1/neuve.jpg' }),
      } as Response;
    },
  });
}

async function monter(envois: Envoi[], couverture: string | null = null) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={clientEspion(envois)}>
          <GalerieDuCommerce
            businessId="b1"
            photos={PHOTOS}
            couverture={couverture}
            onChange={jest.fn()}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('l’ordre de la galerie', () => {
  it('envoie l’ordre complet, jamais un déplacement isolé', async () => {
    // Le serveur refuse un ordre partiel : lui laisser deviner ce que
    // deviennent les autres photos ferait deviner chaque client autrement.
    const envois: Envoi[] = [];
    await monter(envois);

    await fireEvent.press(screen.getByTestId('descendre-p1'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].chemin).toContain('/photos/order');
    expect(envois[0].corps).toEqual({ photos: ['p2', 'p1', 'p3'] });
  });

  it('monte une photo en échangeant avec celle du dessus', async () => {
    const envois: Envoi[] = [];
    await monter(envois);

    await fireEvent.press(screen.getByTestId('monter-p3'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].corps).toEqual({ photos: ['p1', 'p3', 'p2'] });
  });

  it('retire la flèche qui ne mène nulle part', async () => {
    // Un bouton grisé invite à appuyer pour découvrir qu'il ne fait rien.
    await monter([]);

    expect(screen.queryByTestId('monter-p1')).toBeNull();
    expect(screen.queryByTestId('descendre-p3')).toBeNull();
    expect(screen.getByTestId('descendre-p1')).toBeTruthy();
    expect(screen.getByTestId('monter-p3')).toBeTruthy();
  });
});

describe('la couverture', () => {
  it('passe par la route du commerce, pas par la galerie', async () => {
    // La couverture est un champ du commerce. Une seconde route ferait deux
    // vérités sur la même donnée.
    const envois: Envoi[] = [];
    await monter(envois);

    await fireEvent.press(screen.getByTestId('definir-couverture-p2'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].chemin).toMatch(/\/business\/b1$/);
    expect(envois[0].methode).toBe('PATCH');
    expect(envois[0].corps).toEqual({ cover_photo_key: PHOTOS[1].storage_key });
  });

  it('ne propose pas de redéfinir celle qui l’est déjà', async () => {
    await monter([], PHOTOS[0].storage_key);

    expect(screen.getByTestId('couverture-p1')).toBeTruthy();
    expect(screen.queryByTestId('definir-couverture-p1')).toBeNull();
    expect(screen.getByTestId('definir-couverture-p2')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// le téléversement, et son branchement
// --------------------------------------------------------------------------

describe('ajouter une photo', () => {
  it('dépose le fichier puis l’ajoute, en deux appels', async () => {
    // Le serveur sépare les deux : déposer échoue pour des raisons qui n'ont
    // rien à voir avec la galerie — réseau, poids, format — et les mêler
    // ferait remonter « galerie pleine » pour une image trop lourde.
    const envois: Envoi[] = [];
    // `Api` et non `ApiClient` : c'est la façade qui enchaîne les deux appels.
    const api = new Api(clientEspion(envois));

    await api.ajouterUnePhoto('b1', 'file:///photo.jpg');

    expect(envois).toHaveLength(2);
    expect(envois[0].chemin).toContain('/photos/uploads');
    expect(envois[1].chemin).toMatch(/\/photos$/);
    expect(envois[1].methode).toBe('POST');
  });
});

/**
 * Un envoi qui échoue garde le fichier.
 *
 * **C'est le cas que le défaut de téléversement rendait certain**, et celui qui
 * décide si une créatrice réessaie ou abandonne. Le fichier choisi était une
 * variable locale : elle mourait avec la fonction, l'écran affichait un message,
 * et réessayer voulait dire rouvrir la galerie et retrouver la bonne image.
 */
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///choisie.jpg' }],
  })),
}));

function clientQuiRefuse(envois: Envoi[], refuser: { encore: boolean }) {
    return new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async (url, init) => {
        envois.push({ chemin: String(url), methode: init?.method, corps: null });
        if (refuser.encore) {
          return { ok: false, status: 503, json: async () => ({ detail: 'nope' }) } as Response;
        }
        return { ok: true, status: 200, json: async () => ({ storage_key: 'k' }) } as Response;
      },
    });
}

describe('un envoi qui échoue', () => {
  it('garde le fichier, et le renvoie sans rouvrir la galerie', async () => {
    const envois: Envoi[] = [];
    const refuser = { encore: true };
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={clientQuiRefuse(envois, refuser)}>
            <GalerieDuCommerce businessId="b1" photos={PHOTOS} couverture={null} onChange={jest.fn()} />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    await fireEvent.press(screen.getByTestId('ajouter-une-photo'));
    await waitFor(() => expect(screen.getByTestId('reessayer-l-envoi')).toBeTruthy());

    // **Le second envoi ne rouvre pas le sélecteur.** C'est toute la question :
    // une créatrice qui doit retrouver son image dans une galerie de mille
    // photos abandonne, et le message d'erreur n'y change rien.
    refuser.encore = false;
    const ouverturesAvant = (ImagePicker.launchImageLibraryAsync as jest.Mock).mock.calls.length;
    await fireEvent.press(screen.getByTestId('reessayer-l-envoi'));

    await waitFor(() => expect(screen.queryByTestId('reessayer-l-envoi')).toBeNull());
    expect((ImagePicker.launchImageLibraryAsync as jest.Mock).mock.calls.length).toBe(
      ouverturesAvant,
    );
  });
});

it('ne propose pas de réessayer pendant que la reprise vole', async () => {
  // **La reprise au retour au premier plan relance sans que l'écran agisse.**
  // Garder « réessayer » à l'écran ferait proposer un geste déjà en cours, et un
  // second appui enverrait le même fichier deux fois — sur une galerie, deux
  // photos identiques.
  const envois: Envoi[] = [];
  const refuser = { encore: true };
  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={clientQuiRefuse(envois, refuser)}>
          <GalerieDuCommerce businessId="b1" photos={PHOTOS} couverture={null} onChange={jest.fn()} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );

  await fireEvent.press(screen.getByTestId('ajouter-une-photo'));
  await waitFor(() => expect(screen.getByTestId('reessayer-l-envoi')).toBeTruthy());

  // Pendant l'envoi suivant, le bouton disparaît plutôt que d'inviter deux fois.
  refuser.encore = false;
  await fireEvent.press(screen.getByTestId('reessayer-l-envoi'));
  await waitFor(() => expect(screen.queryByTestId('reessayer-l-envoi')).toBeNull());
});
