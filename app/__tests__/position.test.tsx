/**
 * La demande de position, et ce qu'elle devient une fois répondue.
 *
 * **Le défaut : « Share my location » ne redéclenchait plus rien.** Une fois
 * l'autorisation refusée, ni le système ni le navigateur ne reposent la
 * question ; `requestForegroundPermissionsAsync` répond « refusé » sans rien
 * afficher, l'ancien code avalait la réponse, et le bouton devenait un bouton
 * qui ne fait rien. Le pire des états : l'écran propose une action, l'action
 * n'a aucun effet visible, et rien ne dit pourquoi.
 *
 * Ce qui est éprouvé ici est donc **ce que le hook rend de chaque issue**, et
 * ce que l'écran en tire : redemander là où la fenêtre s'ouvrira, dire où
 * réactiver là où elle ne s'ouvrira plus.
 *
 * **Et depuis le blocage en ligne : la demande d'autorisation elle-même.** Sur
 * le web, `requestForegroundPermissionsAsync` se règle en appelant
 * `getCurrentPosition` **sans `timeout`** — on accepte dans le navigateur, la
 * position n'arrive jamais derrière, aucun rappel n'est appelé, et la promesse
 * ne se règle pas. Le relevé était borné, la demande ne l'était pas, et l'écran
 * restait sur « Getting your location… » pour toujours, sans aucun bouton :
 * l'état `en_cours` n'en propose pas, à raison. Le rôle créateur en devenait
 * intestable.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { FilScreen } from '../src/screens/FilScreen';
import { messageDePosition } from '../src/shell/messageDePosition';
import { ThemeProvider } from '../src/theme';

const coffre = { lire: async () => null, ecrire: async () => {} };
import { usePosition, type EtatDePosition } from '../src/shell/usePosition';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const lire = Location.getForegroundPermissionsAsync as jest.Mock;
const demanderAuSysteme = Location.requestForegroundPermissionsAsync as jest.Mock;
const relever = Location.getCurrentPositionAsync as jest.Mock;

/** Ce que la plateforme rend d'un état d'autorisation. */
function autorisation({ status, canAskAgain }: { status: string; canAskAgain: boolean }) {
  return { status, canAskAgain, granted: status === 'granted', expires: 'never' };
}

const MIAMI = { coords: { longitude: -80.13, latitude: 25.79 } };

beforeEach(() => {
  jest.clearAllMocks();
  relever.mockResolvedValue(MIAMI);
});

async function presser() {
  const vue = await renderHook(() => usePosition());
  await act(async () => {
    vue.result.current.demander();
  });
  return vue;
}

