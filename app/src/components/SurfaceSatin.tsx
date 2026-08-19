/**
 * Le satin, et les trois endroits où il a le droit d'exister.
 *
 * **Des plis, jamais une pente.** Trois surfaces construites en radiales
 * superposées : des bandes claires et sombres qui se croisent, sans direction
 * unique. Un dégradé linéaire à deux arrêts est interdit — c'est précisément le
 * cliché que la direction évite.
 *
 * **Les images sont cuites, jamais calculées.** React Native ne sait pas
 * empiler des radiales, et `expo-linear-gradient` donnerait la pente qu'on
 * refuse. Les trois satins sont livrés en 1x, 2x et 3x par
 * `scripts/cuire-les-satins.mjs`, qui fait peindre les déclarations CSS de la
 * planche par le moteur du navigateur. Rien ici ne recalcule quoi que ce soit.
 *
 * ---
 *
 * ## Les règles sont dans le composant, pas dans la consigne
 *
 * Un satin est la surface la plus facile à mal employer du système : elle est
 * belle, et il est tentant de la poser derrière une liste. Trois refus sont
 * donc portés par le code plutôt que par la relecture.
 *
 * - **Jamais sous 240 px de haut.** En dessous, les plis se serrent et le
 *   dégradé se lit comme une bande sale. Le composant lève.
 * - **Jamais sous un texte de moins de 24 px.** Un dégradé derrière de la
 *   donnée rend la donnée illisible et le dégradé bon marché. Le composant
 *   n'accepte que les variantes au-dessus du seuil, et il le vérifie.
 * - **Une seule instance par écran** — une garde statique le compte, comme
 *   elle compte les blocs.
 *
 * **Il ne porte pas de voile.** Poser un voile pour rattraper un contraste
 * reviendrait à salir le satin pour sauver un texte qu'on aurait pu écrire de
 * la bonne couleur — ou poser au bon endroit.
 *
 * ## Où le titre se pose, et pourquoi ce n'est pas un choix
 *
 * **Un satin n'est ni clair ni sombre : il a des plis.** Sur `drape`, l'encre
 * tient à 7:1 dans le tiers haut et tombe à 1,7:1 dans le tiers bas. Sur
 * `ember`, c'est exactement l'inverse : son clair passe à 6,2:1 en bas et à
 * 1,5:1 en haut. Poser le titre au même endroit sur les trois donnerait un
 * écran illisible sur deux, et personne ne le verrait avant une capture.
 *
 * L'ancrage et l'encre sont donc une **propriété de l'image**, mesurée par
 * `scripts/cuire-les-satins.mjs` au moment de la cuisson et déposée dans
 * `assets/satin/contrastes.json`. Un test compare ce que ce fichier déclare à
 * ce que les mesures disent — dans les deux sens, parce qu'un ancrage qui
 * passerait des deux côtés ne prouverait rien.
 */
import { Image, StyleSheet, View } from 'react-native';
import type { ReactElement, ReactNode } from 'react';

import { radius, type ColorName } from '../theme';

export type VarianteDeSatin = 'drape' | 'fold' | 'ember';

/**
 * La hauteur minimale, et ce n'est pas un réglage.
 *
 * La passation la fixe : « Il vit sur une surface de 240 px de haut au
 * minimum. » Un satin de 120 px n'est pas un petit satin, c'est une bande.
 */
export const HAUTEUR_MINIMALE_DU_SATIN = 240;

/**
 * Les variantes de texte qu'un satin accepte au-dessus de lui.
 *
 * Le seuil est celui du blanc sur orange — 24 px — et il vaut aussi pour
 * l'encre : ce qui se lit mal sur un dégradé, ce n'est pas la couleur, c'est la
 * finesse. `type.section` est à 22 et n'y est donc pas.
 */
const VARIANTES_ADMISES = ['type.display', 'type.displayAccent', 'type.heading', 'type.headingAccent'];

const IMAGES: Record<VarianteDeSatin, ReturnType<typeof require>> = {
  drape: require('../../assets/satin/satin-drape.jpg'),
  fold: require('../../assets/satin/satin-fold.jpg'),
  ember: require('../../assets/satin/satin-ember.jpg'),
};

/**
 * L'image seule, pour qui a besoin du satin **en fond** et non en bande.
 *
 * `SurfaceSatin` est une bande où la marque se présente, avec ses trois refus.
 * L'accueil avant inscription, lui, est le seul emploi que la passation décrit
 * comme « plein écran » : le satin y est une couche sous une vidéo, pas un bloc
 * dans le flux. Lui faire porter un titre serait le détourner ; l'exposer
 * ainsi dit exactement ce qu'on prend.
 */
