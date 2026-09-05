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
 *
 * **Et la demande d'autorisation l'est aussi, ce qui manquait.** C'est le
 * défaut qui a rendu le rôle créateur intestable en ligne : sur le web,
 * `requestForegroundPermissionsAsync` se résout en appelant
 * `navigator.geolocation.getCurrentPosition` **sans `timeout`**. Le navigateur
 * demande, on accepte — et si la position n'arrive jamais derrière, aucun des
 * deux rappels n'est appelé : la promesse ne se règle pas, `demander` n'atteint
 * aucun `setEtat`, et l'écran reste sur « Getting your location… » pour
 * toujours. Le relevé était borné, la *demande* ne l'était pas, et c'est elle
 * qui pend. Sur Chrome/macOS avec les services de localisation désactivés pour
 * le navigateur, c'est le cas ordinaire, pas le cas limite.
 *
 * **Deux demandes en vol ne peuvent pas exister.** Un verrou, et non une
 * comparaison d'état : l'ancienne garde comparait l'état précédent et laissait
 * passer deux appels concurrents — elle dédoublonnait l'objet d'état, pas
 * l'appel. Le commentaire affirmait pourtant l'inverse.
 *
 * **« On vous attend » n'est pas « votre appareil n'a rien rendu ».** Une
 * autorisation encore en attente n'est ni un refus ni une panne de capteur, et
 * lui donner le message du capteur envoyait vérifier un réglage qui n'était pas
 * en cause.
 */
import * as Location from 'expo-location';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { plateformeWebCourante } from './plateformeWeb';

export type Position = { longitude: number; latitude: number };

/**
 * Où l'on va rendre une autorisation qu'on a refusée.
 *
 * **Quatre variantes web, et non une seule.** `'navigateur'` traitait Safari
 * mobile et Chrome de bureau pareil, et leur rendait le même texte —
 * l'icône d'un cadenas que Safari iOS n'a pas. `ios` et `android` restent :
 * ce sont les valeurs de l'app native, dont `expo-location` sait déjà
 * ouvrir les vrais réglages du système.
 */
export type OuReactiver =
  | 'web_ios_safari'
  | 'web_ios_autre'
  | 'web_android'
  | 'web_desktop'
  | 'ios'
  | 'android';

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
  | { etat: 'indisponible' }
  /**
   * La demande d'autorisation n'a pas répondu à temps.
   *
   * Distinct d'`indisponible` : là, l'appareil a répondu qu'il n'avait rien ;
   * ici, **personne n'a répondu** — la fenêtre du navigateur est peut-être
   * encore ouverte, ou elle a été fermée sans choisir. Les deux appellent un
   * « réessayer », et un seul appelle « vérifiez vos services de localisation ».
   */
  | { etat: 'sans_reponse' };

/** Au-delà, on rend la main plutôt que de laisser l'écran en attente. */
export const DELAI_DE_RELEVE_MS = 10_000;

/**
 * Au-delà, on cesse d'attendre la réponse à la demande d'autorisation.
 *
 * Plus long que le relevé : il y a un humain au bout, qui lit une fenêtre et
 * décide. Assez court pour qu'un écran bloqué le reste moins d'une minute — au
 * delà, plus personne n'attend, on recharge la page.
 */
export const DELAI_D_AUTORISATION_MS = 30_000;

/** Ce qu'on cesse d'attendre, pour distinguer les deux abandons. */
const EXPIRE = Symbol('expire');

/**
 * Borne une promesse sans prétendre l'annuler.
 *
 * Rien n'annule une demande d'autorisation ou un relevé en cours côté
 * plateforme ; prétendre le faire ajouterait un mensonge de plus. On cesse
 * simplement d'attendre, et l'écran reprend la main.
 *
 * **Mais le minuteur, lui, s'éteint.** Il ne servait plus dès que la course
 * était jouée, et il restait pourtant en vol trente secondes : rien de visible
 * à l'écran, et un processus qui ne peut pas se terminer tant qu'il pend. C'est
 * ce qui faisait forcer la sortie d'un worker Jest à chaque exécution de la
 * suite. Éteindre ne prétend rien annuler — la promesse d'origine continue
 * exactement comme avant, personne ne l'attend plus.
 */
