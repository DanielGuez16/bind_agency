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
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

const HAUTEURS: Record<ButtonSize, number> = {
  sm: size.control.sm,
  md: size.control.md,
  lg: size.control.lg,
};

export function Button({
  label,
  variant = 'primary',
  size: taille = 'md',
  disabled = false,
  loading = false,
  loadingLabel,
  fullWidth = true,
  onPress,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const c = useColors();
  const inerte = disabled || loading;
  const enfoncement = useEnfoncement(!inerte);

  const fond: Record<ButtonVariant, string | undefined> = {
    primary: c['accent.default'],
    secondary: c['bg.surface'],
    ghost: undefined,
    danger: undefined,
  };
  const bordure: Record<ButtonVariant, string | undefined> = {
    primary: undefined,
    secondary: c['border.default'],
    ghost: undefined,
    danger: c['status.danger'],
  };
  const texte: Record<ButtonVariant, Parameters<typeof Texte>[0]['couleur']> = {
    primary: 'accent.onAccent',
    secondary: 'text.primary',
    ghost: 'accent.default',
    danger: 'status.danger',
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
        minHeight: Math.max(HAUTEURS[taille], size.tapMin),
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: radius['radius.md'],
        borderWidth: bordure[variant] ? 1 : 0,
        borderColor: bordure[variant],
        backgroundColor: disabled
          ? c['bg.raised']
          : pressed && variant === 'primary'
            ? c['accent.pressed']
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
      {loading ? <Anneau couleur={c[disabled ? 'text.disabled' : 'text.primary']} /> : null}
      <Texte
        variante="type.bodyStrong"
        couleur={disabled ? 'text.disabled' : texte[variant]}
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
        borderRadius: 999,
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
