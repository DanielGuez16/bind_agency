/**
 * La composition du commerce, sur grand écran.
 *
 * Relevé en campagne 2 : « trois cartes sur une page vide ». Le défaut n'est pas
 * la mise en page des cartes, c'est qu'une page entière soit dépensée pour un
 * menu. Là où la place existe, le menu devient une colonne et la section vit à
 * côté — on arrive **dans** le catalogue, pas devant une porte qui y mène.
 *
 * En compact la table des matières garde tout son sens : il n'y a pas de place
 * pour deux colonnes, et c'est alors le seul endroit d'où l'on choisit. Les deux
 * cas sont éprouvés, sinon corriger l'un casserait l'autre en silence.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import {
  CompositionDuCommerce,
  ConfigurationScreen,
} from '../src/screens/ConfigurationScreen';
import { largeurMaximale } from '../src/shell/gabarit';
import { ThemeProvider, breakpoint } from '../src/theme';

const mockGabarit = { large: true };
jest.mock('../src/shell/gabarit', () => ({
  ...jest.requireActual('../src/shell/gabarit'),
  // `place` vient de la règle elle-même : la recopier ici ferait un
  // double qui dérive le jour où le seuil bouge.
  useGabarit: () => ({
    largeur: mockGabarit.large ? 1512 : 390,
    large: mockGabarit.large,
    place: (besoin: number) =>
      (require('../src/shell/placeDisponible') as typeof import('../src/shell/placeDisponible'))
        .placeDisponible(mockGabarit.large ? 1512 : 390, besoin),
  }),
}));

beforeEach(() => {
  mockGabarit.large = true;
});

/** Ce que les trois sections demandent. Vide partout : la forme suffit ici. */
/** L'état de composition, à part : les surcharges l'étalent. */
const COMPOSITION = {
  business_id: 'b1',
  prestations: 12,
  prestations_masquees: 3,
  jours_ouverts: 6,
  en_ligne_depuis: '2026-08-03T10:00:00Z',
  status: 'active',
};

const REPONSES: Record<string, unknown> = {
  '/catalog': [],
  '/tier-offers': [],
  '/tiers': [],
  '/capacity/rules': [],
  '/capacity/exceptions': [],
  '/activation': { etapes: [{ cle: 'address', faite: true }] },
  '/composition': COMPOSITION,
};

/** Le chemin le plus spécifique d'abord : `/composition` contient `/catalog`
 *  dans aucune de ses lettres, mais `/activation` et `/capacity` se croisent
 *  vite quand la table est parcourue dans l'ordre d'insertion. */
function api(espion?: (chemin: string) => void, surcharges: Record<string, unknown> = {}) {
  const table = { ...REPONSES, ...surcharges };
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url) => {
      const chemin = String(url);
      espion?.(chemin);
      const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
      // `null` en surcharge simule une lecture qui échoue : le menu doit rester
      // utilisable, et c'est un des cas éprouvés plus bas.
      if (trouve && trouve[1] === null) {
        return { ok: false, status: 500, json: async () => ({ detail: 'boom' }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => (trouve ? trouve[1] : []),
      } as Response;
    },
  });
}

