/**
 * Le cœur a quitté le fil, et il vit sur la fiche.
 *
 * **Parce que le favori porte sur la prestation.** Le fil rend une carte par
 * salon depuis la v4 : un cœur posé sur un contenant de quatre prestations ne
 * désignerait rien. La fiche est l'écran où l'on choisit une prestation, donc
 * c'est là que l'interrupteur se pose — ligne par ligne, sur les deux
 * ensembles.
 *
 * **Sur les fermées aussi, et c'est le cas qui le justifie.** Garder une
 * prestation qu'on ne peut pas encore réserver est exactement ce à quoi sert
 * l'avis de réouverture : sans cœur sur cette moitié, la seule chose qu'on
 * puisse mettre de côté serait ce qu'on peut déjà prendre.
 *
 * Ces quatre premiers tests viennent du fil, où ils éprouvaient le même
 * comportement sur l'autre grain. Ils ont suivi le cœur.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type FichePublique } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { FicheScreen } from '../src/screens/FicheScreen';
import { ThemeProvider } from '../src/theme';
import { reponseQuiNArrivePas } from '../test-support/reponseQuiNArrivePas';

const OFFRE = {
  tier_offer_id: 'o1',
  catalog_item_id: 'i1',
  tier_id: 't1',
  name: 'Gel manicure',
  description: null,
  price_cents: 4500,
  currency: 'USD',
  duration_minutes: 45,
  requires_booking: true,
  photo_key: null,
  leaves_choice: false,
  platform: 'instagram',
  content_format: 'story',
  required_mention: null,
  required_geotag: false,
  value_ratio: null,
  accessible: true,
  social_account_id: 's1',
  obstacles: [] as unknown[],
  est_favori: false,
  prochains_creneaux: [] as string[],
};

const FERMEE_SANS_COMPTE = {
  ...OFFRE,
  tier_offer_id: 'o9',
  catalog_item_id: 'i9',
  name: 'Full set, sculpted',
  platform: 'tiktok',
  accessible: false,
  social_account_id: null,
  obstacles: [{ raison: 'no_social_account', requis: null, constate: null, ecart: null, depuis: null }],
};

function fiche(offres: unknown[] = [OFFRE]): FichePublique {
  return {
    business_id: 'b1',
    name: 'Vela Nail Studio',
    category: 'beauty',
    address: '120 NE 41st St, Wynwood',
    timezone: 'America/New_York',
    phone: null,
    cover_photo_key: null,
    photos: [] as string[],
    menu_pages: [] as string[],
    menu_url: null,
    horaires: [] as unknown[],
    offres,
  } as unknown as FichePublique;
}

/**
 * Le décor répond **par méthode**, et l'écriture peut traîner ou refuser.
 *
 * Un décor qui rendrait la fiche à tout n'éprouverait rien de ce qui suit :
 * c'est le sort du `POST` qui sépare « rempli avant la réponse » de « rempli
 * après », et « le produit le dit » de « le produit se tait ».
 */
async function monter({
  offres = [OFFRE] as unknown[],
  surFavori,
  onFavoriBascule,
  onConnecterUnReseau,
}: {
  offres?: unknown[];
  surFavori?: (init?: RequestInit) => Response | Promise<Response>;
  onFavoriBascule?: () => void;
  onConnecterUnReseau?: () => void;
} = {}) {
  const appels: { url: string; methode: string }[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const methode = (init?.method ?? 'GET').toUpperCase();
      appels.push({ url: String(url), methode });
      if (String(url).includes('/me/favorites')) {
        return surFavori?.(init) ?? ({ ok: true, status: 204, json: async () => null } as Response);
      }
      return { ok: true, status: 200, json: async () => fiche(offres) } as Response;
    }) as unknown as typeof fetch,
  });

  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FicheScreen
            businessId="b1"
            onReserver={() => {}}
            onFavoriBascule={onFavoriBascule}
            onConnecterUnReseau={onConnecterUnReseau}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { appels, vue };
}