describe('la demande de position', () => {
  it('ouvre la fenêtre système quand la question n’a jamais été posée', async () => {
    lire.mockResolvedValue(autorisation({ status: 'undetermined', canAskAgain: true }));
    demanderAuSysteme.mockResolvedValue(autorisation({ status: 'granted', canAskAgain: true }));

    const vue = await presser();

    expect(demanderAuSysteme).toHaveBeenCalled();
    await waitFor(() =>
      expect(vue.result.current.position).toEqual({ longitude: -80.13, latitude: 25.79 }),
    );
  });

  it('ne redemande rien au système sur un refus acquis, et dit où le lever', async () => {
    // C'est le défaut même : la demande partait, la plateforme répondait
    // « refusé » sans afficher quoi que ce soit, et l'écran ne bougeait pas.
    lire.mockResolvedValue(autorisation({ status: 'denied', canAskAgain: false }));

    const vue = await presser();

    expect(demanderAuSysteme).not.toHaveBeenCalled();
    await waitFor(() => expect(vue.result.current.etat.etat).toBe('refusee'));
    expect(vue.result.current.position).toBeNull();
  });

  it('n’appelle pas le relevé quand l’autorisation est refusée à la demande', async () => {
    // Refus donné à l'instant, dans la fenêtre : rien à relever ensuite.
    lire.mockResolvedValue(autorisation({ status: 'undetermined', canAskAgain: true }));
    demanderAuSysteme.mockResolvedValue(autorisation({ status: 'denied', canAskAgain: false }));

    const vue = await presser();

    expect(relever).not.toHaveBeenCalled();
    await waitFor(() => expect(vue.result.current.etat.etat).toBe('refusee'));
  });

  it('relève directement quand l’autorisation est déjà accordée', async () => {
    // L'autre moitié du grief : accordée, le clic ne produisait rien non plus.
    lire.mockResolvedValue(autorisation({ status: 'granted', canAskAgain: true }));

    const vue = await presser();

    expect(demanderAuSysteme).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(vue.result.current.position).toEqual({ longitude: -80.13, latitude: 25.79 }),
    );
  });

  it('distingue un relevé qui échoue d’un refus', async () => {
    // Rien n'a été refusé : envoyer chercher un réglage d'autorisation ferait
    // perdre du temps sur une piste fausse.
    lire.mockResolvedValue(autorisation({ status: 'granted', canAskAgain: true }));
    relever.mockRejectedValue(new Error('service de localisation éteint'));

    const vue = await presser();

    await waitFor(() => expect(vue.result.current.etat.etat).toBe('indisponible'));
  });

  it('ne reste pas en attente quand la plateforme ne rend jamais la main', async () => {
    // Un relevé qui ne répond pas se lit exactement comme « rien ne se passe ».
    jest.useFakeTimers();
    lire.mockResolvedValue(autorisation({ status: 'granted', canAskAgain: true }));
    relever.mockReturnValue(new Promise(() => {}));

    const vue = await renderHook(() => usePosition());
    await act(async () => {
      vue.result.current.demander();
    });
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });

    expect(vue.result.current.etat.etat).toBe('indisponible');
    jest.useRealTimers();
  });

  it('**ne reste pas en attente quand la demande d’autorisation ne répond jamais**', async () => {
    // Le blocage relevé en ligne, écrit tel qu'il se produit : la plateforme
    // ne rappelle ni le succès ni l'échec, et l'ancienne version n'atteignait
    // alors aucun `setEtat` — l'écran gardait « Getting your location… » sans
    // le moindre bouton pour en sortir.
    jest.useFakeTimers();
    lire.mockResolvedValue(autorisation({ status: 'undetermined', canAskAgain: true }));
    demanderAuSysteme.mockReturnValue(new Promise(() => {}));

    const vue = await renderHook(() => usePosition());
    await act(async () => {
      vue.result.current.demander();
    });
    expect(vue.result.current.etat.etat).toBe('en_cours');

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    expect(vue.result.current.etat.etat).toBe('sans_reponse');
    jest.useRealTimers();
  });

  it('**une seule demande en vol, même sur deux appels**', async () => {
    // L'ancienne garde comparait l'état précédent : elle dédoublonnait l'objet
    // posé, jamais l'appel. Deux `demander()` concurrents passaient tous les
    // deux, ouvraient deux fenêtres, et la seconde réponse écrasait la
    // première — alors que le commentaire affirmait le contraire.
    let repondre: ((valeur: unknown) => void) | null = null;
    lire.mockResolvedValue(autorisation({ status: 'undetermined', canAskAgain: true }));
    demanderAuSysteme.mockReturnValue(
      new Promise((resoudre) => {
        repondre = resoudre;
      }),
    );

    const vue = await renderHook(() => usePosition());
    await act(async () => {
      vue.result.current.demander();
      vue.result.current.demander();
      vue.result.current.demander();
    });

    expect(demanderAuSysteme).toHaveBeenCalledTimes(1);

    // Et le verrou se relâche : une fois répondu, une nouvelle demande passe.
    await act(async () => {
      repondre?.(autorisation({ status: 'granted', canAskAgain: true }));
    });
    await waitFor(() => expect(vue.result.current.etat.etat).toBe('accordee'));

    await act(async () => {
      vue.result.current.demander();
    });
    expect(lire).toHaveBeenCalledTimes(2);
  });

  it('le verrou se relâche même quand la plateforme lève', async () => {
    // Un verrou qui ne se relâche pas transforme un écran lent en écran mort —
    // exactement le défaut qu'on répare. Le `finally` est ce qui le garantit.
    lire.mockRejectedValue(new Error('module absent'));

    const vue = await renderHook(() => usePosition());
    await act(async () => {
      vue.result.current.demander();
    });
    await act(async () => {
      vue.result.current.demander();
    });

    expect(lire).toHaveBeenCalledTimes(2);
  });

  it('ne prend pas une plateforme muette pour un refus', async () => {
    // Ni service ni matériel : il n'y a aucun réglage à aller chercher.
    lire.mockRejectedValue(new Error('module absent'));

    const vue = await presser();

    await waitFor(() => expect(vue.result.current.etat.etat).toBe('indisponible'));
  });
});

