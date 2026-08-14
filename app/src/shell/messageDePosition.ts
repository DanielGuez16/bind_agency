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
  navigateur: 'parcours.filReactiverNavigateur',
  ios: 'parcours.filReactiverIos',
  android: 'parcours.filReactiverAndroid',
};

export function messageDePosition(etat: EtatDePosition): MessageDePosition | null {
  switch (etat.etat) {
    case 'accordee':
      // Il y a une position : l'écran a mieux à montrer.
      return null;

    case 'jamais_demandee':
      return {
        corps: 'parcours.filSansPosition',
        ouReactiver: null,
        action: { cle: 'parcours.filAutoriser' },
      };

    case 'en_cours':
      // Aucune action : la fenêtre système est ouverte, ou le relevé court.
      // Un second bouton n'ouvrirait pas une seconde fenêtre.
      return { corps: 'parcours.filPositionEnCours', ouReactiver: null, action: null };

    case 'refusee':
      // **Pas de bouton.** Le redemander ne rouvre rien, et un bouton qui ne
      // fait rien est pire que pas de bouton : c'est ce défaut-là qu'on
      // répare. Le chemin vers le réglage prend sa place.
      return {
        corps: 'parcours.filPositionRefusee',
        ouReactiver: REACTIVER[etat.ouReactiver],
        action: null,
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
