/**
 * La liste des favoris, et ce qu'on peut en faire.
 *
 * **Le décor divergent est le salon disparu.** Une liste où le cœur ne se
 * presse pas rend un écran qui a l'air complet : les lignes sont là, les états
 * sont dits, tout se lit. Ce qu'elle interdit ne se voit qu'au bout d'un mois —
 * un salon qui ne paraît plus n'est dans aucun fil, donc son favori n'aurait
 * **jamais** pu être retiré, et la liste se remplit une fois pour toutes.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Favori } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/session';
import { FavorisScreen } from '../src/screens/FavorisScreen';
import { ThemeProvider } from '../src/theme';
import { reponseQuiNArrivePas } from '../test-support/reponseQuiNArrivePas';

function favori(extra: Partial<Favori> = {}): Favori {
  return {
    catalog_item_id: 'i1',
    business_id: 'b1',
    business_name: 'Vela Nail Studio',
    name: 'Gel manicure',
    description: null,
    duration_minutes: 45,
    price_cents: 4000,
    currency: 'USD',
    photo_key: 'photos/vela.jpg',
    etat: 'reservable',
    // **Servi, et nul par défaut.** Le serveur ne le pose que sur
    // `hors_palier` : c'est le seul état où la question se pose.
    palier_requis: null,
    ...extra,
  } as Favori;
}

const UTILISATEUR = {
  id: 'u1',
  email: 'lea@exemple.test',
  role: 'creator',
  status: 'active',
  locale: 'en',
  favoris_me_previennent: true,
};

async function monter(
  favoris: Favori[],
  surRetrait?: (init?: RequestInit) => Response | Promise<Response>,
  avisActifs = true,
  /**
   * La vue des paliers, d'où vient le chiffre de la seule ligne qui agit.
   *
   * Sans prochain palier par défaut : c'est l'état le plus fréquent — une
   * créatrice au sommet, ou dont l'écart n'est pas chiffrable — et le décor
   * doit partir de là, sans quoi chaque test hériterait d'une ligne d'écart
   * qu'il n'a pas demandée.
   */
  paliers: unknown = { prochain_palier: null },
  /**
   * Le `PATCH` ne répond jamais.
   *
   * **C'est le seul décor qui sépare les deux implémentations.** Avec un double
   * qui répond tout de suite, « basculer puis enregistrer » et « enregistrer
   * puis basculer » rendent le même écran — la même leçon que sur le cœur du
   * mur, apprise deux fois.
   */
  patchSansReponse = false,
) {
  const appels: { url: string; methode: string }[] = [];
  const ouvertures: string[] = [];
  const paliersOuverts: number[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const methode = (init?.method ?? 'GET').toUpperCase();
      appels.push({ url: String(url), methode });
      if (methode === 'DELETE') {
        return surRetrait?.(init) ?? ({ ok: true, status: 204, json: async () => null } as Response);
      }
      // **La table nommée avant le repli.** L'écran lit aussi les paliers, pour
      // chiffrer l'écart de la seule ligne qui porte un geste. Sans cette
      // branche, `/me/tiers` recevait la liste des favoris — un tableau, donc
      // `prochain_palier` valait `undefined`, donc la ligne ne se rendait
      // jamais et personne ne l'aurait vu.
      if (String(url).includes('/me/tiers')) {
        return { ok: true, status: 200, json: async () => paliers } as Response;
      }
      return { ok: true, status: 200, json: async () => favoris } as Response;
    }) as unknown as typeof fetch,
  });

  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <SessionProvider
          baseUrl="https://api.test"
          coffre={{
            lire: async () => ({ access_token: 'a', refresh_token: 'r' }),
            ecrire: async () => {},
          }}
          fetchImpl={
            (async (url: RequestInfo | URL, init?: RequestInit) => {
              const methode = (init?.method ?? 'GET').toUpperCase();
              appels.push({ url: String(url), methode });
              if (methode === 'PATCH') {
                if (patchSansReponse) return reponseQuiNArrivePas(init);
                // Le double rend ce que le serveur rendrait : la valeur qu'on
                // vient de poser. Un double qui répète l'ancienne ferait
                // revenir l'interrupteur et accuserait l'écran.
                const corps = JSON.parse(String(init?.body ?? '{}'));
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({ ...UTILISATEUR, ...corps }),
                } as Response;
              }
              return {
                ok: true,
                status: 200,
                json: async () => ({ ...UTILISATEUR, favoris_me_previennent: avisActifs }),
              } as Response;
            }) as unknown as typeof fetch
          }
        >
          <ApiProvider client={api}>
            <FavorisScreen
              onRetour={() => {}}
              onOuvrirLeCommerce={(id) => ouvertures.push(id)}
              onVoirMesPaliers={() => paliersOuverts.push(1)}
            />
          </ApiProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { appels, ouvertures, paliersOuverts };
}

