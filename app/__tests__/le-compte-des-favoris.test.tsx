/**
 * Le compte sur la porte des favoris, et ce qu'un cœur dit quand il échoue.
 *
 * **Ce qui manquait n'était pas le mécanisme, c'était le retour.** Le geste
 * part, le serveur l'accepte, la liste le relit — vérifié bout à bout dans un
 * vrai navigateur. Mais sur le fil, un appui réussi ne changeait **rien** de
 * visible hors de la carte touchée, et un appui raté ne changeait rien du
 * tout : le cœur se remplissait, revenait, et le produit se taisait. Les deux
 * se lisent de la même façon — « il ne s'est rien passé ».
 *
 * **Le compte vient du serveur, et le décor l'éprouve là où les deux
 * implémentations divergent.** Un compte dérivé du fil rendu serait faux de
 * deux façons : il oublierait les favoris hors du rayon courant, et il
 * changerait en marchant. Les décors ci-dessous servent donc un total qui **ne
 * correspond pas** au nombre de cœurs pleins à l'écran ; c'est le seul montage
 * où l'on distingue les deux.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { FilScreen } from '../src/screens/FilScreen';
import { ThemeProvider } from '../src/theme';
import { reponseQuiNArrivePas } from '../test-support/reponseQuiNArrivePas';

/**
 * La pastille, **cachée de l'arbre d'accessibilité et cherchée quand même**.
 *
 * Le nom du bouton porte déjà le compte : un lecteur d'écran qui annoncerait
 * « favoris, 4 » puis « 4 » répéterait. La pastille est donc masquée pour lui,
 * ce qui la sort des requêtes par défaut de la bibliothèque — d'où cette aide,
 * qui dit pourquoi plutôt que de laisser chercher.
 */
const pastille = () =>
  screen.queryByTestId('compte-des-favoris', { includeHiddenElements: true });

function salon(rang: number, estFavori = false) {
  return {
    business_id: `b${rang}`,
    name: `Salon ${rang}`,
    category: 'beauty',
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
        name: `Prestation ${rang}`,
        description: null,
        price_cents: 4500,
        currency: 'USD',
        duration_minutes: 45,
        requires_booking: true,
        photo_key: null,
        platform: 'instagram',
        content_format: 'story',
        value_ratio: null,
        est_favori: estFavori,
      },
    ],
  };
}

function fil(extra: Partial<Fil> = {}, commerces = [salon(1), salon(2)]) {
  return {
    commerces,
    obstacles: [],
    rayon_metres: 15_000,
    total_prestations: commerces.length,
    categories: [],
    rayons: [],
    quartiers: [{ quartier: 'wynwood', commerces: 2, prestations: 2, distance_metres: 200 }],
    favoris_total: 0,
    prochain_palier: null,
    ...extra,
  } as unknown as Fil;
}

/**
 * Le décor répond **par chemin**, et l'écriture des favoris peut échouer seule.
 *
 * Un décor qui rendrait le fil à toutes les routes n'éprouverait rien de ce
 * qui suit : c'est le refus du `POST` qui sépare « le produit se tait » de
 * « le produit le dit ».
 */
async function monter({
  donnees = fil(),
  favoriEchoue = false,
  favoriSansReponse = false,
}: { donnees?: Fil; favoriEchoue?: boolean; favoriSansReponse?: boolean } = {}) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/me/favorites')) {
        if (favoriSansReponse) return reponseQuiNArrivePas(init);
        if (favoriEchoue) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ detail: 'internal_error' }),
          } as Response;
        }
        return { ok: true, status: 204, json: async () => null } as Response;
      }
      return { ok: true, status: 200, json: async () => donnees } as Response;
    }) as unknown as typeof fetch,
  });

  const vue = await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onVoirMesFavoris={() => {}}
            onOuvrirLeCommerce={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('barre-du-mur')).toBeTruthy());
  return vue;
}