describe('le cœur se remplit avant la réponse', () => {
  it('rempli avant la réponse, et non après', async () => {
    // **Le décor divergent est une réponse qui ne vient pas.** Avec un double
    // qui répond tout de suite, « remplir puis appeler » et « appeler puis
    // remplir » rendent le même écran — la mutation qui attendait la réponse a
    // d'abord survécu ici.
    const { appels } = await monter({ surFavori: (init) => reponseQuiNArrivePas(init) });

    const coeur = await screen.findByTestId('offre-o1-coeur');
    // **`checked`, parce que le cœur se déclare `switch`.** Il annonçait
    // `selected`, que React Native ne rend en aucun attribut pour ce rôle : un
    // lecteur d'écran lisait « garder en favori » sans jamais dire si le cœur
    // était posé. Ce test lisait `selected` lui aussi, donc il passait — il
    // vérifiait la même valeur fausse des deux côtés.
    expect(coeur.props.accessibilityRole).toBe('switch');
    expect(coeur.props.accessibilityState?.checked).toBe(false);

    await fireEvent.press(coeur);

    expect(screen.getByTestId('offre-o1-coeur').props.accessibilityState?.checked).toBe(true);
    expect(appels.some((a) => a.methode === 'POST' && a.url.includes('/me/favorites'))).toBe(true);
  });

  it('et il revient en arrière si le serveur refuse', async () => {
    const { appels } = await monter({
      surFavori: () =>
        ({ ok: false, status: 500, json: async () => ({ detail: 'internal_error' }) }) as Response,
    });

    await fireEvent.press(await screen.findByTestId('offre-o1-coeur'));

    await waitFor(() =>
      expect(screen.getByTestId('offre-o1-coeur').props.accessibilityState?.checked).toBe(false),
    );
    expect(appels.some((a) => a.methode === 'POST')).toBe(true);
  });

  it('et il le dit, en nommant la prestation', async () => {
    // Le retour en arrière était muet sur le fil, et c'est ce qui a fait lire
    // « les favoris ne marchent pas » : le geste rate *et* le produit se tait.
    await monter({
      surFavori: () =>
        ({ ok: false, status: 500, json: async () => ({ detail: 'internal_error' }) }) as Response,
    });

    await fireEvent.press(await screen.findByTestId('offre-o1-coeur'));

    await waitFor(() => expect(screen.getByTestId('favori-non-enregistre')).toBeTruthy());
    expect(screen.getByTestId('favori-non-enregistre')).toHaveTextContent(/Gel manicure/);
  });

  it('un cœur déjà plein se retire, et par la route qui retire', async () => {
    const { appels } = await monter({ offres: [{ ...OFFRE, est_favori: true }] });

    const coeur = await screen.findByTestId('offre-o1-coeur');
    expect(coeur.props.accessibilityState?.checked).toBe(true);

    await fireEvent.press(coeur);

    expect(screen.getByTestId('offre-o1-coeur').props.accessibilityState?.checked).toBe(false);
    await waitFor(() =>
      expect(appels.some((a) => a.methode === 'DELETE' && a.url.includes('/me/favorites/i1'))).toBe(
        true,
      ),
    );
  });

  it('rien ne s’annonce : le cœur qui se remplit est la confirmation', async () => {
    // Pas de bandeau « ajouté aux favoris ». C'est la règle 3 de l'attente :
    // un résultat qui apparaît **est** la confirmation.
    await monter();

    await fireEvent.press(await screen.findByTestId('offre-o1-coeur'));

    expect(screen.queryByText(/added/i)).toBeNull();
    expect(screen.queryByTestId('favori-non-enregistre')).toBeNull();
  });

  it('et le fil est prévenu, une fois la réponse acquise', async () => {
    // Le compte de la porte du fil est servi par le fil, et la pile garde cet
    // écran monté dessous : sans ce signal, il resterait celui du dernier
    // chargement.
    const bascules: number[] = [];
    await monter({ onFavoriBascule: () => bascules.push(1) });

    await fireEvent.press(await screen.findByTestId('offre-o1-coeur'));

    await waitFor(() => expect(bascules).toHaveLength(1));
  });
});

describe('le cœur vit aussi sur ce qui n’est pas encore ouvert', () => {
  it('une prestation fermée se garde, et c’est le cas qui justifie l’avis', async () => {
    // **Le décor sépare les deux implémentations** : un écran qui ne poserait
    // le cœur que sur les réservables passerait tous les tests du dessus, où
    // tout est ouvert.
    const { appels } = await monter({ offres: [OFFRE, FERMEE_SANS_COMPTE] });

    await waitFor(() => expect(screen.getByTestId('offre-o9-coeur')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('offre-o9-coeur'));

    expect(screen.getByTestId('offre-o9-coeur').props.accessibilityState?.checked).toBe(true);
    await waitFor(() =>
      expect(appels.some((a) => a.methode === 'POST' && a.url.includes('/me/favorites'))).toBe(true),
    );
  });
});

describe('ce qu’un compte connecté rapporterait', () => {
  it('le nombre, le réseau, et le geste', async () => {
    // **Ce n'est plus un refus, c'est deux réservations de plus.** Un testeur a
    // lu « trois services » sur le fil et quatre sur la fiche : la quatrième
    // était ouverte au palier TikTok, et il n'a pas de compte TikTok.
    const branchements: number[] = [];
    await monter({
      offres: [OFFRE, FERMEE_SANS_COMPTE],
      onConnecterUnReseau: () => branchements.push(1),
    });

    await waitFor(() => expect(screen.getByTestId('connecter-tiktok')).toBeTruthy());
    expect(screen.getByTestId('connecter-tiktok')).toHaveTextContent(/TikTok/);
    expect(screen.getByTestId('connecter-tiktok')).toHaveTextContent(/\b1\b/);

    await fireEvent.press(screen.getByTestId('connecter-tiktok-action'));
    expect(branchements).toHaveLength(1);
  });

  it('rien quand ce qui ferme ne tient pas à un compte', async () => {
    // Des abonnés qui manquent ne se branchent pas : proposer un geste qui n'y
    // peut rien serait pire que de se taire. C'est le sens inverse, et sans lui
    // un écran qui afficherait toujours le bloc passerait le test du dessus.
    await monter({
      offres: [
        OFFRE,
        {
          ...FERMEE_SANS_COMPTE,
          obstacles: [
            { raison: 'not_enough_followers', requis: 5000, constate: 1200, ecart: 3800, depuis: null },
          ],
        },
      ],
    });

    await waitFor(() => expect(screen.getByTestId('offres-fermees')).toBeTruthy());
    expect(screen.queryByTestId('comptes-qui-ouvriraient')).toBeNull();
  });

  it('et le libellé nomme le réseau, jamais « connecte un compte »', async () => {
    // Un geste qui ne nomme pas sa destination fait chercher laquelle des trois
    // plateformes on lui demande.
    await monter({ offres: [OFFRE, FERMEE_SANS_COMPTE], onConnecterUnReseau: () => {} });

    await waitFor(() => expect(screen.getByTestId('connecter-tiktok-action')).toBeTruthy());
    expect(screen.getByTestId('connecter-tiktok-action')).toHaveTextContent(
      new RegExp(en.parcours.ficheConnecter.replace('{{reseau}}', 'TikTok')),
    );
  });
});
