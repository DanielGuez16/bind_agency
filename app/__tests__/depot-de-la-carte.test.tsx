/**
 * Le dépôt de la carte, côté commerce.
 *
 * Ce que la composition du lot 4 ajoute au mécanisme déjà éprouvé ailleurs,
 * c'est **ce que l'écran dit avant qu'on agisse** : combien de prestations sont
 * retenues et lesquelles, combien de pages restent, et que l'une des deux
 * formes suffit. Trois phrases, et chacune évite un aller-retour.
 *
 * Les trois sont éprouvées dans les deux sens. Un bandeau d'avertissement qui
 * ne sait pas disparaître est le même défaut qu'un bandeau qui n'apparaît
 * pas : dans un cas le commerce ne sait pas qu'il bloque quelque chose, dans
 * l'autre il croit bloquer après avoir déposé sa carte, et il cherche.
 */
import { render, screen, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type PageDeLaCarte } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { CarteDuCommerce } from '../src/screens/CarteDuCommerce';
import { ThemeProvider } from '../src/theme';

const PAGES: PageDeLaCarte[] = [
  { id: 'c1', storage_key: 'cartes/b1/1.jpg', position: 0, alt_text: null },
  { id: 'c2', storage_key: 'cartes/b1/2.jpg', position: 1, alt_text: null },
];

const BLOQUEES = [
  { id: 's1', name: 'Color, your choice of shade' },
  { id: 's2', name: 'Facial, your choice of protocol' },
];

function client() {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response,
  });
}

async function monter({
  pages = [] as PageDeLaCarte[],
  lien = null as string | null,
  bloquees = BLOQUEES,
} = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={client()}>
          <CarteDuCommerce
            businessId="b1"
            pages={pages}
            lien={lien}
            bloquees={bloquees}
            onChange={jest.fn()}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('le blocage se dit en tête, et il nomme ses prestations', () => {
  it('apparaît quand rien n’est déposé, et nomme chacune', async () => {
    await monter();

    const bandeau = screen.getByTestId('carte-blocage');
    // Le compte, puis les noms. « 2 prestations » sans lesquelles oblige à
    // aller les chercher sur un autre écran, et c'est le geste qu'on ne fait pas.
    expect(within(bandeau).getByText(/2/)).toBeTruthy();
    for (const prestation of BLOQUEES) {
      expect(screen.getByTestId(`bloquee-${prestation.id}`)).toHaveTextContent(prestation.name);
    }
  });

  it('dit « une prestation » au singulier, parce que c’est le cas courant', async () => {
    // Le dépôt n'a pas de machinerie de pluriel — le produit choisit entre deux
    // clés là où ça compte. Ici ça compte : un salon qui n'a qu'une prestation
    // à choix est le cas fréquent, pas le cas limite, et « 1 services » est ce
    // qu'il lit sur son premier écran.
    await monter({ bloquees: [BLOQUEES[0]] });

    const bandeau = screen.getByTestId('carte-blocage');
    expect(within(bandeau).queryByText(/^1 /)).toBeNull();
    expect(within(bandeau).getByText(en.composition.carteBloqueUne)).toBeTruthy();
  });

  it('repasse au pluriel au-delà d’une', async () => {
    await monter();
    expect(within(screen.getByTestId('carte-blocage')).getByText(/^2 /)).toBeTruthy();
  });

  it('tombe dès qu’une page existe', async () => {
    await monter({ pages: PAGES });
    expect(screen.queryByTestId('carte-blocage')).toBeNull();
  });

  it('tombe dès qu’un lien existe, sans page', async () => {
    // La règle du serveur est « l'une des deux formes » ; l'écran ne doit pas en
    // inventer une plus sévère. Un commerce qui a renseigné son lien et voit
    // toujours l'avertissement conclut que son lien n'a pas été pris.
    await monter({ lien: 'https://salon.example/menu' });
    expect(screen.queryByTestId('carte-blocage')).toBeNull();
  });

  it('reste absent quand aucune prestation ne laisse de choix', async () => {
    // Sur un salon dont tout le catalogue est fixe, un avertissement permanent
    // serait du bruit sur un écran qu'il n'a aucune raison d'ouvrir.
    await monter({ bloquees: [] });
    expect(screen.queryByTestId('carte-blocage')).toBeNull();
  });
});

describe('les deux autres phrases', () => {
  it('le compte des pages se lit avant que la borne se subisse', async () => {
    await monter({ pages: PAGES });
    expect(screen.getByTestId('compte-des-pages')).toHaveTextContent('2 / 8');
  });

  it('« l’un ou l’autre » vit entre les deux formes, jamais sous l’une d’elles', async () => {
    // Écrite sous les pages, la phrase dirait « les pages suffisent » ; sous le
    // champ, l'inverse. Sa position **est** son sens, donc elle s'éprouve.
    const { toJSON } = await monter({ pages: PAGES });

    // L'ordre de rendu, lu sur l'arbre : c'est l'ordre dans lequel l'écran se
    // parcourt, et c'est le seul ordre qui compte pour une phrase de séparation.
    const rangs = new Map<string, number>();
    type Noeud = { props?: Record<string, unknown>; children?: unknown[] };
    const parcourir = (noeud: Noeud | null) => {
      if (!noeud) return;
      const id = noeud.props?.testID;
      if (typeof id === 'string' && !rangs.has(id)) rangs.set(id, rangs.size);
      for (const enfant of noeud.children ?? []) {
        if (enfant && typeof enfant === 'object') parcourir(enfant as Noeud);
      }
    };
    parcourir(toJSON() as Noeud | null);

    const filet = rangs.get('l-un-ou-l-autre')!;
    expect(filet).toBeGreaterThan(rangs.get('ajouter-une-page')!);
    expect(filet).toBeLessThan(rangs.get('champ-lien-de-la-carte')!);
  });
});
