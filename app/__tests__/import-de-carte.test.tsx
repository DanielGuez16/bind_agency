/**
 * Le chemin depuis « les prestations » jusqu'à la carte relue.
 *
 * **Ce que ces tests éprouvent n'est pas l'extraction, c'est le branchement.**
 * Le dépôt, la lecture et la validation étaient écrits, testés et servis depuis
 * la phase 9 ; l'écran de relecture n'avait aucun appelant, et rien ne le
 * disait. C'est la troisième fois en deux semaines qu'un mécanisme complet
 * dort faute d'un bouton, après la carte du fil et la mise en éveil du
 * comptoir.
 *
 * **Le décor divergent est la chaîne entière.** Une implémentation qui dépose
 * le fichier et s'arrête rend le même écran : la galerie s'ouvre, le fichier
 * part, rien ne se plaint, et le salon n'a toujours pas ses prestations. Les
 * tests lisent donc **les trois appels**, dans l'ordre, et l'écran qui suit.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { CatalogueScreen } from '../src/screens/CatalogueScreen';
import { ThemeProvider } from '../src/theme';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///carte.jpg', mimeType: 'image/jpeg' }],
  })),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///carte.pdf', mimeType: 'application/pdf' }],
  })),
}));

/** Une prestation déjà composée : l'écran est dans son état courant, pas vide. */
const DEJA = {
  id: 'i1',
  business_id: 'b1',
  parent_item_id: null,
  name: 'Gel manicure',
  description: null,
  price_cents: 4000,
  duration_minutes: 45,
  requires_booking: true,
  photo_key: null,
  leaves_choice: false,
  source: 'manual',
  is_available: true,
  is_effectively_available: true,
  archived_at: null,
  reservations_count: 0,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const LUES = [
  { name: 'Gel manicure', price_cents: 4000, description: null, confidence: '0.95' },
  { name: 'Ligne floue', price_cents: 100, description: null, confidence: '0.3' },
];

async function monter({ lignes = LUES }: { lignes?: typeof LUES } = {}) {
  const envois: string[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const chemin = String(url);
      const methode = (init?.method ?? 'GET').toUpperCase();
      if (methode !== 'GET') envois.push(`${methode} ${chemin.replace('https://api.test', '')}`);

      if (chemin.endsWith('/menu-imports/uploads')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ file_key: 'photos/cartes/b1/x', mime_type: 'image/jpeg' }),
        } as Response;
      }
      if (chemin.endsWith('/menu-imports') && methode === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'imp1', lignes: [] }) } as Response;
      }
      if (chemin.endsWith('/extract')) {
        return { ok: true, status: 200, json: async () => ({ id: 'imp1', lignes }) } as Response;
      }
      if (chemin.endsWith('/validate')) {
        return { ok: true, status: 200, json: async () => ({ items_crees: 2 }) } as Response;
      }
      // **Une prestation, et c'est ce qui met l'écran dans son état normal.**
      // Un catalogue vide rend l'état vide, qui ne porte ni le bouton de
      // composition ni celui d'import : le test s'y serait éprouvé sur un écran
      // que le salon ne voit qu'une fois.
      if (chemin.includes('/catalog-items')) {
        return { ok: true, status: 200, json: async () => [DEJA] } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    }) as unknown as typeof fetch,
  });

  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api}>
          <CatalogueScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { envois };
}