export function imageDuSatin(variante: VarianteDeSatin) {
  return IMAGES[variante];
}

/**
 * **Étiré, jamais recadré.**
 *
 * Les radiales de la planche sont écrites en pourcentages de leur boîte : un
 * satin de 390 × 320 et un satin plein écran ne sont pas la même image cadrée
 * deux fois, ce sont **les mêmes pourcentages sur deux boîtes**. `cover`
 * agrandirait jusqu'à remplir puis couperait les côtés — sur un téléphone, la
 * lumière que `drape` pose à 15 % de la largeur sortirait du cadre, et il ne
 * resterait du satin que sa partie sombre. Étirer reproduit ce que le CSS
 * aurait fait, et un dégradé est la seule image du produit dont la déformation
 * ne se voit pas.
 */
export const CADRAGE_DU_SATIN = 'stretch' as const;

/**
 * Où le titre se pose sur chaque satin, et de quelle encre.
 *
 * Les deux vont ensemble : c'est le pli de l'image qui décide, pas le goût.
 * Les chiffres en regard sont ceux de `contrastes.json`, mesurés à la cuisson.
 */
export const POSE_DU_SATIN: Record<
  VarianteDeSatin,
  { ancrage: 'haut' | 'bas'; encre: ColorName }
> = {
  // 6,94:1 en haut, 1,70:1 en bas.
  drape: { ancrage: 'haut', encre: 'ink.default' },
  // 5,05:1 en haut, 1,52:1 en bas.
  fold: { ancrage: 'haut', encre: 'ink.default' },
  // 6,21:1 en bas, 1,50:1 en haut. La variante sombre, et la seule qui se lit
  // par le bas.
  ember: { ancrage: 'bas', encre: 'ink.onDark' },
};

/** L'encre qui tient sur chaque satin, à l'endroit où il se pose. */
export const ENCRE_DU_SATIN: Record<VarianteDeSatin, ColorName> = {
  drape: POSE_DU_SATIN.drape.encre,
  fold: POSE_DU_SATIN.fold.encre,
  ember: POSE_DU_SATIN.ember.encre,
};

export type SurfaceSatinProps = {
  variante: VarianteDeSatin;
  /** Au moins 240. En dessous, le composant lève. */
  hauteurMin?: number;
  children: ReactNode;
  testID?: string;
};

export function SurfaceSatin({
  variante,
  hauteurMin = HAUTEUR_MINIMALE_DU_SATIN,
  children,
  testID,
}: SurfaceSatinProps) {
  if (hauteurMin < HAUTEUR_MINIMALE_DU_SATIN) {
    // Lever, et non corriger en silence : une surface remontée à 240 sans
    // prévenir déplacerait la mise en page de l'appelant sans qu'il sache
    // pourquoi, et il chercherait ailleurs.
    throw new Error(
      `Un satin ne descend pas sous ${HAUTEUR_MINIMALE_DU_SATIN} px — demandé : ${hauteurMin}.`,
    );
  }

  for (const enfant of Array.isArray(children) ? children.flat() : [children]) {
    const variantes = (enfant as ReactElement<{ variante?: string }>)?.props?.variante;
    if (variantes !== undefined && !VARIANTES_ADMISES.includes(variantes)) {
      throw new Error(
        `${variantes} est trop fin pour un satin : au-dessus d'un dégradé, rien sous 24 px.`,
      );
    }
  }

  return (
    // **Une vue et une image, plutôt qu'`ImageBackground`.** Celui-ci pose le
    // `testID` sur son image interne et le style sur son conteneur : ce qui se
    // nomme et ce qui s'aligne ne sont alors pas le même nœud, et un test qui
    // lit l'alignement du nom trouve un fond absolu. Vingt lignes plus loin, la
    // structure dit ce qu'elle fait.
    <View
      testID={testID}
      style={{
        minHeight: hauteurMin,
        // Le pli décide, pas l'appelant : `flex-start` sur les deux satins
        // clairs, dont le tiers haut porte l'encre, `flex-end` sur la variante
        // sombre, qui ne se lit que par le bas.
        justifyContent: POSE_DU_SATIN[variante].ancrage === 'haut' ? 'flex-start' : 'flex-end',
        borderRadius: radius['radius.xl'],
        overflow: 'hidden',
      }}
    >
      <Image
        source={IMAGES[variante]}
        resizeMode={CADRAGE_DU_SATIN}
        style={StyleSheet.absoluteFill}
        // Décorative : elle ne porte aucun sens qu'un lecteur d'écran doive
        // annoncer, et la nommer ferait dire « dégradé orange » avant le titre.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={testID ? `${testID}-image` : undefined}
      />
      <View style={{ padding: 24 }}>{children}</View>
    </View>
  );
}
