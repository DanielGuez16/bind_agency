/**
 * L'en-tête du mur, et le filtre qu'il commande.
 *
 * Deux choses s'éprouvent ici, et elles ne se séparent pas : ce que l'en-tête
 * **dit** — l'endroit, le rayon, son compte — et ce qu'il **fait**, c'est-à-dire
 * passer une catégorie au serveur. Une chip qui s'allume sans changer la requête
 * est exactement le défaut que le produit poursuit ailleurs : un réglage qui ne
 * commande rien fait douter de ceux qui commandent quelque chose.
 *
 * Le filtre est donc vérifié **sur l'URL réellement appelée**, jamais sur
 * l'apparence de la chip. Trois couches étaient prêtes — la route l'accepte, le
 * client sait l'envoyer, le serveur rend les comptes — et rien ne les appelait :
 * c'est précisément le genre de manque qu'aucune assertion visuelle ne trouve.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { FilScreen } from '../src/screens/FilScreen';
import { ThemeProvider } from '../src/theme';

function salon(rang: number, categorie = 'beauty') {
  return {
    business_id: `b${rang}`,
    name: `Salon ${rang}`,
    category: categorie,
    address: null,
    cover_photo_key: null,
    cover_portrait_key: null,
    neighborhood: 'wynwood',
    distance_metres: 100 * rang,
    items: [
      {
        tier_offer_id: `o${rang}`,
        catalog_item_id: `i${rang}`,
        tier_id: 't1',
        social_account_id: 's1',
        name: 'Gel manicure',
        description: null,
        price_cents: 4500,
        currency: 'USD',
        duration_minutes: 45,
        requires_booking: true,
        photo_key: null,
        platform: 'instagram',
        content_format: 'story',
        value_ratio: null,
      },
    ],
  };
}

/**
 * Deux catégories par défaut : sous deux, la rangée ne s'affiche pas, et un
 * montage à une seule catégorie ferait passer sans rien couvrir tous les tests
 * qui suivent.
 */
function fil(extra: Partial<Fil> = {}): Fil {
  return {
    commerces: [salon(1), salon(2), salon(3)],
    obstacles: [],
    rayon_metres: 15_000,
    total_prestations: 3,
    categories: [
      { categorie: 'beauty', commerces: 5, prestations: 9 },
      { categorie: 'fitness', commerces: 4, prestations: 6 },
    ],
    rayons: [],
    quartiers: [
      { quartier: 'wynwood', commerces: 2, prestations: 3, distance_metres: 200 },
      { quartier: 'brickell', commerces: 1, prestations: 1, distance_metres: 900 },
    ],
    prochain_palier: null,
    ...extra,
  } as unknown as Fil;
}

/** Monte l'écran et rend la liste des URL appelées, dans l'ordre. */
async function monter(donnees: Fil = fil()) {
  const appels: string[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url: RequestInfo | URL) => {
      appels.push(String(url));
      return { ok: true, status: 200, json: async () => donnees } as Response;
    },
  });

  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onOuvrirLeCommerce={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { vue, appels };
}

