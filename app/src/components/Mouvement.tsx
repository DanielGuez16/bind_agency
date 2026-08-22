/**
 * Le mouvement.
 *
 * **Opacité et transformation, rien d'autre.** `motion.animatable` le dit
 * dans les jetons, et ce n'est pas une préférence : ce sont les deux seules
 * propriétés que React Native anime sur le fil natif. Animer une hauteur, une
 * marge ou une couleur repasse par le pont à chaque image et saccade sur un
 * téléphone chargé — exactement là où l'animation devait rassurer.
 *
 * **Les durées viennent des jetons.** Une durée écrite dans un écran devient
 * la seule qu'on oublie quand le rythme de l'ensemble change.
 *
 * **Rien ne bouge quand l'appareil demande à ce que rien ne bouge.** Le réglage
 * d'accessibilité « réduire les animations » n'est pas un avis : pour qui a des
 * vertiges vestibulaires, une cascade est un symptôme. Dans ce cas l'élément
 * apparaît, simplement, à sa place définitive.
 */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { motion } from '../theme';

const MOTION = motion;

/** Le décalage entre deux éléments d'une cascade. */
const CASCADE_MS = 45;

/** Au-delà, la cascade traîne. Les éléments suivants apparaissent ensemble. */
const CASCADE_MAX = 8;

/** La distance dont un élément monte en apparaissant. Discrète : on la sent. */
const MONTEE = 10;

/**
 * L'état du réglage système « réduire les animations ».
 *
 * Lu une fois et suivi : quelqu'un peut l'activer pendant que l'app tourne, et
 * c'est souvent ce moment-là qui le motive.
 */
export function useMouvementReduit(): boolean {
  const [reduit, setReduit] = useState(false);

  useEffect(() => {
    let vivant = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((valeur) => {
      if (vivant) setReduit(valeur);
    });
    const abonnement = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduit);
    return () => {
      vivant = false;
      abonnement.remove();
    };
  }, []);

  return reduit;
}

/**
 * Une apparition : opacité de zéro à un, et dix points de montée.
 *
 * `rang` échelonne les éléments d'une liste. Il vaut l'index de la ligne ;
 * au-delà de huit, le décalage est plafonné — une liste de quarante salons
 * mettrait deux secondes à finir d'apparaître, et personne n'attend une liste.
 */
export function Apparition({
  children,
  rang = 0,
  style,
  testID,
}: {
  children: ReactNode;
  rang?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reduit = useMouvementReduit();
  const avancement = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduit) {
      avancement.setValue(1);
      return;
    }
    const animation = Animated.timing(avancement, {
      toValue: 1,
      duration: MOTION.default,
      delay: Math.min(rang, CASCADE_MAX) * CASCADE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [avancement, rang, reduit]);

  return (
    <Animated.View
      testID={testID}
      style={[
        style,
        {
          opacity: avancement,
          transform: [
            {
              translateY: avancement.interpolate({
                inputRange: [0, 1],
                outputRange: [MONTEE, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Un fondu simple, pour ce qui remplace un écran entier.
 *
 * **Où ça manquait.** Les bascules de la racine — connexion, déconnexion,
 * sortie de l'écran de bienvenue, fin du rétablissement de session — ne sont
 * pas des navigations mais des rendus conditionnels : la pile de React
 * Navigation les ignore, et son glissement horizontal ne s'y applique pas. Ce
 * sont pourtant les seuls moments où l'application change **entièrement** de
 * contenu, et ils coupaient franchement, sans rien dire de ce qui venait
 * d'arriver.
 *
 * **Une opacité, jamais une translation.** `Apparition` fait monter son contenu
 * de dix pixels, ce qui convient à une carte dans une liste et pas à un écran :
 * déplacer toute la page attire l'œil sur le mouvement au lieu de l'amener au
 * contenu. On enchaîne, on ne glisse pas.
 *
 * **Il faut le remonter pour le rejouer.** Poser une `key` qui change à chaque
 * bascule est ce qui relance le fondu ; sans elle, React réutiliserait le même
 * nœud et le second changement se ferait sans transition.
 */
export function Fondu({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reduit = useMouvementReduit();
  const opacite = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduit) {
      opacite.setValue(1);
      return;
    }
    const animation = Animated.timing(opacite, {
      toValue: 1,
      duration: MOTION.default,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacite, reduit]);

  return (
    <Animated.View testID={testID} style={[style, { opacity: opacite }]}>
      {children}
    </Animated.View>
  );
}

/**
 * L'enfoncement d'un élément pressable.
 *
 * Une échelle, pas une opacité : un élément qui pâlit ressemble à un élément
 * désactivé. Rendu comme une paire à brancher sur `onPressIn` / `onPressOut`,
 * pour que le composant garde son `Pressable` et son rôle d'accessibilité.
 */
export function useEnfoncement(actif = true) {
  const reduit = useMouvementReduit();
  const echelle = useRef(new Animated.Value(1)).current;

  const vers = (valeur: number) => () => {
    if (!actif || reduit) return;
    Animated.spring(echelle, {
      toValue: valeur,
      speed: 40,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  return {
    style: { transform: [{ scale: echelle }] },
    onPressIn: vers(0.97),
    onPressOut: vers(1),
  };
}

/**
 * Le retour tactile des actions principales.
 *
 * Silencieux sur le web, où l'API n'existe pas, et sur un appareil qui n'a pas
 * de moteur — la promesse rejetée n'a rien à dire à personne.
 */
export const vibration = {
  /** Une action engagée : réserver, confirmer, envoyer. */
  action() {
    if (Platform.OS === 'web') return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  /** Une réussite : la réservation est prise, la preuve est partie. */
  reussite() {
    if (Platform.OS === 'web') return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  /** Un refus. Distinct de la réussite : la main doit savoir sans lire. */
  echec() {
    if (Platform.OS === 'web') return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};

/**
 * Vrai seulement quand l'attente dure assez pour mériter d'être montrée.
 *
 * **Rien ne clignote sous quatre cents millisecondes.** Un indicateur qui
 * apparaît et disparaît en deux cents millisecondes est un défaut visuel, pas
 * une information — et il produit exactement ce qu'il prétend soigner : l'écran
 * saute, donc on doute de ce qu'on vient de faire.
 *
 * **Elle ne gouverne que les indicateurs d'attente.** Une réponse à un geste
 * part tout de suite : l'enfoncement d'un bouton ne l'attend pas, et une liste
 * qui se recompose s'atténue dès l'appui — ce n'est pas une attente, c'est un
 * remplacement.
 *
 * **Le minuteur se replace à chaque reprise d'attente**, et se coupe dès que
 * l'attente cesse. Sans cela, une seconde requête héritait du seuil déjà
 * franchi par la première et son squelette apparaissait instantanément.
 */
export function useAttenteVisible(enAttente: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enAttente) {
      setVisible(false);
      return;
    }
    const minuteur = setTimeout(() => setVisible(true), MOTION.seuilDAttente);
    return () => clearTimeout(minuteur);
  }, [enAttente]);

  return visible;
}
