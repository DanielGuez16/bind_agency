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
import { ExceptionDuJour } from '../src/screens/journee/ExceptionDuJour';
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

/**
 * **Le bandeau « vous êtes en ligne » n'existe plus, et ses tests partent avec
 * lui.** Quatrième reprise de la journée : il confirmait un état permanent à
 * quelqu'un qui ouvre l'écran pour agir. Ce qui l'éprouvait — la fenêtre de
 * sept jours, la portée locale, les trois branches de pluriel — n'a plus
 * d'objet ; le garder ferait vivre une épreuve sans sujet, ce qui est la
 * définition d'un test qui passe sans rien vérifier.
 */

/**
 * La confirmation des sept premiers jours.
 *
 * **La date est servie depuis peu**, et c'est elle qui donne une origine à la
 * règle. Ce que la planche voulait avec — « 41 créatrices peuvent vous
 * réserver » — n'est toujours pas servi ; la ligne s'arrête donc à ce qui est
 * vrai.
 */

/**
 * Le commerce suspendu, et ce qu'il doit encore.
 *
 * **L'écran disait « il reste deux points avant que les créatrices vous
 * voient » à un salon suspendu.** Cocher les deux n'aurait rien changé : ce qui
 * retient n'est pas la composition, c'est une décision prise sur lui.
 */
describe('suspendu', () => {
  const SUSPENDU = {
    status: 'suspended' as const,
    en_ligne_depuis: null,
    etapes: [ETAPE('address', true), ETAPE('cover_photo', false)],
    suspension_motif: 'paused_by_business' as const,
    suspendu_depuis: '2026-08-20T14:00:00Z',
  };

  it('n’est pas une publication en attente, et dit ce qui reste dû', () => {
    // **Le décor divergent porte une étape non faite.** Sans elle, « suspendu »
    // et « prêt » rendraient la même chose, et le test passerait sur un calcul
    // qui ne regarde toujours que « actif ou non ».
    expect(miseEnLigne(SUSPENDU)).toEqual({
      forme: 'suspendu',
      motif: 'paused_by_business',
      depuis: '2026-08-20T14:00:00Z',
    });
  });
});


/**
 * Le motif porte la sortie, et les deux ne se lèvent pas de la même façon.
 *
 * **Le décor divergent est celui du serveur qui n'a pas encore les champs.**
 * Sans lui, « je lis le motif » et « je suppose la pause » rendraient le même
 * verdict — la pause est la valeur qu'on croise le plus, et un écran qui la
 * poserait par défaut passerait tous les cas qu'on aurait pensé à écrire.
 */
describe('pourquoi le salon est dehors', () => {
  const BASE = {
    status: 'suspended' as const,
    en_ligne_depuis: null,
    etapes: [ETAPE('address', true)],
  };

  it('la grâce expirée n’est pas une pause', () => {
    expect(
      miseEnLigne({ ...BASE, suspension_motif: 'grace_expired', suspendu_depuis: null }),
    ).toEqual({ forme: 'suspendu', motif: 'grace_expired', depuis: null });
  });

  it('une réponse d’avant les deux champs rend quand même un bandeau', () => {
    // Le cache d'application garde des réponses des heures durant : la
    // contrainte de table garantit le motif côté serveur, elle ne garantit rien
    // de ce que l'écran tient en main.
    expect(miseEnLigne(BASE)).toEqual({ forme: 'suspendu', motif: null, depuis: null });
  });
});


/**
 * Le repliable de l'exception ne s'ouvre jamais sur rien.
 *
 * **La flèche tournait et ne dépliait rien.** Deux causes, et la même forme :
 * `ExceptionDuJour` rendait `null` pendant ses deux requêtes — et il ne se
 * monte qu'au moment où l'on ouvre, donc c'était le cas normal du premier
 * appui — puis `null` encore quand `placesDuJour` ne trouve aucune règle pour
 * ce jour, c'est-à-dire sur un jour fermé dans la semaine type. La seconde ne
 * se résout pas en attendant : le bloc restait vide pour toujours.
 *
 * **Le décor divergent est un jour fermé**, pas un jour vide : sur un jour
 * ouvert les deux implémentations rendent la même chose.
 */
describe('l’exception du jour, quand il n’y a rien à couper', () => {
  async function monter(regles: unknown[]) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async (url: RequestInfo | URL) => ({
        ok: true,
        status: 200,
        json: async () => (String(url).includes('capacity-exceptions') ? [] : regles),
      })) as unknown as typeof fetch,
    });
    return await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={api}>
            <ExceptionDuJour
              businessId="b1"
              // Un mardi.
              jour="2026-08-18"
              postesEffectifs={2}
              onFait={() => {}}
            />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
  }

  it('un jour fermé dans la semaine type le dit, au lieu de s’ouvrir sur le vide', async () => {
    // Aucune règle pour le mardi : le salon est fermé ce jour-là.
    await monter([{ weekday: 3, opens_at: '09:00', closes_at: '19:00', postes: 2 }]);
    await waitFor(() =>
      expect(screen.getByTestId('exception-sans-objet')).toBeTruthy(),
    );
    expect(screen.getByText(en.commerce.exceptionJourFerme)).toBeTruthy();
  });

  it('et un jour ouvert propose bien le geste', async () => {
    await monter([{ weekday: 2, opens_at: '09:00', closes_at: '19:00', postes: 2 }]);
    await waitFor(() => expect(screen.getByTestId('ajuster-aujourdhui')).toBeTruthy());
    expect(screen.queryByTestId('exception-sans-objet')).toBeNull();
  });
});
