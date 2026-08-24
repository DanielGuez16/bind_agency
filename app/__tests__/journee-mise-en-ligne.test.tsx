/**
 * La mise en ligne, et l'exception du jour : deux états sur l'écran du matin.
 *
 * **« On ne sait pas à quoi ça sert » — parce que ce n'était pas un écran.** La
 * mise en ligne était un onglet, avec un titre à comprendre. Ce qu'elle portait
 * est un état : une liste de ce qui manque, qui n'a d'utilité que là où le salon
 * regarde déjà, et qui doit disparaître une fois remplie.
 *
 * **Ce que ces tests éprouvent d'abord est le calcul**, parce que c'est la seule
 * chose ici qui puisse être fausse plutôt que laide. Deux implémentations
 * fausses passeraient un décor recopié de la planche : celle qui compte toutes
 * les étapes non faites comme bloquantes, et celle qui prend le nombre de la
 * semaine type pour le nombre du jour. Les cas ci-dessous les font diverger.
 */
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type EtapeActivation } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { BandeauDeMiseEnLigne } from '../src/screens/journee/BandeauDeMiseEnLigne';
import { placesDuJour } from '../src/screens/journee/exception';
import { miseEnLigne } from '../src/screens/journee/miseEnLigne';
import { ThemeProvider } from '../src/theme';

const ETAPE = (cle: EtapeActivation['cle'], done: boolean, blocking = true): EtapeActivation => ({
  cle,
  done,
  blocking,
});

describe('ce qui manque avant que les créatrices voient le salon', () => {
  it('publié : plus rien à dire', () => {
    expect(miseEnLigne({ status: 'active', en_ligne_depuis: null, etapes: [ETAPE('address', true)] })).toEqual({
      forme: 'publie',
    });
  });

  it('seules les étapes bloquantes retiennent la publication', () => {
    // **Le cas qui diverge de « compte tout ce qui n'est pas fait ».** Une
    // étape de visibilité non faite pèse sur les murs une fois publié ; la
    // compter ici ferait attendre le salon derrière une condition qui ne le
    // retient pas.
    const etat = miseEnLigne({
      status: 'draft',
      en_ligne_depuis: null,
      etapes: [
        ETAPE('address', true),
        ETAPE('catalog_item', true),
        ETAPE('capacity_rule', true),
        ETAPE('tier_offer', true),
        ETAPE('cover_photo', false, false),
        ETAPE('coordinates', false, false),
      ],
    });
    expect(etat).toEqual({ forme: 'prete', faites: 4, total: 6 });
  });

  it('et le compte porte sur toutes les étapes, pas sur les seules bloquantes', () => {
    // « 4 sur 6 » compte ce qui est fait de bout en bout. Le restreindre aux
    // bloquantes annoncerait « 4 sur 4 » à un salon qui a encore deux points.
    const etat = miseEnLigne({
      status: 'draft',
      en_ligne_depuis: null,
      etapes: [
        ETAPE('address', true),
        ETAPE('catalog_item', false),
        ETAPE('cover_photo', true, false),
      ],
    });
    expect(etat).toMatchObject({ forme: 'incomplet', faites: 2, total: 3 });
  });

  it('sans état servi, aucun bandeau', () => {
    // Un bandeau posé au hasard vaut moins que pas de bandeau : sans l'état, on
    // ne sait pas si le salon est publié.
    expect(miseEnLigne(null)).toBeNull();
    expect(miseEnLigne(undefined)).toBeNull();
    expect(miseEnLigne({ status: 'draft' } as never)).toBeNull();
  });
});