describe('importer une carte depuis les prestations', () => {
  it('offre l’import à côté de la composition à la main, jamais à sa place', async () => {
    // **Une option, et l'ordre le dit.** La composition à la main marche sans
    // réseau, sans carte imprimée et sans modèle : elle reste le premier
    // bouton. Un import qui la remplacerait ferait dépendre le premier
    // catalogue d'un salon de la lisibilité de sa carte.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ajouter-une-prestation')).toBeTruthy());

    expect(screen.getByTestId('importer-une-carte')).toHaveTextContent(
      en.composition.importerUneCarte,
    );
  });

  it('dépose, fait lire, et ouvre la relecture', async () => {
    const { envois } = await monter();
    await waitFor(() => expect(screen.getByTestId('importer-une-carte')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('importer-une-carte'));
    await fireEvent.press(screen.getByTestId('carte-depuis-la-pellicule'));

    await waitFor(() => expect(screen.getByTestId('relecture-de-la-carte')).toBeTruthy());

    // **Les trois appels, dans l'ordre.** S'arrêter au dépôt rendrait un écran
    // qui n'a l'air de rien manquer.
    expect(envois).toEqual([
      'POST /api/v1/business/b1/menu-imports/uploads',
      'POST /api/v1/business/b1/menu-imports',
      'POST /api/v1/business/b1/menu-imports/imp1/extract',
    ]);

    // Et ce que le modèle a lu est bien ce qu'on relit.
    expect(screen.getByTestId('nom-lu-0').props.value).toBe('Gel manicure');
    expect(screen.getByTestId('confiance-basse-1')).toBeTruthy();
  });

  it('le PDF passe par le sélecteur de fichiers, la photo par la pellicule', async () => {
    // **Deux sources, parce que l'iPhone en a deux.** Le sélecteur d'images ne
    // rend pas de PDF et le sélecteur de fichiers ne montre pas la pellicule :
    // un bouton unique enverrait chercher au mauvais endroit la moitié du
    // temps. Le décor divergent est celui-ci — une implémentation qui n'aurait
    // qu'une source passerait les deux tests du dessus.
    await monter();
    await waitFor(() => expect(screen.getByTestId('importer-une-carte')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('importer-une-carte'));
    await fireEvent.press(screen.getByTestId('carte-depuis-les-fichiers'));

    await waitFor(() => expect(screen.getByTestId('relecture-de-la-carte')).toBeTruthy());

    const picker = require('expo-document-picker') as { getDocumentAsync: jest.Mock };
    expect(picker.getDocumentAsync).toHaveBeenCalled();
    // Le PDF est demandé nommément : sans lui, le sélecteur les grise.
    expect(picker.getDocumentAsync.mock.calls[0][0].type).toContain('application/pdf');
  });

  it('rien n’entre au catalogue avant la validation', async () => {
    // La règle du dépôt, tenue de bout en bout : ouvrir la relecture ne crée
    // aucune prestation. Seul le dernier bouton écrit.
    const { envois } = await monter();
    await waitFor(() => expect(screen.getByTestId('importer-une-carte')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('importer-une-carte'));
    await fireEvent.press(screen.getByTestId('carte-depuis-la-pellicule'));
    await waitFor(() => expect(screen.getByTestId('relecture-de-la-carte')).toBeTruthy());

    expect(envois.some((e) => e.includes('/validate'))).toBe(false);
    expect(envois.some((e) => e.includes('/catalog-items'))).toBe(false);

    await fireEvent.changeText(screen.getByTestId('duree-lue-0'), '45');
    await fireEvent.changeText(screen.getByTestId('duree-lue-1'), '30');
    await fireEvent.press(screen.getByTestId('valider-la-carte'));

    await waitFor(() => expect(envois.some((e) => e.includes('/validate'))).toBe(true));
  });

  it('une carte illisible le dit, et laisse la composition à la main', async () => {
    // **Le vide est un symptôme ici, pas un résultat.** Un salon devant un
    // écran muet croit à une panne et rappelle le support ; la phrase dit quoi
    // faire, et le retour ramène là où le travail se fait à la main.
    await monter({ lignes: [] });
    await waitFor(() => expect(screen.getByTestId('importer-une-carte')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('importer-une-carte'));
    await fireEvent.press(screen.getByTestId('carte-depuis-la-pellicule'));

    await waitFor(() => expect(screen.getByTestId('carte-illisible')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('quitter-la-relecture'));
    await waitFor(() => expect(screen.getByTestId('ajouter-une-prestation')).toBeTruthy());
  });
});
