/**
 * Onglets segmentés.
 *
 * **Les compteurs font partie du libellé** — « À venir · 1 » — et non d'une
 * pastille à côté. Une pastille se dimensionne sur son chiffre et fait sauter
 * la largeur des segments quand le nombre passe de 9 à 10.
 *
 * Les onglets et leurs compteurs arrivent **avant** la liste : c'est la seule
 * partie de l'écran qui ne dépend pas du chargement des données.
 */
import { Pressable, View } from 'react-native';

import { radius, useColors } from '../theme';
import { Texte } from './Texte';
import { etatAccessible } from './etatAccessible';

export type SegmentedTabsProps = {
  items: { label: string; count?: number }[];
  index: number;
  onChange: (i: number) => void;
  testID?: string;
};

export function SegmentedTabs({ items, index, onChange, testID }: SegmentedTabsProps) {
  const c = useColors();

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        gap: 1,
        backgroundColor: c['line.default'],
        borderRadius: radius['radius.md'],
        overflow: 'hidden',
      }}
    >
      {items.map((item, i) => {
        const actif = i === index;
        const libelle = item.count === undefined ? item.label : `${item.label} · ${item.count}`;
        return (
          <Pressable
            key={item.label}
            accessibilityRole="tab"
            {...etatAccessible({ selected: actif })}
            accessibilityLabel={libelle}
            onPress={() => onChange(i)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 32,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 8,
              paddingVertical: 7,
              backgroundColor: actif ? c['bg.inverse'] : c['bg.surface'],
          opacity: pressed ? 0.7 : 1,
        })}
          >
            <Texte
              variante="type.label"
              couleur={actif ? 'ink.onDark' : 'ink.soft'}
              align="center"
            >
              {libelle}
            </Texte>
          </Pressable>
        );
      })}
    </View>
  );
}