describe('ce que l’en-tête dit', () => {
  it('nomme le quartier le plus proche, et non l’écran', async () => {
    // « Near you » nommait l'endroit où l'on était dans l'application. Ce qu'on
    // veut savoir est où l'on est dans la ville.
    await monter();
    await waitFor(() => expect(screen.getByTestId('entete-quartier')).toBeTruthy());

    expect(screen.getByTestId('entete-quartier')).toHaveTextContent(en.quartiers.wynwood);
    // Le second quartier du fil n'est pas un titre : c'est le plus proche qui
    // situe, pas la liste.
    expect(screen.getByTestId('entete-quartier')).not.toHaveTextContent(en.quartiers.brickell);
  });

  it('se tait plutôt que d’inventer un nom quand aucun quartier ne répond', async () => {
    // Le sens inverse. La planche veut ici le quartier **où l'on est**, que le
    // produit ne sait pas résoudre ; le fil ne connaît que celui de ses salons.
    // Sans salon, il n'y a rien de vrai à écrire.
    await monter(fil({ commerces: [], quartiers: [] }));
    await waitFor(() => expect(screen.getByTestId('entete-du-mur')).toBeTruthy());

    expect(screen.queryByTestId('entete-quartier')).toBeNull();
  });

  it('écrit le rayon avec ce qu’il ouvre', async () => {
    await monter();
    await waitFor(() => expect(screen.getByTestId('entete-quartier')).toBeTruthy());

    const rayon = screen.getByTestId('entete-rayon');
    expect(rayon).toHaveTextContent(/\b15\b/);
    expect(rayon).toHaveTextContent(/\b3\b/);
  });

  it('et le porte déjà avant que le fil réponde, sans son compte', async () => {
    // **La navigation n'attend pas la donnée.** Le rayon est un état local : le
    // taire jusqu'à la réponse ferait apparaître l'en-tête d'un coup, ce qui
    // est le défaut que l'accueil a déjà coûté.
    const jamais = new Promise<never>(() => {});
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (() => jamais) as unknown as typeof fetch,
    });
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={api}>
            <FilScreen
              position={{ longitude: -80.19, latitude: 25.76 }}
              onDemanderLaPosition={() => {}}
              onOuvrirLeCommerce={() => {}}
            />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('etat-chargement')).toBeTruthy());
    expect(screen.getByTestId('entete-rayon')).toHaveTextContent(/\b15\b/);
    expect(screen.getByTestId('entete-marque')).toBeTruthy();
  });

  it('donne à chaque catégorie ce qu’elle ouvrirait', async () => {
    await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-beauty')).toBeTruthy());

    expect(screen.getByTestId('categorie-beauty-compte')).toHaveTextContent(/^5$/);
    expect(screen.getByTestId('categorie-fitness-compte')).toHaveTextContent(/^4$/);
    // « All » ne porte pas de nombre : il ne retire rien de ce qui est compté,
    // il retire le filtre.
    expect(screen.queryByTestId('categorie-toutes-compte')).toBeNull();
  });

  it('retire la rangée entière quand il n’y a qu’une catégorie', async () => {
    // Une chip seule à côté d'« All » est un interrupteur qui ne commande
    // rien : les deux états rendent le même mur.
    await monter(fil({ categories: [{ categorie: 'beauty', commerces: 5, prestations: 9 }] as Fil['categories'] }));
    await waitFor(() => expect(screen.getByTestId('entete-du-mur')).toBeTruthy());

    expect(screen.queryByTestId('entete-categories')).toBeNull();
    expect(screen.queryByTestId('categorie-toutes')).toBeNull();
  });

  it('garde l’en-tête sur un fil vide, d’où le filtre se relâche', async () => {
    // C'est la seule sortie d'un filtre trop étroit : si l'en-tête tombait avec
    // le contenu, un filtre qui ne rend rien serait sans retour.
    await monter(fil({ commerces: [] }));
    await waitFor(() => expect(screen.getByTestId('fil-vide')).toBeTruthy());

    expect(screen.getByTestId('categorie-toutes')).toBeTruthy();
  });
});

describe('ce que l’en-tête fait', () => {
  it('passe la catégorie choisie au serveur', async () => {
    const { appels } = await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-fitness')).toBeTruthy());
    const avant = appels.length;

    await fireEvent.press(screen.getByTestId('categorie-fitness'));

    await waitFor(() => expect(appels.length).toBeGreaterThan(avant));
    expect(appels[appels.length - 1]).toContain('categorie=fitness');
  });

  it('ne l’envoie pas tant qu’on n’a rien choisi', async () => {
    // Le sens inverse : sans lui, une implémentation qui enverrait toujours la
    // première catégorie passerait le test d'à côté.
    const { appels } = await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-fitness')).toBeTruthy());

    expect(appels.every((url) => !url.includes('categorie='))).toBe(true);
  });

  it('et réappuyer sur la catégorie en vigueur la retire', async () => {
    // Le « Clear » du cadre 03b, posé sur la chip elle-même : le geste qui a
    // filtré est celui qu'on refait pour défiltrer.
    const { appels } = await monter();
    await waitFor(() => expect(screen.getByTestId('categorie-fitness')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('categorie-fitness'));
    await waitFor(() => expect(appels[appels.length - 1]).toContain('categorie=fitness'));

    await fireEvent.press(screen.getByTestId('categorie-fitness'));
    await waitFor(() => expect(appels[appels.length - 1]).not.toContain('categorie='));
  });
});
