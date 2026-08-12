/**
 * La position du téléphone, pour le fil.
 *
 * **Rien n'est demandé au démarrage.** Une autorisation réclamée avant d'avoir
 * montré à quoi elle sert se refuse, et une fois refusée elle ne se redemande
 * plus. C'est l'écran qui la demande, quand il en a besoin.
 *
 * **Un refus n'est pas une panne.** On reste sans position, l'écran continue de
 * proposer. Lever ferait tomber la frontière d'erreur sur une décision
 * parfaitement légitime.
 *
 * **Mais un refus doit se voir.** Le hook avalait tout : refus, absence de
 * service, panne du relevé, tout ressortait en « pas de position », et le
 * bouton « Share my location » ne produisait plus rien du tout au second clic.
 * C'est le pire des états — l'écran propose une action, l'action ne fait rien,
 * et rien ne dit pourquoi.
 *
 * **Une autorisation refusée ne se redemande pas, elle se réactive.** Le
 * système et le navigateur ne reposent la question qu'une fois ; ensuite,
 * `requestForegroundPermissionsAsync` répond « refusé » sans rien afficher.
 * Continuer à appeler cette fonction, c'est promettre une fenêtre qui ne
 * s'ouvrira jamais. On lit donc l'état **avant** de demander, et sur un refus
 * acquis on dit où aller le lever plutôt que de rejouer une demande muette.
 *
 * **Le relevé est borné dans le temps.** `getCurrentPositionAsync` peut ne
 * jamais rendre la main — un navigateur sans capteur, un appareil dont le
 * service est éteint. Sans échéance, l'écran resterait en attente pour
 * toujours, ce qui se lit exactement comme « rien ne se passe ».
 */
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

export type Position = { longitude: number; latitude: number };

/** Où l'on va rendre une autorisation qu'on a refusée. */
export type OuReactiver = 'navigateur' | 'ios' | 'android';

export type EtatDePosition =
  /** Jamais demandée. Le seul état où la demande ouvrira une fenêtre. */
  | { etat: 'jamais_demandee' }
  | { etat: 'en_cours' }
  | { etat: 'accordee'; position: Position }
  /**
   * Refusée. `ouReactiver` dit où lever le refus : le système ne reposera pas
   * la question, et un bouton qui promettrait de la reposer mentirait.
   */
  | { etat: 'refusee'; ouReactiver: OuReactiver }
  /** Autorisée, mais le relevé n'aboutit pas : service éteint, pas de capteur. */
  | { etat: 'indisponible' };

/** Au-delà, on rend la main plutôt que de laisser l'écran en attente. */
export const DELAI_DE_RELEVE_MS = 10_000;

function ouReactiver(): OuReactiver {
  if (Platform.OS === 'web') return 'navigateur';
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/**
 * Le relevé, borné. La position gagne si elle arrive à temps.
 *
 * `Promise.race` et non un `setTimeout` qui annulerait : rien n'annule un
 * relevé en cours côté plateforme, et prétendre le faire ajouterait un
 * mensonge de plus. On cesse simplement d'attendre.
 */
async function releverAvantEcheance(): Promise<Position | null> {
  const releve = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .then((lue) => ({ longitude: lue.coords.longitude, latitude: lue.coords.latitude }))
    .catch(() => null);

  const echeance = new Promise<null>((resoudre) => {
    setTimeout(() => resoudre(null), DELAI_DE_RELEVE_MS);
  });

  return Promise.race([releve, echeance]);
}

export function usePosition() {
  const [etat, setEtat] = useState<EtatDePosition>({ etat: 'jamais_demandee' });

  const demander = useCallback(async () => {
    // Deux demandes en vol ouvriraient deux fenêtres, et la seconde réponse
    // écraserait la première.
    setEtat((precedent) => (precedent.etat === 'en_cours' ? precedent : { etat: 'en_cours' }));

    let accorde: boolean;
    try {
      // **Lire avant de demander.** Sur un refus déjà acquis, `request` répond
      // sans rien afficher : l'utilisateur presse un bouton et ne voit rien.
      const actuel = await Location.getForegroundPermissionsAsync();
      if (actuel.status === 'denied' && !actuel.canAskAgain) {
        setEtat({ etat: 'refusee', ouReactiver: ouReactiver() });
        return;
      }
      accorde = actuel.granted || (await Location.requestForegroundPermissionsAsync()).granted;
    } catch {
      // Ni service de localisation, ni matériel : rien à refuser, rien à
      // réactiver. Ce n'est pas un refus, et le dire ainsi enverrait chercher
      // un réglage qui n'existe pas.
      setEtat({ etat: 'indisponible' });
      return;
    }

    if (!accorde) {
      setEtat({ etat: 'refusee', ouReactiver: ouReactiver() });
      return;
    }

    const position = await releverAvantEcheance();
    setEtat(position === null ? { etat: 'indisponible' } : { etat: 'accordee', position });
  }, []);

  return {
    /** La position, ou `null` dans tous les autres états. */
    position: etat.etat === 'accordee' ? etat.position : null,
    etat,
    demander: () => void demander(),
  };
}