function avantEcheance<T>(promesse: Promise<T>, delai: number): Promise<T | typeof EXPIRE> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promesse,
    new Promise<typeof EXPIRE>((resoudre) => {
      minuteur = setTimeout(() => resoudre(EXPIRE), delai);
    }),
  ]).finally(() => clearTimeout(minuteur));
}

function ouReactiver(): OuReactiver {
  if (Platform.OS === 'web') {
    switch (plateformeWebCourante()) {
      case 'ios_safari':
        return 'web_ios_safari';
      case 'ios_autre':
        return 'web_ios_autre';
      case 'android':
        return 'web_android';
      case 'desktop':
        return 'web_desktop';
    }
  }
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

  const issue = await avantEcheance(releve, DELAI_DE_RELEVE_MS);
  return issue === EXPIRE ? null : issue;
}

export function usePosition() {
  const [etat, setEtat] = useState<EtatDePosition>({ etat: 'jamais_demandee' });
  /**
   * Une demande est-elle en vol.
   *
   * **Une référence et non l'état.** L'ancienne garde comparait l'état
   * précédent — elle dédoublonnait l'objet posé, jamais l'appel : deux
   * `demander()` concurrents passaient tous les deux, ouvraient deux fenêtres,
   * et la seconde réponse écrasait la première. Le commentaire affirmait
   * pourtant que c'était couvert.
   */
  const enVol = useRef(false);

  const demander = useCallback(async () => {
    if (enVol.current) return;
    enVol.current = true;

    try {
      let accorde: boolean;
      try {
        // **Lire avant de demander.** Sur un refus déjà acquis, `request`
        // répond sans rien afficher : l'utilisateur presse un bouton et ne voit
        // rien.
        const actuel = await Location.getForegroundPermissionsAsync();
        if (actuel.status === 'denied' && !actuel.canAskAgain) {
          // **Et sans passer par `en_cours`, ce qui était le vrai défaut du
          // bouton « réessayer ».** L'état d'attente était posé avant cette
          // lecture : sur un refus déjà acquis, l'écran quittait le bloc,
          // affichait « on cherche votre position » pendant les quelques
          // millisecondes de la lecture, puis revenait au même bloc. Rien ne
          // bougeait à l'œil, et le bloc étant démonté puis remonté, il
          // perdait aussi tout moyen de dire « j'ai essayé ». Annoncer une
          // recherche qu'on est sur le point de découvrir impossible n'était
          // de toute façon pas vrai.
          setEtat({ etat: 'refusee', ouReactiver: ouReactiver() });
          return;
        }

        // Passé ce point, quelque chose peut réellement se produire : une
        // fenêtre du navigateur, ou une lecture de position.
        setEtat({ etat: 'en_cours' });

        if (actuel.granted) {
          accorde = true;
        } else {
          // **Bornée, parce qu'elle ne l'est pas côté plateforme.** Sur le web,
          // cette promesse se règle par `getCurrentPosition` sans `timeout` :
          // on accepte dans le navigateur, la position n'arrive jamais, et
          // aucun rappel n'est appelé. C'est là que l'écran restait bloqué.
          const reponse = await avantEcheance(
            Location.requestForegroundPermissionsAsync(),
            DELAI_D_AUTORISATION_MS,
          );
          if (reponse === EXPIRE) {
            // Personne n'a répondu. Ni un refus — rien n'a été refusé — ni une
            // panne de capteur : les trois appellent des phrases différentes.
            setEtat({ etat: 'sans_reponse' });
            return;
          }
          accorde = reponse.granted;
        }
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
    } finally {
      // **Toujours**, y compris sur une sortie anticipée ou une levée : un
      // verrou qui ne se relâche pas transforme un écran lent en écran mort,
      // ce qui est exactement le défaut qu'on répare.
      enVol.current = false;
    }
  }, []);

  return {
    /** La position, ou `null` dans tous les autres états. */
    position: etat.etat === 'accordee' ? etat.position : null,
    etat,
    demander: () => void demander(),
  };
}