describe('ce que l’écran dit de chaque état', () => {
  it('ne propose une action que là où elle produit quelque chose', () => {
    /**
     * **La règle a changé de bord sur deux états, et pour deux raisons
     * différentes.**
     *
     * `jamais_demandee` **perd** son bouton : le fil déclenche maintenant la
     * demande système en arrivant, et proposer « partagez votre position » juste
     * avant que le système pose la même question faisait deux demandes pour une.
     *
     * `refusee` **gagne** un « réessayer », et ce n'est pas le retour du bouton
     * qui ne faisait rien. Celui-là promettait de reposer la question au
     * système ; celui-ci ne promet que de relire l'autorisation, pour qui vient
     * de la rétablir dans ses réglages. `demander` lit avant de demander, donc
     * la promesse est tenable — et si le refus tient, on retombe sur le même
     * message.
     *
     * Ce qui n'a pas changé : `en_cours` n'a rien à presser, et le chemin vers
     * le réglage reste sur `refusee`.
     */
    const avecAction: EtatDePosition['etat'][] = ['indisponible', 'sans_reponse'];
    const sansAction: EtatDePosition['etat'][] = ['jamais_demandee', 'en_cours'];

    for (const etat of avecAction) {
      expect(messageDePosition({ etat } as EtatDePosition)?.action).not.toBeNull();
    }
    for (const etat of sansAction) {
      expect(messageDePosition({ etat } as EtatDePosition)?.action).toBeNull();
    }

    // Le refus porte les deux : le chemin d'abord, le bouton ensuite.
    const refus = messageDePosition({ etat: 'refusee', ouReactiver: 'navigateur' });
    expect(refus?.ouReactiver).not.toBeNull();
    expect(refus?.action?.cle).toBe('parcours.filReessayer');
  });

  it('ne propose jamais la première demande, puisque le fil la déclenche', () => {
    /**
     * **Le cœur du point relevé en campagne**, isolé de tout écran : deux
     * demandes pour une seule question. Celle-ci est celle qui n'apprenait
     * rien — le système nomme l'application et porte les conséquences bien mieux
     * qu'une phrase de notre part.
     *
     * Vérifié sur la clé et pas seulement sur `action === null` : un bouton qui
     * reviendrait sous un autre libellé serait la même faute.
     */
    const message = messageDePosition({ etat: 'jamais_demandee' });

    expect(message?.action).toBeNull();
    expect(JSON.stringify(message)).not.toContain('filAutoriser');
  });

  it('dit où réactiver, et l’endroit dépend de la plateforme', () => {
    // « Dans les réglages » n'aide personne : le chemin est nommé, et il n'est
    // pas le même dans un navigateur, sur iOS et sur Android.
    const chemins = (['navigateur', 'ios', 'android'] as const).map(
      (ou) => messageDePosition({ etat: 'refusee', ouReactiver: ou })?.ouReactiver,
    );

    expect(chemins.every((chemin) => chemin !== null && chemin !== undefined)).toBe(true);
    expect(new Set(chemins).size).toBe(3);
  });

  it('sépare « on vous attend » de « votre appareil n’a rien rendu »', () => {
    // Deux situations, deux phrases. « Your device didn't return a location »
    // sur une autorisation encore en attente envoyait vérifier des services de
    // localisation qui n'étaient pas en cause, et ne parlait pas de la fenêtre
    // du navigateur — la seule chose à regarder.
    const attente = messageDePosition({ etat: 'sans_reponse' });
    const muet = messageDePosition({ etat: 'indisponible' });

    expect(attente?.corps).not.toBe(muet?.corps);
    // Les deux proposent de réessayer : dans les deux cas, presser a du sens.
    expect(attente?.action).toEqual({ cle: 'parcours.filReessayer' });
    // Et ni l'un ni l'autre n'envoie chercher un réglage : rien n'a été refusé.
    expect(attente?.ouReactiver).toBeNull();
    expect(muet?.ouReactiver).toBeNull();
  });

  it('n’a rien à dire quand la position est là', () => {
    expect(
      messageDePosition({ etat: 'accordee', position: { longitude: 0, latitude: 0 } }),
    ).toBeNull();
  });

  it('nomme le navigateur sur le web, et le système ailleurs', async () => {
    // L'état porte l'endroit, et il le tient de la plateforme réelle : le
    // déduire à l'affichage obligerait chaque écran à refaire ce test.
    lire.mockResolvedValue(autorisation({ status: 'denied', canAskAgain: false }));

    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const surLeWeb = await presser();
    await waitFor(() => expect(surLeWeb.result.current.etat.etat).toBe('refusee'));
    expect(surLeWeb.result.current.etat).toEqual({ etat: 'refusee', ouReactiver: 'navigateur' });

    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const suriOS = await presser();
    await waitFor(() => expect(suriOS.result.current.etat.etat).toBe('refusee'));
    expect(suriOS.result.current.etat).toEqual({ etat: 'refusee', ouReactiver: 'ios' });

    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  });
});

