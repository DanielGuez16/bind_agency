/**
 * Un envoi ne part qu'au premier plan, et s'arrête s'il le quitte.
 *
 * **Un envoi en arrière-plan qui échoue laisse croire qu'il a fini.** C'est la
 * pire des issues parce qu'elle ne se signale jamais : la créatrice range son
 * téléphone en pensant sa contrepartie tenue, et l'apprend au délai dépassé.
 * Couper est moins bon qu'aboutir, et infiniment meilleur que mentir.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useEnvoiDeFichier } from '../src/shell/useEnvoiDeFichier';

/** Le dernier écouteur posé par le crochet, pour lui rendre un changement d'état. */
function poserAppState() {
  const ecouteurs: ((etat: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, ecouteur) => {
    ecouteurs.push(ecouteur as (etat: string) => void);
    return { remove: () => {} } as never;
  });
  return (etat: string) => ecouteurs.forEach((e) => e(etat));
}

afterEach(() => jest.restoreAllMocks());

it('coupe l’envoi quand l’application quitte le premier plan, et garde le fichier', async () => {
  const changer = poserAppState();
  const vue = await renderHook(() => useEnvoiDeFichier());

  let signalVu: AbortSignal | null = null;
  const envoi = vue.result.current
      .envoyer('file:///photo.jpg', (_, signal) => {
        signalVu = signal;
        // Ne se règle jamais de lui-même : c'est le départ du premier plan qui
        // doit trancher, et un double qui répond tout de suite ne l'éprouverait
        // pas — il rendrait le même verdict avec ou sans la règle.
        return new Promise((_r, rejeter) => signal.addEventListener('abort', () => rejeter(new Error('coupé'))));
      })
      .catch(() => {});

  await waitFor(() => expect(vue.result.current.enVol).toBe(true));
  await act(async () => {
    changer('background');
    await envoi;
  });

  expect(signalVu?.aborted).toBe(true);
  expect(vue.result.current.enVol).toBe(false);
  expect(vue.result.current.interrompu).toBe(true);
  // Le fichier survit : c'est ce qui décide si l'on réessaie ou si l'on
  // abandonne, et l'interruption pose la même question qu'un échec.
  expect(vue.result.current.aRenvoyer).toBe('file:///photo.jpg');
});

it('et ne part pas du tout depuis l’arrière-plan', async () => {
  // **Le cas où les deux implémentations divergent.** Couper ce qui est en vol
  // sans refuser ce qui démarre laisserait passer un geste posé pendant que
  // l'application se range — et personne n'en lirait l'issue.
  poserAppState();
  // `currentState` est une propriété simple, pas un accesseur : on la pose.
  const avant = AppState.currentState;
  (AppState as { currentState: string }).currentState = 'background';
  const vue = await renderHook(() => useEnvoiDeFichier());

  const appels: number[] = [];
  await act(async () => {
    await vue.result.current.envoyer('file:///photo.jpg', async () => {
      appels.push(1);
    });
  });

  expect(appels).toHaveLength(0);
  expect(vue.result.current.interrompu).toBe(true);
  expect(vue.result.current.aRenvoyer).toBe('file:///photo.jpg');
});