async function monter(
  noeud: React.ReactElement,
  espion?: (chemin: string) => void,
  surcharges: Record<string, unknown> = {},
) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api(espion, surcharges)}>{noeud}</ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la composition du commerce, grand écran', () => {
  it('ouvre sur une section, pas sur une page de menu', async () => {
    // Une page dont le seul rôle est de mener ailleurs coûte un clic et un
    // écran entier. La section est là dès l'arrivée.
    await monter(<CompositionDuCommerce businessId="b1" />);

    await waitFor(() => expect(screen.getByTestId('ecran-catalogue')).toBeTruthy());
    expect(screen.queryByTestId('ecran-configuration')).toBeNull();
  });

  it('garde les deux sections visibles à côté de celle qu’on lit', async () => {
    // C'est ce qui distingue une colonne d'une page de garde : elle sert à
    // changer de section, pas à être traversée une fois.
    //
    // **Deux et non trois depuis la v3.** « Profil et mise en ligne » n'était
    // pas une section : ce qu'elle portait est un état, qui vit en bandeau sur
    // la journée. La garde le vérifie dans les deux sens — les deux qui
    // restent sont là, et la troisième n'y est plus.
    await monter(<CompositionDuCommerce businessId="b1" />);

    for (const section of ['catalogue', 'horaires']) {
      expect(screen.getByTestId(`section-${section}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('section-activation')).toBeNull();
  });

  it('change de section sans quitter la colonne', async () => {
    await monter(<CompositionDuCommerce businessId="b1" />);
    await waitFor(() => expect(screen.getByTestId('ecran-catalogue')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('section-horaires'));

    await waitFor(() => expect(screen.getByTestId('ecran-horaires')).toBeTruthy());
    expect(screen.queryByTestId('ecran-catalogue')).toBeNull();
    // La colonne n'a pas bougé : on n'est pas passé par un menu.
    expect(screen.getByTestId('sections-de-configuration')).toBeTruthy();
  });

  it('marque la section lue par deux signes, jamais par la couleur seule', async () => {
    await monter(<CompositionDuCommerce businessId="b1" />);

    const style = screen.getByTestId('section-catalogue').props.style;
    expect(style.borderLeftWidth).toBe(3);
    expect(style.backgroundColor).not.toBe('transparent');
    // Et la section qu'on ne lit pas ne porte ni l'un ni l'autre.
    const autre = screen.getByTestId('section-horaires').props.style;
    expect(autre.backgroundColor).toBe('transparent');
  });
});

describe('la table des matières, en compact', () => {
  it('reste le seul endroit d’où l’on choisit', async () => {
    // Deux colonnes ne tiennent pas sur 390. Supprimer la page ici laisserait
    // le commerce sans aucun accès à ses trois sections.
    mockGabarit.large = false;
    await monter(<ConfigurationScreen onOuvrir={jest.fn()} />);

    expect(screen.getByTestId('ecran-configuration')).toBeTruthy();
    for (const porte of ['catalogue', 'horaires']) {
      expect(screen.getByTestId(`ouvrir-${porte}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('ouvrir-activation')).toBeNull();
    expect(screen.getByText(en.composition.titre)).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// l'état de chaque section, en une requête
// --------------------------------------------------------------------------

describe('l’état des sections', () => {
  it('dit où en est chaque section, chiffres à l’appui', async () => {
    // « Ce que vous proposez » ne dit pas si l'on propose quelque chose.
    await monter(<CompositionDuCommerce businessId="b1" />);

    await waitFor(() =>
      expect(screen.getByTestId('etat-catalogue')).toHaveTextContent(/12 services/),
    );
    expect(screen.getByTestId('etat-catalogue')).toHaveTextContent(/3 hidden/);
    expect(screen.getByTestId('etat-horaires')).toHaveTextContent(/6 days/);
  });

  it('ne demande qu’une seule fois ces trois nombres', async () => {
    // Trois requêtes pour afficher un menu ne se défendent pas, et la dernière
    // arrivée ferait se recomposer le menu sous les yeux de qui le lit.
    const appels: string[] = [];
    await monter(<CompositionDuCommerce businessId="b1" />, (chemin) => appels.push(chemin));
    await waitFor(() => expect(screen.getByTestId('etat-catalogue')).toBeTruthy());

    expect(appels.filter((c) => c.includes('/composition'))).toHaveLength(1);
  });

  it('tait les masquées quand il n’y en a pas', async () => {
    // « · 0 hidden » est du bruit, et il pousse la ligne sur deux hauteurs.
    await monter(<CompositionDuCommerce businessId="b1" />, undefined, {
      '/composition': { ...COMPOSITION, prestations_masquees: 0 },
    });
    await waitFor(() =>
      expect(screen.getByTestId('etat-catalogue')).toHaveTextContent(/12 services/),
    );
    expect(screen.getByTestId('etat-catalogue')).not.toHaveTextContent(/hidden/);
  });

  it('garde le menu utilisable quand la lecture échoue', async () => {
    // Un menu sans ses nombres reste un menu. « Impossible de charger » là où
    // trois portes attendent remplacerait une aide par une panne.
    await monter(<CompositionDuCommerce businessId="b1" />, undefined, { '/composition': null });
    await waitFor(() => expect(screen.getByTestId('section-catalogue')).toBeTruthy());

    expect(screen.getByTestId('etat-catalogue')).toHaveTextContent(
      en.composition.entreeCatalogueCorps,
    );
  });
});

// --------------------------------------------------------------------------
// la section occupe sa colonne
// --------------------------------------------------------------------------

describe('la place que prend une section', () => {
  it('déclare les deux sections comme telles', () => {
    // Le défaut de fond de la campagne 2 : « le contenu flotte dans de grandes
    // surfaces ». Les trois écrans se bornaient à 720 **à l'intérieur** de la
    // colonne du menu, qui avait déjà retiré la barre latérale et le rail — une
    // colonne centrée dans le reste de la place.
    //
    // Vérifié sur la source et non sur le rendu : ce qui doit tenir est qu'un
    // quatrième écran ajouté à la configuration le déclare aussi, et cela ne se
    // voit pas en montant les trois qui existent.
    for (const fichier of ['CatalogueScreen', 'HorairesScreen']) {
      const source = readFileSync(
        join(__dirname, '..', 'src', 'screens', `${fichier}.tsx`),
        'utf-8',
      );
      expect({ fichier, declare: source.includes('nature="section"') }).toEqual({
        fichier,
        declare: true,
      });
    }
  });

  it('garde leurs bornes aux écrans qui ne sont pas dans une colonne', async () => {
    // La borne du commerce n'a pas disparu : elle n'a cessé de s'appliquer
    // qu'aux écrans rendus dans une colonne qui borne déjà.
    expect(largeurMaximale('merchant', true)).toBe(breakpoint.contentMaxMerchant);
    expect(largeurMaximale('section', true)).toBeUndefined();
    // En compact, personne n'est borné : la colonne est l'écran.
    expect(largeurMaximale('merchant', false)).toBeUndefined();
  });
});
