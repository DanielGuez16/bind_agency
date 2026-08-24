/**
 * Les trois minuteurs qui empêchaient un worker Jest de sortir.
 *
 * **« A worker process has failed to exit gracefully » sortait à chaque
 * exécution de la suite**, depuis assez longtemps pour qu'on ait cessé de le
 * lire. Il est sans conséquence visible — la suite passe — et c'est ce qui le
 * rend coûteux : tant qu'il sort toujours, il ne dit plus rien le jour où une
 * vraie fuite arrive.
 *
 * ## Ce qui avait empêché de le trouver
 *
 * L'enquête précédente concluait « ce n'est pas un fichier » parce que
 * l'avertissement disparaît à `--maxWorkers=1`. **Le raisonnement était
 * invalide** : à un worker, Jest s'exécute *en bande*, dans le processus
 * principal, et il n'y a alors aucun worker qui puisse échouer à sortir. La
 * disparition ne disait rien du coupable — elle disait qu'il n'y avait plus de
 * worker. `--detectOpenHandles` force le même mode : il ne nommait rien parce
 * qu'en bande il n'y avait rien à nommer.
 *
 * Ce qui force le mode worker sur deux fichiers seulement — donc ce qui rend le
 * défaut bisectable — est `--no-cache` : sans horodatage en cache, Jest ne peut
 * plus décider que la série sera courte et rapide, et il fait tourner ses
 * workers. À partir de là, chaque fichier passe seul avec un fichier propre, et
 * cinq fichiers sur cent deux ont répondu.
 *
 * ## Compter les minuteurs, pas tous les minuteurs
 *
 * `jest.getTimerCount()` compte aussi ceux de React Native — sept restaient
 * après un démontage parfaitement propre. Un test qui exige zéro là-dessus est
 * un test qui échoue pour une raison qu'il ne nomme pas. On ne suit donc que
 * les minuteurs **de la durée qu'on éprouve**, posés et éteints, ce qui est la
 * seule question posée ici.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { ApiClient, ApiProvider, type Collaboration } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { PreuveScreen } from '../src/screens/PreuveScreen';
import { DELAI_DE_RELEVE_MS, usePosition } from '../src/shell/usePosition';
import { ThemeProvider } from '../src/theme';
import { reponseQuiNArrivePas } from '../test-support/reponseQuiNArrivePas';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const lire = Location.getForegroundPermissionsAsync as jest.Mock;
const relever = Location.getCurrentPositionAsync as jest.Mock;

const coffre = { lire: async () => null, ecrire: async () => {} };

/**
 * Les minuteurs d'une durée donnée, encore en vol.
 *
 * **Reconnus par leur durée et non par leur rang d'appel** : le rang change dès
 * qu'une ligne s'ajoute au-dessus, la durée dit ce qu'on éprouve.
 */
function suivreLesMinuteurs(duree: number) {
  const enVol = new Set<unknown>();
  const vraiPoser = global.setTimeout;
  const vraiEteindre = global.clearTimeout;

  const poser = jest.spyOn(global, 'setTimeout').mockImplementation(((
    rappel: () => void,
    pendant?: number,
    ...reste: unknown[]
  ) => {
    const poigne = (vraiPoser as (...a: never[]) => unknown)(
      rappel as never,
      pendant as never,
      ...(reste as never[]),
    );
    if (pendant === duree) enVol.add(poigne);
    return poigne;
  }) as unknown as typeof setTimeout);

  const eteindre = jest.spyOn(global, 'clearTimeout').mockImplementation(((poigne: unknown) => {
    enVol.delete(poigne);
    return (vraiEteindre as (...a: never[]) => unknown)(poigne as never);
  }) as unknown as typeof clearTimeout);

  return {
    enVol,
    arreter: () => {
      poser.mockRestore();
      eteindre.mockRestore();
    },
  };
}

