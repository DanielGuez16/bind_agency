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

/** Le compte, dans la pilule de la porte. Absent quand il n'y a rien. */
const pastille = () => screen.queryByTestId('compte-des-favoris');

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
    // **Servi, et compté comme le serveur le compte** : par article distinct,
    // jamais par offre. Le poser à `items.length` referait dans le décor la
    // faute que la route a corrigée, et le test la validerait.
    prestations_ouvertes: 1,
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
  donneesVariables,
}: {
  donnees?: Fil;
  /** Relu à chaque requête : c'est ce qui permet d'éprouver un rechargement. */
  donneesVariables?: () => Fil;
} = {}) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => donneesVariables?.() ?? donnees,
      }) as Response) as unknown as typeof fetch,
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
            versionDesFavoris={0}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('barre-du-mur')).toBeTruthy());
  return { ...vue, client: api, vue };
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
    expect(pastille()).toHaveTextContent(/^3$/);
    // **Et aucune carte ne porte de cœur.** Le compte de la porte ne se
    // dérive donc d'aucun signe présent à l'écran : c'est la seule source, et
    // c'est ce que ce test fixe.
    expect(screen.queryAllByTestId(/-coeur$/)).toHaveLength(0);
  });

  it('et zéro ne s’écrit pas', async () => {
    // Une pastille à zéro apprend à ne plus regarder la pastille, et c'est le
    // seul endroit du fil qui dise qu'un appui a été enregistré.
    await monter({ donnees: fil({ favoris_total: 0 }) });

    expect(pastille()).toBeNull();
  });

  it('il se relit quand un cœur a bougé ailleurs', async () => {
    // **Le cœur a quitté le fil en v4** : il vit sur la fiche, ligne par ligne.
    // Le compte, lui, reste ici — et la pile garde cet écran monté sous celui
    // qu'on ouvre, donc rien ne le rafraîchirait au retour. La version est le
    // signal ; le serveur reste seul à savoir le nombre.
    let servi = 2;
    const vue = await monter({ donneesVariables: () => fil({ favoris_total: servi }) });
    await waitFor(() => expect(pastille()).toHaveTextContent(/^2$/));

    servi = 3;
    // On remonte l'écran avec la version suivante : c'est ce que la pile fait
    // en quittant une fiche où quelque chose a changé.
    await vue.rerender(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={vue.client}>
            <FilScreen
              position={{ longitude: -80.19, latitude: 25.76 }}
              onDemanderLaPosition={() => {}}
              onVoirMesFavoris={() => {}}
              onOuvrirLeCommerce={() => {}}
              versionDesFavoris={1}
            />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(pastille()).toHaveTextContent(/^3$/));
  });

  it('et il ne redemande rien tant que la version ne bouge pas', async () => {
    // Le sens inverse : un écran qui redemanderait à chaque rendu ferait une
    // requête de fil par frappe dans la recherche.
    let servi = 2;
    const vue = await monter({ donneesVariables: () => fil({ favoris_total: servi }) });
    await waitFor(() => expect(pastille()).toHaveTextContent(/^2$/));

    servi = 9;
    await vue.rerender(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={vue.client}>
            <FilScreen
              position={{ longitude: -80.19, latitude: 25.76 }}
              onDemanderLaPosition={() => {}}
              onVoirMesFavoris={() => {}}
              onOuvrirLeCommerce={() => {}}
              versionDesFavoris={0}
            />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(pastille()).toHaveTextContent(/^2$/));
  });
});

describe('la porte se remplit quand il y a quelque chose derrière', () => {
  it('le cœur est plein avec un compte, vide sans', async () => {
    // **Le remplissage n'y dit pas « celui-ci est gardé »**, comme sur une
    // ligne de prestation : il dit qu'il y a quelque chose derrière la porte.
    //
    // **Le remplissage se lit sur le tracé, pas sur le compte à côté.** Un
    // test qui n'assertait que la pastille laissait passer un cœur resté en
    // contour avec « 3 » écrit dessous — vérifié par mutation, il survivait.
    // **On lit le remplissage sur le tracé, à travers le rendu.** L'icône est
    // décorative — `accessibilityElementsHidden` —, donc hors des requêtes par
    // défaut ; et le nœud qui porte `fill` est le `RNSVGPath`, deux crans sous
    // le `Svg`. Rempli, `fill` porte une couleur ; en contour, il est nul.
    const rempli = () => {
      let noeud = screen.getByTestId('coeur-de-la-porte', { includeHiddenElements: true });
      while (noeud.children.length > 0) noeud = noeud.children[0] as typeof noeud;
      return noeud.props.fill !== null;
    };

    const avec = await monter({ donnees: fil({ favoris_total: 3 }) });
    await waitFor(() => expect(screen.getByTestId('voir-mes-favoris')).toBeTruthy());
    expect(pastille()).toHaveTextContent(/^3$/);
    expect(rempli()).toBe(true);
    await avec.vue.unmount();

    await monter({ donnees: fil({ favoris_total: 0 }) });
    await waitFor(() => expect(screen.getByTestId('voir-mes-favoris')).toBeTruthy());
    expect(pastille()).toBeNull();
    expect(rempli()).toBe(false);
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
