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
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { messageDePosition } from '../src/shell/messageDePosition';
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

  it('ne prend pas une plateforme muette pour un refus', async () => {
    // Ni service ni matériel : il n'y a aucun réglage à aller chercher.
    lire.mockRejectedValue(new Error('module absent'));

    const vue = await presser();

    await waitFor(() => expect(vue.result.current.etat.etat).toBe('indisponible'));
  });
});

describe('ce que l’écran dit de chaque état', () => {
  it('ne propose de redemander que là où la fenêtre s’ouvrira', () => {
    // La règle, en une assertion. Un bouton sur `refusee` serait un bouton qui
    // ne fait rien — le défaut qu'on répare.
    const avecBouton: EtatDePosition['etat'][] = ['jamais_demandee', 'indisponible'];
    const sansBouton: EtatDePosition['etat'][] = ['refusee', 'en_cours'];

    for (const etat of avecBouton) {
      expect(messageDePosition({ etat } as EtatDePosition)?.action).not.toBeNull();
    }
    for (const etat of sansBouton) {
      const message = messageDePosition(
        etat === 'refusee' ? { etat, ouReactiver: 'navigateur' } : ({ etat } as EtatDePosition),
      );
      expect(message?.action).toBeNull();
    }
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
