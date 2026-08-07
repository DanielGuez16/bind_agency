/**
 * Le mouvement.
 *
 * **Opacité et transformation, rien d'autre.** `motion.animatableProps` le dit
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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { tokens } from '../theme';

const MOTION = tokens.motion;

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
      duration: MOTION.durationBase,
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