describe('une prestation qui n’est plus réservable reste, avec sa raison', () => {
  it.each([
    ['fermee', /closed this one for now/i],
    ['salon_indisponible', /not listed at the moment/i],
    ['hors_palier', /a tier you do not open yet/i],
  ])('%s dit ce qu’elle appelle comme conduite', async (etat, attendu) => {
    // « Indisponible » les aurait tous couverts et n'aurait rien dit : attendre
    // la réouverture, monter d'un palier et choisir autre chose ne sont pas le
    // même geste.
    await monter([favori({ etat: etat as Favori['etat'] })]);

    expect(await screen.findByTestId('favori-etat-i1')).toHaveTextContent(attendu);
  });

  it('et la réservable ne dit rien : il n’y a rien à dire', async () => {
    // Un bandeau qui annonce que tout va bien est du bruit sur la seule ligne
    // qui n'en demande pas.
    await monter([favori({ etat: 'reservable' })]);

    await waitFor(() => expect(screen.getByTestId('favori-i1')).toBeTruthy());
    expect(screen.queryByTestId('favori-etat-i1')).toBeNull();
  });
});

describe('on peut lâcher ce qu’on a gardé', () => {
  it('le cœur retire, même quand le salon a disparu du fil', async () => {
    /**
     * **Le cas qui rendait la liste inutilisable.** Un salon en pause n'est
     * dans aucun fil : sans ce cœur, son favori n'aurait eu aucun endroit où
     * être retiré. C'est précisément l'état où la liste doit le plus servir.
     */
    const { appels } = await monter([favori({ etat: 'salon_indisponible' })]);

    await fireEvent.press(await screen.findByTestId('favori-retirer-i1'));

    await waitFor(() =>
      expect(
        appels.some((a) => a.methode === 'DELETE' && a.url.includes('/me/favorites/i1')),
      ).toBe(true),
    );
    expect(screen.queryByTestId('favori-i1')).toBeNull();
  });

  it('la ligne s’en va au doigt, sans attendre le réseau', async () => {
    // Une promesse qui ne se résout jamais sépare l'optimiste de l'attente :
    // avec un double qui répond tout de suite, les deux rendent le même écran.
    await monter([favori()], (init) => reponseQuiNArrivePas(init));

    await fireEvent.press(await screen.findByTestId('favori-retirer-i1'));

    expect(screen.queryByTestId('favori-i1')).toBeNull();
  });

  it('et elle revient si le serveur refuse', async () => {
    // Faire disparaître une ligne qu'on n'a pas su retirer serait mentir sur ce
    // qu'on a fait.
    await monter([favori()], () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'internal_error' }),
    }) as Response);

    await fireEvent.press(await screen.findByTestId('favori-retirer-i1'));

    await waitFor(() => expect(screen.getByTestId('favori-i1')).toBeTruthy());
  });

  it('et elle le dit, en nommant la prestation', async () => {
    // **Le retour en arrière était muet.** La ligne s'en allait, revenait, et
    // rien ne disait pourquoi — ce qui se lit comme un écran qui refuse le
    // geste, et fait appuyer une seconde fois. Le nom, parce qu'une liste de
    // douze favoris ne dit pas d'elle-même lequel n'est pas parti.
    await monter([favori()], () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'internal_error' }),
    }) as Response);

    await fireEvent.press(await screen.findByTestId('favori-retirer-i1'));

    await waitFor(() => expect(screen.getByTestId('favori-non-retire')).toBeTruthy());
    expect(screen.getByTestId('favori-non-retire')).toHaveTextContent(/Gel manicure/);
  });

  it('et rien ne s’affiche quand le retrait passe', async () => {
    // Sans ce sens, une bande affichée en permanence passerait le test du
    // dessus sans rien éprouver.
    await monter([favori()]);

    await fireEvent.press(await screen.findByTestId('favori-retirer-i1'));

    await waitFor(() => expect(screen.queryByTestId('favori-i1')).toBeNull());
    expect(screen.queryByTestId('favori-non-retire')).toBeNull();
  });

  it('la ligne entière ouvre le salon, y compris sur une réservable', async () => {
    const { ouvertures } = await monter([favori()]);

    await fireEvent.press(await screen.findByLabelText(/Gel manicure — Vela Nail Studio/));

    expect(ouvertures).toEqual(['b1']);
  });
});

