/**
 * Chip et chip de filtre.
 *
 * **La rangée est en `flexWrap`, jamais en défilement horizontal.** Une option
 * qui sort de l'écran n'existe pas pour qui ne pense pas à faire glisser, et
 * les libellés espagnols sortent bien plus vite que les anglais.
 */
import { Pressable, View } from 'react-native';

import { radius, useColors } from '../theme';
import { Texte } from './Texte';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
};

export function Chip({ label, selected = false, onPress, testID }: ChipProps) {
  const c = useColors();
  const contenu = (
    <View
      style={{
        paddingVertical: 7,
        paddingHorizontal: 13,
        borderRadius: radius['radius.full'],
        borderWidth: selected ? 0 : 1,
        borderColor: c['border.default'],
        backgroundColor: selected ? c['bg.inverse'] : 'transparent',
      }}
    >
      <Texte variante="type.label" couleur={selected ? 'text.inverse' : 'text.secondary'}>
        {label}
      </Texte>
    </View>
  );

  if (!onPress) return <View testID={testID}>{contenu}</View>;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
    >
      {contenu}
    </Pressable>
  );
}

/** Enveloppe obligatoire d'une rangée de chips. Jamais de `ScrollView`. */
export function RangeeDeChips({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}
