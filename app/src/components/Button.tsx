/**
 * Bouton.
 *
 * **Jamais dimensionné sur son texte.** `fullWidth` par défaut, ou `flex: 1`
 * dans une rangée. C'est la contrainte espagnole : « Solicitar un código
 * nuevo » fait 30 % de plus que son équivalent anglais, et un bouton calibré
 * sur l'anglais le tronquerait ou déborderait.
 *
 * **`disabled` ne sert que si l'action redeviendra possible.** Sinon on retire
 * le bouton. Un bouton grisé demande à l'utilisateur de deviner ce qui le
 * débloque ; son absence, accompagnée d'une phrase, ne demande rien.
 *
 * **`loading` garde la géométrie exacte.** Le libellé devient celui qu'on lui
 * donne (« Envoi… ») et un anneau tourne à côté. Remplacer le contenu par un
 * indicateur ferait sauter la mise en page au moment précis où l'utilisateur
 * attend.
 *
 * **Le doigt reçoit une réponse avant l'action.** Une échelle au toucher, pas
 * une opacité seule : un bouton qui pâlit ressemble à un bouton désactivé, et
 * c'est le contraire qu'on veut dire. Un appel réseau met deux cents
 * millisecondes à répondre, et pendant ces deux cents millisecondes rien ne
 * bougeait — assez pour appuyer deux fois.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View, type ViewStyle } from 'react-native';

import { radius, size, useColors } from '../theme';
import { useEnfoncement } from './Mouvement';
import { Texte } from './Texte';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  /** Jamais tronqué. Deux lignes autorisées. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Le libellé pendant le chargement : un verbe, pas un mot vide. */
  loadingLabel?: string;
  fullWidth?: boolean;
  /**
   * Le bouton se pose sur un média, pas sur une surface du thème.
   *
   * **N'a de sens que pour `ghost`**, seul variant dont le texte touche
   * directement ce qu'il y a derrière : le principal porte sa surface, le
   * secondaire son filet, le danger sa bordure. Le fantôme, lui, est en
   * `brand.700` — une encre foncée, calibrée pour du papier. Sur un média elle
   * donne 2,14:1 au pire, et rien ne le rattrape : ni un voile, qui assombrit
   * l'encre autant que le fond, ni la chance d'avoir une image sombre.
   */
  surMedia?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

const HAUTEURS: Record<ButtonSize, number> = {
  sm: size.row,
  md: size.field,
  lg: size.button,
};

export function Button({
  label,
  variant = 'primary',
  size: taille = 'md',
  disabled = false,
  loading = false,
  loadingLabel,
  fullWidth = true,
  surMedia = false,
  onPress,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const c = useColors();
  const inerte = disabled || loading;
  const enfoncement = useEnfoncement(!inerte);

  // **Le principal est une surface `brand.500`, et son texte est en encre.**
  // Blanc sur `brand.500` donne 3,0:1 et échoue au seuil des petits corps ; à
  // 15 px, l'encre donne 6,1:1. C'est la seule divergence assumée avec les
  // visuels de la fondatrice, où le mot dans le bloc est blanc : à 200 px le
  // blanc passe, à 15 px il échoue.
  const fond: Record<ButtonVariant, string | undefined> = {
    primary: c['brand.500'],
    secondary: undefined,
    ghost: undefined,
    danger: undefined,
  };
  // Le secondaire porte un filet d'encre et non de teinte : deux oranges
  // d'intensité différente sur le même écran créent une hiérarchie fausse
  // entre deux actions de même niveau.
  const bordure: Record<ButtonVariant, string | undefined> = {
    primary: undefined,
    secondary: c['line.ink'],
    ghost: undefined,
    danger: c['status.danger.rule'],
  };
  const texte: Record<ButtonVariant, Parameters<typeof Texte>[0]['couleur']> = {
    primary: 'ink.onBrand',
    secondary: 'ink.default',
    // Sur un média, le fantôme passe à l'encre claire — 12,14:1 sur la bande
    // qui le porte, contre 2,14:1 pour `brand.700` au pire. C'est le même
    // raisonnement que la sous-ligne de l'accueil : une teinte sourde n'est
    // défendable que sur un fond clair connu.
    ghost: surMedia ? 'ink.onScrim' : 'brand.700',
    danger: 'status.danger.text',
  };

  return (
    <Animated.View style={[enfoncement.style, fullWidth ? { alignSelf: 'stretch' } : null]}>
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inerte, busy: loading }}
      disabled={inerte}
      onPress={onPress}
      onPressIn={enfoncement.onPressIn}
      onPressOut={enfoncement.onPressOut}
      style={({ pressed }): ViewStyle => ({
        // La hauteur minimale de zone tactile prime sur la taille demandée :
        // un bouton `sm` de 36 reste pressable sur 44.
        minHeight: Math.max(HAUTEURS[taille], size.hit),
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: radius['radius.pill'],
        borderWidth: bordure[variant] ? 1 : 0,
        borderColor: bordure[variant],
        backgroundColor: disabled
          ? c['bg.surface']
          : pressed && variant === 'primary'
            ? c['brand.600']
            : fond[variant],
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        alignSelf: fullWidth ? 'stretch' : undefined,
        // Jamais dimensionné sur le texte : `opacity` seule marque la pression
        // sur les variantes sans fond, aucune animation de couleur.
        opacity: pressed && variant !== 'primary' ? 0.7 : 1,
      })}
    >
      {loading ? <Anneau couleur={c[disabled ? 'ink.faint' : 'ink.default']} /> : null}
      <Texte
        variante="type.bodyStrong"
        couleur={disabled ? 'ink.faint' : texte[variant]}
        align="center"
        style={{ flexShrink: 1 }}
      >
        {loading ? (loadingLabel ?? label) : label}
      </Texte>
    </Pressable>
    </Animated.View>
  );
}

/** Quinze pixels, rotation continue. `transform` uniquement. */
function Anneau({ couleur }: { couleur: string }) {
  const tour = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const boucle = Animated.loop(
      Animated.timing(tour, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    boucle.start();
    return () => boucle.stop();
  }, [tour]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 15,
        height: 15,
        borderRadius: radius['radius.pill'],
        borderWidth: 2,
        borderColor: couleur,
        // Un bord transparent donne l'arc : aucune image, aucun dégradé.
        borderTopColor: 'transparent',
        transform: [
          { rotate: tour.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        ],
      }}
    />
  );
}
