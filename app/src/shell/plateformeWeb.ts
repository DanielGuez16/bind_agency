/**
 * Quel navigateur, sur quel OS — pour savoir où dire d'aller réactiver une
 * permission refusée.
 *
 * **`Platform.OS === 'web'` ne distingue rien de tout ça.** Safari sur un
 * iPhone et Chrome sur un ordinateur de bureau rendent tous deux `'web'` :
 * c'est la valeur que React Native pose pour tout navigateur, quel qu'il
 * soit. Un message qui décrit un cadenas à gauche de la barre d'adresse —
 * l'UI de bureau — à quelqu'un sur Safari mobile décrit une icône qui n'existe
 * pas là où il regarde. C'est exactement ce que Rebecca a reçu.
 *
 * **Fonction pure, prenant l'agent utilisateur en paramètre.** `navigator`
 * n'existe pas partout où ce fichier est importé — les tests, le rendu natif
 * — et une fonction qui le lit elle-même se teste mal : il faudrait truquer
 * `navigator` en entier pour éprouver un seul cas. `plateformeWebCourante`
 * fait cette lecture, une fois, et rend la main à la fonction pure.
 */

export type PlateformeWeb = 'ios_safari' | 'ios_autre' | 'android' | 'desktop';

/**
 * Les navigateurs iOS autres que Safari, tous construits sur le même moteur
 * WebKit qu'Apple impose — mais avec leur propre réglage par site, ailleurs
 * que l'icône « Aa » de Safari. On ne leur promet donc pas cette icône
 * précise, seulement le principe : un réglage par site existe, encore
 * faut-il savoir où le chercher dans ce navigateur-là.
 */
const AUTRES_NAVIGATEURS_IOS = /CriOS|FxiOS|EdgiOS|OPiOS/;

const APPAREIL_IOS = /iPad|iPhone|iPod/;

const APPAREIL_ANDROID = /Android/;

/**
 * Détermine la plateforme depuis un agent utilisateur brut.
 *
 * `macTactile` couvre l'iPad depuis iPadOS 13 : Safari s'y présente comme un
 * Mac de bureau — `navigator.platform === 'MacIntel'` — et seul le nombre de
 * points de contact le distingue d'un vrai Mac. `plateformeWebCourante` le
 * calcule ; cette fonction ne fait que le recevoir, pour rester une fonction
 * d'une seule chaîne à éprouver.
 */
export function plateformeWeb(agentUtilisateur: string, macTactile = false): PlateformeWeb {
  const estIOS = macTactile || APPAREIL_IOS.test(agentUtilisateur);
  if (estIOS) {
    return AUTRES_NAVIGATEURS_IOS.test(agentUtilisateur) ? 'ios_autre' : 'ios_safari';
  }
  if (APPAREIL_ANDROID.test(agentUtilisateur)) return 'android';
  return 'desktop';
}

/**
 * La plateforme réelle du navigateur courant.
 *
 * `'desktop'` par défaut hors d'un navigateur — un rendu serveur, un test qui
 * ne simule pas `navigator` — plutôt que de lever : cette fonction ne décide
 * de rien de critique, elle choisit un texte.
 */
export function plateformeWebCourante(): PlateformeWeb {
  if (typeof navigator === 'undefined') return 'desktop';
  const macTactile = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
  return plateformeWeb(navigator.userAgent, macTactile);
}
