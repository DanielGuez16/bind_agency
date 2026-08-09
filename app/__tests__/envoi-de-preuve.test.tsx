/**
 * Le maillon final : choisir une capture, la regarder, l'envoyer.
 *
 * Le bouton n'ouvrait rien. Tout le reste du produit — les paliers, la
 * réservation, le code de retrait — n'aboutissait nulle part.
 *
 * Ce fichier éprouve les chemins qu'on n'emprunte pas en développant : le refus
 * de permission, le fichier trop lourd, l'abandon. Ce sont ceux qui décident si
 * l'écran est utilisable dans un salon, avec un réseau moyen et une photothèque
 * pleine.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { EnvoiDePreuve, POIDS_MAXIMAL } from '../src/screens/EnvoiDePreuve';

const mockPermissions = { galerie: true, camera: true };
let mockResultat: unknown = { canceled: true };
const mockOuvertures: string[] = [];

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: mockPermissions.galerie }),
  requestCameraPermissionsAsync: async () => ({ granted: mockPermissions.camera }),
  launchImageLibraryAsync: async () => {
    mockOuvertures.push('galerie');
    return mockResultat;
  },
  launchCameraAsync: async () => {
    mockOuvertures.push('camera');
    return mockResultat;
  },
}));

const coffre = { lire: async () => null, ecrire: async () => {} };
const envois: string[] = [];

function client(echoue = false) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) => {
      const chemin = String(url);
      envois.push(chemin);
      if (echoue) {
        return {
          ok: false,
          status: 413,
          json: async () => ({ detail: 'proof_too_large' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ screenshot_key: 'proofs/upload/2026-08-09/abc' }),
      } as Response;
    },
  });
}

async function monter(onEnvoye = jest.fn(), echoue = false) {
  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={client(echoue)}>
          <EnvoiDePreuve collaborationId="k1" onEnvoye={onEnvoye} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return onEnvoye;
}

beforeEach(() => {
  mockPermissions.galerie = true;
  mockPermissions.camera = true;
  mockResultat = { canceled: true };
  mockOuvertures.length = 0;
  envois.length = 0;
});

const CHOISI = {
  canceled: false,
  assets: [{ uri: 'file:///capture.jpg', fileSize: 1024 }],
};

it('montre l’image avant de l’envoyer', async () => {
  // Deux temps, jamais un : un envoi déclenché par la sélection ferait partir
  // la mauvaise image sans recours, et c'est une image qu'un commerce va juger.
  mockResultat = CHOISI;
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
  });

  await waitFor(() => expect(screen.getByTestId('apercu-du-choix')).toBeTruthy());
  expect(screen.getByTestId('confirmer-l-envoi')).toBeTruthy();
  // Rien n'est parti tant qu'on n'a pas confirmé.
  expect(envois).toHaveLength(0);
});

it('téléverse puis soumet, dans cet ordre', async () => {
  mockResultat = CHOISI;
  const onEnvoye = await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('confirmer-l-envoi'));
  });

  await waitFor(() => expect(onEnvoye).toHaveBeenCalled());
  expect(envois[0]).toContain('/me/proof-uploads');
  expect(envois[1]).toContain('/collaborations/k1/proof');
});

it('refuse un fichier trop lourd sans rien envoyer', async () => {
  // Mesuré avant de partir : l'apprendre après l'envoi d'un fichier de vingt
  // mégaoctets sur le réseau d'un salon est une punition.
  mockResultat = {
    canceled: false,
    assets: [{ uri: 'file:///enorme.jpg', fileSize: POIDS_MAXIMAL + 1 }],
  };
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
  });

  await waitFor(() => expect(screen.getByTestId('echec-envoi')).toBeTruthy());
  expect(envois).toHaveLength(0);
  expect(screen.queryByTestId('confirmer-l-envoi')).toBeNull();
});

it('dit le refus de permission comme un choix, avec sa seule issue', async () => {
  // Refuser l'accès à ses photos est un choix ; le dire comme une panne le
  // rendrait inquiétant. Et redemander ne sert à rien une fois le refus posé.
  mockPermissions.galerie = false;
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
  });

  await waitFor(() => expect(screen.getByTestId('echec-envoi')).toBeTruthy());
  expect(screen.getByText(en.parcours.preuvePermissionGalerie)).toBeTruthy();
  expect(screen.getByTestId('ouvrir-les-reglages')).toBeTruthy();
  // Le sélecteur ne s'est pas ouvert : la permission a été demandée d'abord.
  expect(mockOuvertures).toHaveLength(0);
});

it('ne renvoie pas vers les réglages après une panne réseau', async () => {
  // Un bouton vers les réglages après un échec d'envoi enverrait chercher au
  // mauvais endroit.
  mockResultat = CHOISI;
  await monter(jest.fn(), true);

  await act(async () => {
    await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('confirmer-l-envoi'));
  });

  await waitFor(() => expect(screen.getByTestId('echec-envoi')).toBeTruthy());
  expect(screen.queryByTestId('ouvrir-les-reglages')).toBeNull();
  // Et l'image reste à l'écran : on peut réessayer sans la rechoisir.
  expect(screen.getByTestId('apercu-du-choix')).toBeTruthy();
});

it('ne retient rien quand on abandonne le sélecteur', async () => {
  mockResultat = { canceled: true };
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
  });

  expect(screen.queryByTestId('apercu-du-choix')).toBeNull();
  expect(screen.queryByTestId('echec-envoi')).toBeNull();
});

it('demande la caméra avant de l’ouvrir', async () => {
  mockPermissions.camera = false;
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('prendre-une-photo'));
  });

  await waitFor(() => expect(screen.getByText(en.parcours.preuvePermissionCamera)).toBeTruthy());
  expect(mockOuvertures).toHaveLength(0);
});
