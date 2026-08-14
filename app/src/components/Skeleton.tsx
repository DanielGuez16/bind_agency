/**
 * Squelettes de chargement.
 *
 * **Géométrie identique au contenu final.** Un squelette de la mauvaise taille
 * fait sauter la mise en page à l'arrivée des données, exactement au moment où
 * l'utilisateur commençait à lire.
 *
 * Boucle d'opacité, jamais de dégradé animé : un shimmer coûte cher sur Android
 * bas de gamme, précisément sur les appareils où le chargement dure.
 *
 * `useReducedMotion` respecté — la boucle devient un état fixe à 0,7.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';

import { motion, radius, useColors } from '../theme';

function useBoucleDOpacite(decalage: number) {
  const opacite = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    let annule = false;
    let boucle: Animated.CompositeAnimation | undefined;

    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((reduit) => {
        if (annule) return;
        if (reduit) {
          opacite.setValue(0.7);
          return;
        }
        boucle = Animated.loop(
          Animated.sequence([
            Animated.delay(decalage),
            Animated.timing(opacite, {
              toValue: 1,
              duration: motion.skeletonLoop / 2,
              useNativeDriver: true,
            }),
            Animated.timing(opacite, {
              toValue: 0.45,
              duration: motion.skeletonLoop / 2,
              useNativeDriver: true,
            }),
          ]),
        );
        boucle.start();
      })
      .catch(() => {
        // Plateforme sans l'API : on reste sur l'état fixe, jamais d'exception.
        opacite.setValue(0.7);
      });

    return () => {
      annule = true;
      boucle?.stop();
    };
  }, [decalage, opacite]);

  return opacite;
}

export function SkeletonBox({
  width,
  height,
  rayon = radius['radius.none'],
  decalage = 0,
  testID,
}: {
  width?: number | `${number}%`;
  height: number;
  rayon?: number;
  decalage?: number;
  testID?: string;
}) {
  const c = useColors();
  const opacite = useBoucleDOpacite(decalage);

  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: width ?? '100%',
        height,
        borderRadius: rayon,
        backgroundColor: c['skeleton.base'],
        opacity: opacite,
      }}
    />
  );
}

export function SkeletonLine({
  width = '100%',
  decalage = 0,
}: {
  width?: number | `${number}%`;
  decalage?: number;
}) {
  return <SkeletonBox width={width} height={14} rayon={radius['radius.none']} decalage={decalage} />;
}

/** La géométrie de `BusinessCard`, à l'identique. */
export function SkeletonCard({ testID }: { testID?: string }) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius['radius.none'],
        borderWidth: 1,
        borderColor: c['line.default'],
        overflow: 'hidden',
      }}
    >
      <SkeletonBox height={150} rayon={0} />
      <View style={{ padding: 12, gap: 8 }}>
        <SkeletonLine width="60%" decalage={100} />
        <SkeletonLine width="40%" decalage={200} />
        <SkeletonLine width="80%" decalage={300} />
      </View>
    </View>
  );
}