describe('le compte sur la porte des favoris', () => {
  it('vient du serveur, et non des cœurs pleins à l’écran', async () => {
    // **Le cas où les deux divergent, et c'est celui qu'on écrit en premier.**
    // Trois favoris gardés, aucun dans le rayon courant : un compte dérivé du
    // fil rendu écrirait « 0 » à côté d'une porte qui en ouvre trois. Et il
    // changerait de quartier en quartier, ce qui est la pire façon de se
    // tromper — un chiffre qui bouge sans qu'on ait rien fait.
    await monter({ donnees: fil({ favoris_total: 3 }) });

    await waitFor(() => expect(pastille()!).toBeTruthy());
    expect(pastille()!).toHaveTextContent(/^3$/);
    expect(screen.getByTestId('apercu-o1-coeur').props.accessibilityState?.selected).toBe(false);
  });

  it('et zéro ne s’écrit pas', async () => {
    // Une pastille à zéro apprend à ne plus regarder la pastille, et c'est le
    // seul endroit du fil qui dise qu'un appui a été enregistré.
    await monter({ donnees: fil({ favoris_total: 0 }) });

    expect(pastille()).toBeNull();
  });

  it('il monte à l’appui, sans attendre la réponse', async () => {
    // **Le décor divergent est une réponse qui ne vient pas.** Avec un double
    // qui répond tout de suite, « compter puis appeler » et « appeler puis
    // compter » rendent le même écran.
    await monter({ donnees: fil({ favoris_total: 2 }), favoriSansReponse: true });

    await fireEvent.press(await screen.findByTestId('apercu-o1-coeur'));

    expect(pastille()!).toHaveTextContent(/^3$/);
  });

  it('et revenir sur son propre appui le ramène où il était', async () => {
    // **C'est ce que l'état servi paie.** Sans lui, le second appui compterait
    // comme un retrait de plus et la porte annoncerait un favori de moins
    // qu'avant qu'on y touche.
    await monter({ donnees: fil({ favoris_total: 2 }), favoriSansReponse: true });

    const coeur = await screen.findByTestId('apercu-o1-coeur');
    await fireEvent.press(coeur);
    expect(pastille()!).toHaveTextContent(/^3$/);

    await fireEvent.press(screen.getByTestId('apercu-o1-coeur'));
    expect(pastille()!).toHaveTextContent(/^2$/);
  });

  it('retirer un favori servi le fait descendre', async () => {
    // L'autre sens, et il n'est pas symétrique dans le code : l'écart part du
    // total servi, donc un retrait doit le décrémenter et non l'ignorer.
    await monter({
      donnees: fil({ favoris_total: 2 }, [salon(1, true), salon(2)]),
      favoriSansReponse: true,
    });

    await fireEvent.press(await screen.findByTestId('apercu-o1-coeur'));

    expect(pastille()!).toHaveTextContent(/^1$/);
  });
});

describe('un cœur qui échoue le dit', () => {
  it('il nomme la prestation, plutôt que de se taire', async () => {
    // **C'est le défaut signalé.** Le retour en arrière était muet : rien ne
    // distinguait « je n'ai pas su enregistrer » de « tu n'as pas appuyé », ce
    // qui se lit comme « les favoris ne marchent pas » — et ne laisse rien à
    // réessayer.
    await monter({ donnees: fil({ favoris_total: 0 }), favoriEchoue: true });

    await fireEvent.press(await screen.findByTestId('apercu-o1-coeur'));

    await waitFor(() => expect(screen.getByTestId('favori-non-enregistre')).toBeTruthy());
    expect(screen.getByTestId('favori-non-enregistre')).toHaveTextContent(/Prestation 1/);
  });

  it('et le compte ne garde pas ce qui n’a pas été enregistré', async () => {
    // Un compte qui resterait à un après l'échec serait un mensonge de plus,
    // et le pire : celui qui affirme qu'on a réussi.
    await monter({ donnees: fil({ favoris_total: 0 }), favoriEchoue: true });

    await fireEvent.press(await screen.findByTestId('apercu-o1-coeur'));

    await waitFor(() => expect(screen.getByTestId('favori-non-enregistre')).toBeTruthy());
    expect(pastille()).toBeNull();
  });

  it('rien ne s’affiche tant que rien n’a échoué', async () => {
    // Sans ce sens, une bande affichée en permanence passerait les deux tests
    // du dessus sans rien éprouver.
    await monter({ donnees: fil({ favoris_total: 1 }) });

    expect(screen.queryByTestId('favori-non-enregistre')).toBeNull();
  });
});

describe('les deux libellés de la porte', () => {
  it('le nom du bouton porte le compte, pas seulement la pastille', async () => {
    // Un chiffre posé à côté d'une icône n'existe pas pour un lecteur d'écran,
    // et c'est justement l'information qui dit qu'il s'est passé quelque chose.
    await monter({ donnees: fil({ favoris_total: 4 }) });

    expect(screen.getByTestId('voir-mes-favoris').props.accessibilityLabel).toBe(
      en.parcours.filVoirMesFavorisCompte.replace('{{count}}', '4'),
    );
  });

  it('et sans favori il redevient le nom simple', async () => {
    await monter({ donnees: fil({ favoris_total: 0 }) });

    expect(screen.getByTestId('voir-mes-favoris').props.accessibilityLabel).toBe(
      en.parcours.filVoirMesFavoris,
    );
  });
});