describe('la liste se relit d’où l’on est', () => {
  it('aucune coordonnée ne part avec elle', async () => {
    // Un favori posé à Wynwood doit se relire depuis Kendall. La brancher sur
    // le rayon en ferait une seconde version du fil, qui oublie ce qu'on lui a
    // confié.
    const { appels } = await monter([favori()]);

    // **La lecture nommée, et non la première venue** : le jour où celle des
    // favoris repartirait avec une position, une assertion sur « la première »
    // pourrait porter sur une autre requête.
    const lecture = appels.find((a) => a.methode === 'GET' && a.url.includes('/me/favorites'));
    expect(lecture).toBeDefined();
    expect(lecture?.url).not.toContain('longitude');
    expect(lecture?.url).not.toContain('rayon');

    // **Et les paliers ne se lisent plus du tout.** L'écran les demandait pour
    // chiffrer un écart ; le palier requis est servi sur chaque favori depuis,
    // donc la requête a disparu — et avec elle la seule de cet écran qui
    // acceptait une position.
    expect(appels.some((a) => a.url.includes('/me/tiers'))).toBe(false);
  });
});


/**
 * Le seul réglage de notification du produit.
 *
 * **Le décor divergent est la liste vide.** Un interrupteur rendu partout donne
 * un écran qui a l'air complet : il est là, il bascule, il enregistre. Ce qu'il
 * fait alors est proposer de couper des avis dont on ne peut recevoir aucun —
 * il n'y a rien de gardé. C'est le défaut de « profil et mise en ligne » sous
 * une autre forme : un réglage dont le sujet n'est pas à l'écran.
 */
describe('l’avis de favori, et lui seul', () => {
  it('vit au-dessus de la liste, pas dans les réglages', async () => {
    await monter([favori()]);

    expect(await screen.findByTestId('avis-de-favori')).toBeTruthy();
    expect(screen.getByTestId('avis-de-favori-interrupteur').props.accessibilityState?.checked).toBe(true);
  });

  it('n’apparaît pas quand il n’y a rien de gardé', async () => {
    // Il n'y a alors rien dont on puisse être prévenu, et un interrupteur qui
    // ne gouverne rien apprend à ne plus lire les interrupteurs.
    await monter([]);

    await waitFor(() => expect(screen.getByTestId('favoris-vide')).toBeTruthy());
    expect(screen.queryByTestId('avis-de-favori')).toBeNull();
  });

  it('un seul, jamais un par favori', async () => {
    // Un par ligne recréerait, une case à la fois, le mur d'interrupteurs que
    // le produit a retiré.
    await monter([favori(), favori({ catalog_item_id: 'i2', name: 'Balayage' })]);

    await waitFor(() => expect(screen.getByTestId('favori-i2')).toBeTruthy());
    expect(screen.getAllByTestId('avis-de-favori')).toHaveLength(1);
  });

  it('bascule tout de suite, et enregistre', async () => {
    const { appels } = await monter([favori()], undefined, true, true);

    // **L'état est dans `accessibilityState.checked`.** Le composant est une
    // `Pressable`, pas un `Switch` : il n'a pas de `value` sur son nœud, et
    // c'est l'annonce d'accessibilité qui porte l'état — ce qui est le bon
    // endroit, puisque c'est là qu'une lecture d'écran va le chercher.
    await fireEvent.press(await screen.findByTestId('avis-de-favori-interrupteur'));

    // Rendu avant la réponse : un interrupteur qui attend le réseau se presse
    // deux fois, et le second appui annule le premier.
    expect(screen.getByTestId('avis-de-favori-interrupteur').props.accessibilityState?.checked).toBe(false);
    await waitFor(() =>
      expect(appels.some((a) => a.methode === 'PATCH' && a.url.endsWith('/me'))).toBe(true),
    );
  });

  it('et il part éteint quand il l’est', async () => {
    await monter([favori()], undefined, false);

    expect((await screen.findByTestId('avis-de-favori-interrupteur')).props.accessibilityState?.checked).toBe(false);
  });
});