describe('les places du jour, et le repère de la semaine', () => {
  const REGLE = (weekday: number, places: number) => ({
    id: `r${weekday}`,
    business_id: 'b1',
    weekday,
    start_time: '09:00',
    end_time: '19:00',
    concurrent_slots: places,
  });

  // Le 18 août 2026 est un mardi — jour 2.
  const MARDI = '2026-08-18';

  it('sans règle ce jour-là, aucun bloc', () => {
    // Le salon est fermé ce jour dans sa semaine type : couper une place n'a
    // rien à couper, et le geste qui vaut est d'ouvrir le jour.
    expect(
      placesDuJour({ jour: MARDI, regles: [REGLE(1, 2)], exceptions: [], postesEffectifs: null }),
    ).toBeNull();
  });

  it('deux plages le même jour ne font pas deux capacités', () => {
    // Le salon qui ferme entre midi et deux a deux règles le mardi ; c'est la
    // plus large qui dit combien de créatrices sont servies en même temps.
    const etat = placesDuJour({
      jour: MARDI,
      regles: [REGLE(2, 2), { ...REGLE(2, 3), id: 'r2b', start_time: '14:00' }],
      exceptions: [],
      postesEffectifs: null,
    });
    expect(etat).toMatchObject({ dansLaSemaine: 3, places: 3 });
  });

  it('le nombre du jour vient du serveur, pas de la semaine', () => {
    // **Le cas qui diverge de « prends le nombre de la semaine ».** Une
    // exception déjà posée coupe à une place ; afficher le nombre de la semaine
    // ferait croire qu'il n'y a rien à défaire, et on la reposerait.
    const etat = placesDuJour({
      jour: MARDI,
      regles: [REGLE(2, 3)],
      exceptions: [],
      postesEffectifs: 1,
    });
    expect(etat).toMatchObject({ places: 1, dansLaSemaine: 3 });
  });

  it('un jour fermé se dit fermé, et porte son exception', () => {
    const etat = placesDuJour({
      jour: MARDI,
      regles: [REGLE(2, 3)],
      exceptions: [
        {
          id: 'e1',
          business_id: 'b1',
          date: MARDI,
          is_closed: true,
          start_time: null,
          end_time: null,
          concurrent_slots: null,
        },
      ],
      postesEffectifs: 0,
    });
    expect(etat).toMatchObject({ ferme: true, exceptionId: 'e1' });
  });

  it('et le jour de la semaine se lit en UTC, jamais sur l’horloge locale', () => {
    // **Ce que ce test garde vraiment.** J'avais d'abord écrit qu'il protégeait
    // le passage de minuit à midi ; la mutation a montré que non — les deux
    // tombent dans la même journée UTC, `getUTCDay` ignorant le fuseau. Ce
    // qu'il attrape est `getDay()` à la place de `getUTCDay()`, et le décor est
    // choisi pour ça : sur une machine à décalage négatif, minuit UTC le
    // 1er mars est encore le 28 février au soir — un samedi, pas un dimanche.
    const etat = placesDuJour({
      jour: '2026-03-01',
      // Dimanche est le jour 0 ; samedi serait 6, et n'a pas de règle ici.
      regles: [REGLE(0, 2)],
      exceptions: [],
      postesEffectifs: null,
    });
    expect(etat).toMatchObject({ dansLaSemaine: 2 });
  });
});

