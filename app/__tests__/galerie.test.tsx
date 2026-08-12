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
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type PhotoDuCommerce } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { GalerieDuCommerce } from '../src/screens/GalerieDuCommerce';
import { ThemeProvider } from '../src/theme';

const PHOTOS: PhotoDuCommerce[] = [
  { id: 'p1', storage_key: 'photos/commerces/b1/a.jpg', position: 0, alt_text: null },
  { id: 'p2', storage_key: 'photos/commerces/b1/b.jpg', position: 1, alt_text: null },
  { id: 'p3', storage_key: 'photos/commerces/b1/c.jpg', position: 2, alt_text: null },
];

type Envoi = { chemin: string; methode?: string; corps?: unknown };

function clientEspion(envois: Envoi[]) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url, init) => {
      envois.push({
        chemin: String(url),
        methode: init?.method,
        corps: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return { ok: true, status: 200, json: async () => ({}) } as Response;
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
