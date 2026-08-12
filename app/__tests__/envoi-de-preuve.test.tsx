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

  // L'écran ne se referme plus tout seul : il montre d'abord ce que la
  // plateforme a dit de la soumission, et `onEnvoye` part du bouton de retour.
  // Ce que ce test vérifie reste l'ordre des deux appels.
  await waitFor(() => expect(envois).toHaveLength(2));
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

// --------------------------------------------------------------------------
// la note libre, l'autre moitié du canal
// --------------------------------------------------------------------------

/** Un espion qui garde les corps, que le double partagé ne retient pas. */
type EnvoiComplet = { chemin: string; corps?: unknown };

async function monterAvecEspion(recueil: EnvoiComplet[]) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, init) => {
      const corps = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      recueil.push({ chemin: String(url), corps });
      return {
        ok: true,
        status: 200,
        json: async () => ({ screenshot_key: 'proofs/upload/2026-08-09/abc' }),
      } as Response;
    },
  });

  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <EnvoiDePreuve collaborationId="k1" onEnvoye={jest.fn()} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

async function envoyerAvecNote(note: string): Promise<EnvoiComplet[]> {
  const recueil: EnvoiComplet[] = [];
  mockResultat = CHOISI;
  await monterAvecEspion(recueil);

  await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
  await waitFor(() => expect(screen.getByTestId('note-de-la-preuve')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('note-de-la-preuve'), note);
  await fireEvent.press(screen.getByTestId('confirmer-l-envoi'));

  await waitFor(() => expect(recueil.some((e) => /\/proof$/.test(e.chemin))).toBe(true));
  return recueil;
}

async function afficherSansMedia() {
  mockResultat = { canceled: true };
  await monterAvecEspion([]);
}

describe('la note du créateur', () => {
  it('part avec la soumission, jamais séparément', async () => {
    // Envoyée après, elle arriverait sur un dossier déjà refusé, et le
    // commerce l'aurait lue une fois sa décision prise.
    const envois = await envoyerAvecNote('la cliente est arrivée en retard');

    const soumission = envois.find((e) => /\/proof$/.test(e.chemin));
    expect(soumission?.corps).toMatchObject({ note: 'la cliente est arrivée en retard' });
  });

  it('n’envoie rien quand elle est vide', async () => {
    // Une soumission conforme n'a rien à expliquer, et une clé `note: ""`
    // ferait exister une note vide côté commerce.
    const envois = await envoyerAvecNote('   ');

    const soumission = envois.find((e) => /\/proof$/.test(e.chemin));
    expect(soumission?.corps).not.toHaveProperty('note');
  });

  it('ne s’offre qu’une fois le média choisi', async () => {
    // Écrire avant d'avoir quoi que ce soit à joindre n'a pas d'objet, et le
    // champ occuperait la place de l'action qu'on attend.
    await afficherSansMedia();
    expect(screen.queryByTestId('note-de-la-preuve')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// l'incitation, et le résultat de la vérification
// --------------------------------------------------------------------------

describe('la vérification, dite au créateur', () => {
  it('annonce l’enjeu avant l’envoi, jamais après', async () => {
    // C'est la seule chose que la créatrice peut décider à cet instant, et
    // elle ne peut la décider qu'en la sachant.
    mockResultat = CHOISI;
    await monterAvecEspion([]);
    expect(screen.queryByTestId('incitation-a-soumettre-vite')).toBeNull();

    await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
    // Le texte, pas seulement la présence : un encart vide passerait pour un
    // avertissement affiché, et c'est l'incitation elle-même qui compte.
    expect(screen.getByTestId('incitation-a-soumettre-vite')).toHaveTextContent(
      /24 hours/i,
    );
  });

  it('dit « vérifiée » quand la plateforme a confirmé', async () => {
    await soumettreEtLire({ verifiee: true, raisons_de_non_verification: [] });
    expect(screen.getByTestId('preuve-verifiee')).toBeTruthy();
  });

  it('dit « attestée » quand la question ne s’est pas posée', async () => {
    // Nul n'est pas faux : la plateforme n'a rien confirmé, ce qui n'accuse
    // personne. L'écrire comme un échec accuserait la créatrice d'un silence
    // d'Instagram.
    await soumettreEtLire({ verifiee: null, raisons_de_non_verification: [] });

    expect(screen.getByTestId('preuve-attestee')).toBeTruthy();
    expect(screen.queryByTestId('preuve-verifiee')).toBeNull();
  });

  it('ne quitte pas l’écran avant que le résultat soit lu', async () => {
    // Refermer aussitôt ferait de l'incitation une phrase sans suite.
    const onEnvoye = await soumettreEtLire({
      verifiee: true,
      raisons_de_non_verification: [],
    });
    expect(onEnvoye).not.toHaveBeenCalled();
  });
});

/** Soumet, puis rend la fonction de sortie sans l'avoir appelée. */
async function soumettreEtLire(preuve: Record<string, unknown>) {
  const onEnvoye = jest.fn();
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).endsWith('/proof')
            ? // **Deux preuves, et c'est la dernière qui vient d'être créée.**
              // Lire la première donnerait le verdict d'une soumission
              // précédente — souvent celle qui avait été refusée.
              { proofs: [{ verifiee: !preuve.verifiee, raisons_de_non_verification: [] }, preuve] }
            : { screenshot_key: 'proofs/upload/2026-08-09/abc' },
      }) as Response,
  });

  mockResultat = CHOISI;
  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <EnvoiDePreuve collaborationId="k1" onEnvoye={onEnvoye} />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );

  await fireEvent.press(screen.getByTestId('choisir-dans-la-galerie'));
  await fireEvent.press(screen.getByTestId('confirmer-l-envoi'));
  await waitFor(() =>
    expect(
      screen.queryByTestId('preuve-verifiee') ?? screen.queryByTestId('preuve-attestee'),
    ).toBeTruthy(),
  );
  return onEnvoye;
}