describe('le bandeau, à l’écran', () => {
  async function monter(activation: unknown) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async () =>
        ({ ok: true, status: 200, json: async () => ({}) }) as Response) as unknown as typeof fetch,
    });
    return await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={api}>
            <BandeauDeMiseEnLigne
              businessId="b1"
              timezone="America/New_York"
          activation={activation as never}
              onPublie={() => {}}
            />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
  }

  it('nomme ce qui manque, et compte ce qui est fait', async () => {
    await monter({
      status: 'draft',
      en_ligne_depuis: null,
      etapes: [
        ETAPE('address', true),
        ETAPE('catalog_item', true),
        ETAPE('capacity_rule', true),
        ETAPE('tier_offer', true),
        ETAPE('cover_photo', false),
        ETAPE('coordinates', false),
      ],
    });
    await waitFor(() => expect(screen.getByTestId('bandeau-mise-en-ligne')).toBeTruthy());

    expect(screen.getByTestId('manque-cover_photo')).toBeTruthy();
    expect(screen.getByTestId('manque-coordinates')).toBeTruthy();
    expect(screen.getByTestId('compte-mise-en-ligne')).toHaveTextContent(/4/);
    // **Ce qui est fait ne s'énumère pas.** Quatre coches au-dessus de deux
    // manques diluent exactement ce qu'on vient lire.
    expect(screen.queryByTestId('manque-address')).toBeNull();
  });

  it('le nombre est celui des manques, jamais « deux » en dur', async () => {
    // La planche écrit « two things left » parce que sa maquette en a deux ; à
    // trois manques la phrase serait fausse.
    await monter({
      status: 'draft',
      en_ligne_depuis: null,
      etapes: [ETAPE('address', false), ETAPE('coordinates', false), ETAPE('cover_photo', false)],
    });
    await waitFor(() => expect(screen.getByTestId('bandeau-mise-en-ligne')).toBeTruthy());

    expect(within(screen.getByTestId('bandeau-mise-en-ligne')).getByText(/3 things/)).toBeTruthy();
  });

  it('tout étant fait, il porte le geste — sans le mot « go live »', async () => {
    // Publier reste un appel explicite côté serveur : le dernier point coché ne
    // publie pas, il rend la publication possible.
    await monter({ status: 'draft', en_ligne_depuis: null, etapes: [ETAPE('address', true)] });
    await waitFor(() => expect(screen.getByTestId('publier-le-commerce')).toBeTruthy());

    expect(screen.queryByText(/go live/i)).toBeNull();
  });

  it('compte les étapes, sans pourcentage', async () => {
    // Un compte, pas un pourcentage : « 67 % » ne dit pas ce qu'il reste à
    // faire, et il reste toujours quelque chose à faire.
    await monter({ status: 'draft', en_ligne_depuis: null, etapes: [ETAPE('address', true), ETAPE('coordinates', false)] });
    await waitFor(() => expect(screen.getByTestId('compte-mise-en-ligne')).toBeTruthy());

    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('publié mais invisible : il reste, et il le dit', async () => {
    // **Le cas que la suppression de l'écran a failli emporter.** Les étapes
    // non bloquantes ne retiennent pas la publication mais décident de la
    // visibilité : un salon en ligne sans photo de couverture n'apparaît dans
    // aucun mur, et rien d'autre ne le lui dirait.
    await monter({
      status: 'active',
      en_ligne_depuis: null,
      etapes: [ETAPE('address', true), ETAPE('cover_photo', false, false)],
    });
    await waitFor(() => expect(screen.getByTestId('bandeau-mise-en-ligne')).toBeTruthy());

    expect(screen.getByTestId('manque-cover_photo')).toBeTruthy();
    // Le compte disparaît : après publication ce n'est plus une progression,
    // c'est un manque.
    expect(screen.queryByTestId('compte-mise-en-ligne')).toBeNull();
    expect(screen.queryByTestId('publier-le-commerce')).toBeNull();
  });

  it('tout est prêt, et le bandeau dit que rien ne part tout seul', async () => {
    // **Le dernier point coché ne publie pas.** La planche suppose l'inverse,
    // et c'est tranché : il rend la publication *possible*. Un salon choisit le
    // moment où il apparaît — c'est la seule décision du produit qui l'expose à
    // des inconnus, et elle ne se prend pas par ricochet en cochant une case de
    // capacité.
    //
    // La confusion a lieu au moment exact où tout est vert et où rien ne s'est
    // passé : c'est là que la phrase doit être, pas ailleurs.
    await monter({ status: 'draft', en_ligne_depuis: null, etapes: [ETAPE('address', true)] });
    await waitFor(() => expect(screen.getByTestId('publier-le-commerce')).toBeTruthy());

    expect(screen.getByTestId('publication-explicite')).toHaveTextContent(
      en.commerce.miseEnLigneVousChoisissez,
    );
  });

  it('et il ne le dit pas tant qu’il reste des points', async () => {
    // **Le cas où les deux implémentations divergent.** Rendre la phrase sans
    // condition passerait le test au-dessus tout aussi bien. Elle répond à
    // « pourquoi ne suis-je pas visible alors que tout est coché » : posée sur
    // un bandeau incomplet, elle répond à une question qu'on ne se pose pas
    // encore, et dilue les deux points qui restent.
    await monter({
      status: 'draft',
      en_ligne_depuis: null,
      etapes: [ETAPE('address', true), ETAPE('coordinates', false)],
    });
    await waitFor(() => expect(screen.getByTestId('bandeau-mise-en-ligne')).toBeTruthy());

    expect(screen.queryByTestId('publication-explicite')).toBeNull();
  });

  it('et publié sans rien qui manque, il n’existe plus', async () => {
    // Une liste de tâches qui reste après avoir été remplie est la définition
    // d'un écran dont on ne comprend plus l'objet.
    await monter({ status: 'active', en_ligne_depuis: null, etapes: [ETAPE('address', true)] });
    await waitFor(() => expect(screen.queryByTestId('bandeau-mise-en-ligne')).toBeNull());
  });
});

/**
 * La confirmation des sept premiers jours.
 *
 * **La date est servie depuis peu**, et c'est elle qui donne une origine à la
 * règle. Ce que la planche voulait avec — « 41 créatrices peuvent vous
 * réserver » — n'est toujours pas servi ; la ligne s'arrête donc à ce qui est
 * vrai.
 */
describe('en ligne depuis peu', () => {
  const IL_Y_A = (jours: number) =>
    new Date(Date.parse('2026-08-24T12:00:00Z') - jours * 24 * 3_600_000).toISOString();
  const MAINTENANT = Date.parse('2026-08-24T12:00:00Z');
  const PUBLIE = (depuis: string | null) => ({
    status: 'active' as const,
    en_ligne_depuis: depuis,
    etapes: [ETAPE('address', true)],
  });

  it('se confirme pendant sept jours, et se tait ensuite', () => {
    // **Les deux côtés du seuil, sur le même décor.** Un test qui n'éprouve
    // que le dedans passerait avec une confirmation qui ne s'efface jamais —
    // et une ligne qui reste après avoir été lue est un bandeau dont on ne
    // comprend plus l'objet.
    expect(miseEnLigne(PUBLIE(IL_Y_A(3)), MAINTENANT)).toEqual({
      forme: 'confirme',
      depuis: IL_Y_A(3),
    });
    expect(miseEnLigne(PUBLIE(IL_Y_A(8)), MAINTENANT)).toEqual({ forme: 'publie' });
  });

  it('et sans date, elle ne s’invente pas', () => {
    // Un salon publié avant que le journal porte la date : le bandeau retombe
    // sur le silence, qui est ce qu'il faisait déjà.
    expect(miseEnLigne(PUBLIE(null), MAINTENANT)).toEqual({ forme: 'publie' });
  });
});
