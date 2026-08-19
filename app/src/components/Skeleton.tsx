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
  rayon = radius['radius.md'],
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
  return <SkeletonBox width={width} height={14} rayon={radius['radius.md']} decalage={decalage} />;
}

/**
 * Une liste de lignes de texte : un libellé, une valeur.
 *
 * **La forme la plus répandue du produit, et celle qui manquait.** Le défaut
 * d'`Ecran` est `SkeletonCard`, c'est-à-dire une carte à photo de 150 pixels.
 * Il est juste sur le fil et faux partout ailleurs : l'annuaire, l'audience, le
 * reporting, les plans, l'arbitrage rendent des lignes. Promettre une image qui
 * n'arrive jamais fait sauter la page entière au moment précis où quelqu'un
 * commençait à lire — le squelette ne servait alors qu'à rendre le saut plus
 * spectaculaire.
 */
export function SkeletonLignes({ combien = 5, testID }: { combien?: number; testID?: string }) {
  return (
    <View testID={testID} style={{ gap: 14 }}>
      {Array.from({ length: combien }, (_, rang) => (
        <View
          key={rang}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            minHeight: 44,
          }}
        >
          {/* Les largeurs alternent : des lignes strictement identiques se
              lisent comme une grille, pas comme du texte qui arrive. */}
          <SkeletonLine width={rang % 2 === 0 ? '45%' : '55%'} decalage={rang * 80} />
          <SkeletonLine width="20%" decalage={rang * 80 + 40} />
        </View>
      ))}
    </View>
  );
}

/**
 * Une fiche unique : un bandeau, un titre, quelques lignes.
 *
 * **Une, jamais trois.** Le défaut promettait trois cartes là où la fiche d'un
 * commerce et l'écran de preuve n'en montrent qu'une : on attendait une liste,
 * on recevait un objet, et tout se réorganisait sous les yeux.
 */
export function SkeletonFiche({ testID }: { testID?: string }) {
  return (
    <View testID={testID} style={{ gap: 16 }}>
      <SkeletonBox height={150} rayon={radius['radius.md']} />
      <View style={{ gap: 10 }}>
        <SkeletonLine width="70%" decalage={100} />
        <SkeletonLine width="40%" decalage={180} />
      </View>
      <SkeletonLignes combien={3} />
    </View>
  );
}

/**
 * Une grille de pastilles courtes : les créneaux d'une journée.
 *
 * La rangée de jours d'abord, puis les heures. C'est l'écran où l'attente se
 * supporte le moins — on vient d'y arriver avec une intention précise.
 */
export function SkeletonGrille({
  colonnes = 3,
  lignes = 4,
  testID,
}: {
  colonnes?: number;
  lignes?: number;
  testID?: string;
}) {
  return (
    <View testID={testID} style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {Array.from({ length: 5 }, (_, rang) => (
          <SkeletonBox key={rang} width={56} height={56} decalage={rang * 60} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {Array.from({ length: colonnes * lignes }, (_, rang) => (
          <SkeletonBox key={rang} width={88} height={44} decalage={rang * 40} />
        ))}
      </View>
    </View>
  );
}

/** La géométrie de `BusinessCard`, à l'identique. */
export function SkeletonCard({ testID }: { testID?: string }) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius['radius.md'],
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