/**
 * Une liste suffit, à une ligne près.
 *
 * **Porter le projet d'une créatrice demanderait un objectif et une date**, et
 * le produit refuse déjà de projeter un délai sur l'écran des paliers, où la
 * règle des 60 % l'interdit. Un écran de favoris qui promettrait mieux serait
 * la seule page du produit à annoncer un avenir.
 *
 * Mais une liste plate laisse sans savoir **de quel côté** vient le déblocage.
 * Une seule des trois raisons dépend de la créatrice — le palier monte avec son
 * audience — et les deux autres ne dépendent que du salon. C'est cette
 * distinction que ces tests tiennent.
 */
describe('la seule ligne qui porte un geste', () => {
  /**
   * **Le palier de la prestation, servi sur le favori.**
   *
   * Il ne se prend plus sur le prochain palier de la créatrice : les deux
   * diffèrent dès qu'une prestation n'est offerte qu'à un palier lointain, et
   * la ligne ne pouvait alors pas promettre que l'atteindre **ouvre celle-ci**.
   */
  const REQUIS = {
    tier_id: 't3',
    platform: 'instagram' as const,
    content_format: 'reel' as const,
    abonnes_manquants: 18000,
  };

  it('chiffre l’écart, dit qu’il ouvre celui-là, et mène aux paliers', async () => {
    const vue = await monter([favori({ etat: 'hors_palier', palier_requis: REQUIS })]);
    await waitFor(() => expect(screen.getByTestId('favori-ecart-i1')).toBeTruthy());

    // Le chiffre vient du serveur, pas d'un calcul refait ici.
    expect(screen.getByTestId('favori-ecart-i1')).toHaveTextContent(/18,000/);
    // **Et la promesse, qui était impossible avant.** Sans le palier de la
    // prestation, la ligne s'arrêtait sur l'écart : atteindre le prochain
    // palier de la créatrice n'ouvre pas forcément ce favori-là.
    expect(screen.getByTestId('favori-ecart-i1')).toHaveTextContent(/then it opens/i);

    await act(async () => {
      await fireEvent.press(screen.getByTestId('favori-vers-paliers-i1'));
    });
    expect(vue.paliersOuverts).toHaveLength(1);
  });

  it('et se tait quand le salon décide, pas elle', async () => {
    // **Le cas où les deux implémentations divergent.** Rendre la ligne sur
    // toute prestation non réservable passerait le test du dessus tout aussi
    // bien — et poserait un bouton là où aucun canal ne va de la créatrice vers
    // un salon. Un bouton qui n'existe pas est pire qu'un fait nu.
    for (const etat of ['salon_indisponible', 'fermee'] as const) {
      await monter([favori({ etat, palier_requis: REQUIS })]);
      await waitFor(() => expect(screen.getByTestId('favori-etat-i1')).toBeTruthy());

      expect(screen.queryByTestId('favori-ecart-i1')).toBeNull();
      expect(screen.queryByTestId('favori-vers-paliers-i1')).toBeNull();
    }
  });

  it('et se tait aussi quand l’écart n’est pas chiffrable', async () => {
    // Le serveur ne chiffre pas toujours : un jeton mort, un relevé trop
    // vieux, une revue en cours. « Il vous manque 431 200 secondes » ne veut
    // rien dire, et l'écran doit alors se taire plutôt qu'arrondir.
    await monter([
      favori({ etat: 'hors_palier', palier_requis: { ...REQUIS, abonnes_manquants: null } }),
    ]);
    await waitFor(() => expect(screen.getByTestId('favori-etat-i1')).toBeTruthy());

    expect(screen.queryByTestId('favori-ecart-i1')).toBeNull();
  });
});

describe('l’interrupteur compte ce à quoi il sert', () => {
  it('dit combien attendent', async () => {
    await monter([
      favori({ catalog_item_id: 'i1', etat: 'hors_palier' }),
      favori({ catalog_item_id: 'i2', etat: 'fermee' }),
      favori({ catalog_item_id: 'i3', etat: 'reservable' }),
    ]);
    await waitFor(() => expect(screen.getByTestId('avis-compte')).toBeTruthy());

    expect(screen.getByTestId('avis-compte')).toHaveTextContent(/\b2\b/);
  });

  it('et se tait à zéro plutôt que d’écrire « 0 »', async () => {
    // **Le cas qui fait diverger.** Un compte rendu sans condition passerait le
    // test du dessus. « 0 en attente » sur une liste entièrement réservable est
    // du bruit : le compte n'est là que pour dire qu'il y a de quoi attendre.
    await monter([favori({ etat: 'reservable' })]);
    await waitFor(() => expect(screen.getByTestId('avis-de-favori-interrupteur')).toBeTruthy());

    expect(screen.queryByTestId('avis-compte')).toBeNull();
  });
});
