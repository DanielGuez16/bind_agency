/**
 * Ce qu'un écran doit dire de l'état de la position, et ce qu'il doit proposer.
 *
 * Séparé du rendu et de `usePosition` : c'est la seule règle de l'affaire qui
 * mérite d'être éprouvée seule, et la vérifier au travers d'un écran
 * demanderait de simuler une plateforme entière pour lire trois clés.
 *
 * **La règle tient en une phrase : on ne propose de redemander que là où la
 * fenêtre s'ouvrira.** Le système et le navigateur ne reposent la question
 * qu'une fois. Après un refus, un bouton « Share my location » ne produit plus
 * rien du tout — c'est exactement ce qui a été relevé — et le remède n'est pas
 * de le presser plus fort, c'est d'aller lever le refus. Le message le dit, à
 * l'endroit près, parce que « dans les réglages » n'aide personne.
 *
 * **Et il n'y a plus de première demande à proposer.** Un écran qui demandait
 * « partagez votre position », suivi du système qui demande la même chose,
 * faisait deux questions pour une : la première n'apprenait rien que la seconde
 * ne dise mieux, et elle ajoutait un geste avant le geste. Le fil déclenche
 * maintenant la demande système à l'arrivée ; `jamais_demandee` est donc un état
 * qui ne dure qu'un rendu, et il se dit comme une attente, pas comme une
 * question.
 *
 * **Ce qui reste après un refus gagne un « réessayer », et ce n'est pas un
 * retour en arrière.** Le bouton retiré promettait de reposer la question au
 * système, ce que le système refuse. Celui-ci ne promet que de **relire**
 * l'autorisation : quelqu'un qui vient de la rétablir dans ses réglages n'a
 * alors pas à recharger la page pour que le fil s'en aperçoive. `demander` lit
 * l'état avant de demander — si le refus tient toujours, on retombe sur le même
 * message, et rien n'a été promis qui ne soit tenu.
 */
import type { EtatDePosition, OuReactiver } from './usePosition';

/** Les clés d'un état, prêtes à traduire. `action` est nulle quand il n'y a rien à presser. */
export type MessageDePosition = {
  corps: string;
  /** Le chemin exact vers le réglage. Nul quand il n'y a rien à réactiver. */
  ouReactiver: string | null;
  action: { cle: string } | null;
};

const REACTIVER: Record<OuReactiver, string> = {
  web_ios_safari: 'parcours.filReactiverIosSafariWeb',
  web_ios_autre: 'parcours.filReactiverIosAutreWeb',
  web_android: 'parcours.filReactiverAndroidWeb',
  web_desktop: 'parcours.filReactiverDesktopWeb',
  ios: 'parcours.filReactiverIos',
  android: 'parcours.filReactiverAndroid',
};

export function messageDePosition(etat: EtatDePosition): MessageDePosition | null {
  switch (etat.etat) {
    case 'accordee':
      // Il y a une position : l'écran a mieux à montrer.
      return null;

    case 'jamais_demandee':
      // **Aucune action.** Le fil demande de lui-même en arrivant : proposer un
      // bouton ici ferait la première des deux questions qu'on vient de
      // supprimer. L'état ne dure qu'un rendu, et il se lit comme l'attente
      // qu'il est.
      return { corps: 'parcours.filPositionEnCours', ouReactiver: null, action: null };

    case 'en_cours':
      // Aucune action : la fenêtre système est ouverte, ou le relevé court.
      // Un second bouton n'ouvrirait pas une seconde fenêtre.
      return { corps: 'parcours.filPositionEnCours', ouReactiver: null, action: null };

    case 'refusee':
      // **Le chemin vers le réglage d'abord, le bouton après.** L'ordre est la
      // règle : « réessayer » seul rejouerait la demande muette qu'on a
      // corrigée. Placé sous l'explication, il ne dit plus « je repose la
      // question » mais « j'ai rétabli, relis » — et `demander` relit
      // effectivement l'autorisation avant de demander quoi que ce soit.
      return {
        corps: 'parcours.filPositionRefusee',
        ouReactiver: REACTIVER[etat.ouReactiver],
        action: { cle: 'parcours.filReessayer' },
      };

    case 'indisponible':
      // Rien n'a été refusé : le relevé n'a pas abouti. Réessayer a du sens,
      // et envoyer chercher un réglage n'en aurait pas.
      return {
        corps: 'parcours.filPositionIndisponible',
        ouReactiver: null,
        action: { cle: 'parcours.filReessayer' },
      };

    case 'sans_reponse':
      // **Distinct d'`indisponible`, et c'est tout l'objet.** Là, l'appareil a
      // répondu qu'il n'avait rien ; ici personne n'a répondu — la fenêtre du
      // navigateur est peut-être encore ouverte, ou fermée sans choisir.
      // « Votre appareil n'a rien rendu » envoyait vérifier des services de
      // localisation qui n'étaient pas en cause, et ne parlait pas de la
      // fenêtre, qui est la seule chose à regarder.
      return {
        corps: 'parcours.filPositionSansReponse',
        ouReactiver: null,
        action: { cle: 'parcours.filReessayer' },
      };
  }
}