// --------------------------------------------------------------------------
// la demande part du fil, et une seule fois
// --------------------------------------------------------------------------

/**
 * **Deux demandes pour une seule question, relevé en campagne.**
 *
 * Un écran demandait « partagez votre position », puis le système demandait la
 * même chose. Le fil déclenche maintenant la demande système en arrivant.
 *
 * Éprouvé sur l'écran et non sur le hook : c'est l'écran qui a la règle — le
 * hook ne demande toujours rien de lui-même, et c'est voulu.
 */
describe('le fil demande la position en arrivant', () => {
  const cadre = (etat: EtatDePosition, demander: () => void) => (
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={new ApiClient({ baseUrl: 'https://api.test', coffre, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response })}>
          <FilScreen
            position={null}
            etatDeLaPosition={etat}
            onDemanderLaPosition={demander}
            onOuvrirLeCommerce={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>
  );

  it('la déclenche sans qu’on ait rien à presser', async () => {
    const demander = jest.fn();

    await render(cadre({ etat: 'jamais_demandee' }, demander));

    await waitFor(() => expect(demander).toHaveBeenCalledTimes(1));
    // Et il n'y a pas de bouton : la question du système est la seule posée.
    expect(screen.queryByText(en.parcours.filAutoriser)).toBeNull();
  });

  it('ne la redéclenche sur aucun autre état', async () => {
    /**
     * **Le pendant, et c'est lui qui compte.** Un effet qui partirait sur
     * `refusee` rejouerait une demande que le système ne rouvre pas, à chaque
     * rendu — le défaut qu'on avait corrigé une première fois, revenu par
     * l'automatisme. Et sur `en_cours`, il doublerait une demande en vol.
     */
    for (const etat of [
      { etat: 'en_cours' },
      { etat: 'refusee', ouReactiver: 'navigateur' },
      { etat: 'indisponible' },
      { etat: 'sans_reponse' },
    ] as EtatDePosition[]) {
      const demander = jest.fn();
      await render(cadre(etat, demander));
      await waitFor(() => expect(screen.getByTestId('fil-sans-position')).toBeTruthy());
      expect(demander).not.toHaveBeenCalled();
    }
  });
});