describe('l’échéance du client ne retient pas le processus', () => {
  it('elle est posée sans référence, et c’est ce qui laissait sortir le worker', async () => {
    // **Une écriture n'est liée à aucun démontage.** L'annulation éteint le
    // minuteur par le `finally` du client, mais rien n'annule un `POST` dont la
    // réponse n'arrive pas — et c'est exactement le décor qui sépare
    // l'optimiste de l'attente sur le cœur et sur les favoris. Le minuteur
    // pendait alors quinze secondes après la fin du test.
    const suivi = suivreLesMinuteurs(9_000);
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      delaiMs: 9_000,
      fetchImpl: ((_url: RequestInfo | URL, init?: RequestInit) =>
        reponseQuiNArrivePas(init)) as unknown as typeof fetch,
    });

    void api.request('/me/favorites', { methode: 'POST', corps: {} }).catch(() => {});
    await act(async () => {});
    suivi.arreter();

    const echeances = [...suivi.enVol];
    expect(echeances).toHaveLength(1);
    // `hasRef` n'existe que sous Node — c'est-à-dire ici, et c'est là que la
    // question se pose. Sur le web et en React Native le minuteur est un
    // nombre, `unref` n'existe pas, et l'appel est sans effet.
    expect((echeances[0] as { hasRef(): boolean }).hasRef()).toBe(false);
  });

  it('et une annulation la rejette, ce qu’un double sans signal ne fait jamais', async () => {
    // **Le décor divergent, et c'est celui-là qu'on écrit en premier.** Avec
    // `new Promise(() => {})`, la requête annulée ne se rejette pas et ce test
    // n'aboutirait pas du tout. Un double qui ignore son signal ne modélise pas
    // un réseau lent, il modélise un `fetch` que personne n'écrit.
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      fetchImpl: ((_url: RequestInfo | URL, init?: RequestInit) =>
        reponseQuiNArrivePas(init)) as unknown as typeof fetch,
    });

    const horloge = new AbortController();
    const requete = api.request('/me/favorites', { signal: horloge.signal });
    horloge.abort();

    await expect(requete).rejects.toBeDefined();
  });
});

describe('la position n’oublie plus son minuteur', () => {
  it('elle l’éteint dès que la course est jouée', async () => {
    // **Le décor rend la position tout de suite.** Une plateforme qui ne répond
    // jamais laisse le minuteur courir pour de bonnes raisons ; ce qui était
    // faux est qu'il courait *aussi* quand la course était déjà gagnée — dix
    // secondes de plus après une position arrivée en une milliseconde.
    // La forme entière de ce que la plateforme rend : `granted` est le champ
    // que le code lit, et un décor sans lui ferait échouer par le mauvais bout.
    lire.mockResolvedValue({ status: 'granted', canAskAgain: true, granted: true, expires: 'never' });
    relever.mockResolvedValue({ coords: { latitude: 25.8, longitude: -80.2 } });

    const suivi = suivreLesMinuteurs(DELAI_DE_RELEVE_MS);
    const vue = await renderHook(() => usePosition());
    await act(async () => {
      vue.result.current.demander();
    });
    await act(async () => {});
    suivi.arreter();

    // Il a bien été posé — sans ce constat, un ensemble vide serait aussi vrai
    // d'un relevé qui n'a jamais eu lieu.
    expect(vue.result.current.etat.etat).toBe('accordee');
    expect([...suivi.enVol]).toEqual([]);
  });
});

describe('le bouton « copié » éteint son retour', () => {
  const ECHEANCE = new Date(Date.now() + 40 * 3_600_000).toISOString();
  const CONTREPARTIE = {
    id: 'k1',
    booking_id: 'b1',
    tier_id: 't1',
    required_format: 'story',
    required_mention: '@velanailstudio',
    required_geotag: true,
    deadline_at: ECHEANCE,
    status: 'pending',
    attempts_count: 0,
    needs_human_review: false,
    approved_at: null,
    proofs: [],
  } as unknown as Collaboration;

  it('quand on quitte l’écran avant les deux secondes', async () => {
    // Posé dans le geste, rien ne l'éteignait : quitter l'écran dans les deux
    // secondes écrivait dans un composant démonté, et le minuteur tenait le
    // processus ouvert jusqu'au bout.
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre,
      fetchImpl: (async () =>
        ({ ok: true, status: 200, json: async () => CONTREPARTIE }) as Response) as never,
    });

    const vue = await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={api}>
            <PreuveScreen collaborationId="k1" />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    const suivi = suivreLesMinuteurs(2_000);
    await fireEvent.press(await screen.findByTestId('contrat-mention-copier'));
    await act(async () => {});
    // Le minuteur existe bien : sans ce constat, l'ensemble vide du dessous
    // serait vrai d'un écran qui n'a jamais rien posé.
    expect(suivi.enVol.size).toBe(1);

    await vue.unmount();
    suivi.arreter();
    expect([...suivi.enVol]).toEqual([]);
  });
});
