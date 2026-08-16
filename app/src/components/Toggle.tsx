/**
 * Interrupteur. Ouvre ou ferme une prestation, met BIND en pause.
 *
 * La pastille se déplace en `transform`, pas en marge : c'est la seule
 * propriété animable autorisée avec `opacity`, et animer une position
 * calculée sauterait sur Android bas de gamme.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable } from 'react-native';

import { motion, radius, useColors } from '../theme';

export type ToggleProps = {
  value: boolean;
  onChange: (v: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
};

export function Toggle({
  value,
  onChange,
  accessibilityLabel,
  disabled,
  testID,
}: ToggleProps) {
  const c = useColors();
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();
  }, [position, value]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={{ top: 11, bottom: 11, left: 0, right: 0 }}
      style={({ pressed }) => ({
        width: 40,
        height: 22,
        borderRadius: radius['radius.pill'],
        justifyContent: 'center',
        paddingHorizontal: 3,
        backgroundColor: value ? c['brand.700'] : c['line.default'],
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        })}
    >
      <Animated.View
        style={{
          width: 16,
          height: 16,
          borderRadius: radius['radius.pill'],
          // La passation dit « pastille blanche ». Le blanc ne marche que dans
          // un thème : en clair, une pastille blanche sur l'accent sombre passe,
          // mais éteinte sur `border.default` clair elle disparaît. Deux jetons
          // règlent les deux cas dans les deux thèmes — `accent.onAccent` est
          // par construction lisible sur l'accent, `text.primary` sur le fond.
          backgroundColor: value ? c['ink.onBrand'] : c['ink.default'],
          transform: [
            { translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) },
          ],
        }}
      />
    </Pressable>
  );
}
