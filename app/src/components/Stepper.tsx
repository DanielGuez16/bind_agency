/**
 * Compteur, et rangée de valeurs.
 *
 * **La rangée passe en danger quand la valeur descend sous les réservations
 * déjà prises.** C'est le seul endroit du système où une couleur d'alerte est
 * portée par un contrôle : le commerce qui réduit sa capacité doit voir tout de
 * suite qu'il passe sous ce qu'il a promis, avant d'enregistrer.
 */
import { Pressable, View } from 'react-native';

import { radius, size, useColors } from '../theme';
import { Texte } from './Texte';

export type StepperProps = {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  testID?: string;
};

export function Stepper({ label, value, min = 0, max = 99, onChange, testID }: StepperProps) {
  const c = useColors();

  return (
    <View
      testID={testID}
      style={{
        height: size.tapMin,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: radius['radius.md'],
        backgroundColor: c['bg.sunken'],
        paddingHorizontal: 12,
        gap: 8,
      }}
    >
      <Texte variante="type.mono">{label ? `${label} · ${value}` : String(value)}</Texte>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Touche signe="−" actif={value > min} onPress={() => onChange(value - 1)} />
        <Touche signe="+" actif={value < max} onPress={() => onChange(value + 1)} />
      </View>
    </View>
  );
}

function Touche({
  signe,
  actif,
  onPress,
}: {
  signe: string;
  actif: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={signe === '+' ? 'plus' : 'minus'}
      accessibilityState={{ disabled: !actif }}
      disabled={!actif}
      onPress={onPress}
      // 32 de haut mais 44 de zone tactile : `hitSlop` élargit sans changer la
      // géométrie, ce qu'aucune marge ne sait faire.
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={{
        width: 32,
        height: 32,
        borderRadius: radius['radius.sm'],
        borderWidth: 1,
        borderColor: c['border.default'],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Texte variante="type.bodyStrong" couleur={actif ? 'text.primary' : 'text.disabled'}>
        {signe}
      </Texte>
    </Pressable>
  );
}

export type RangeeDeValeursProps = {
  values: number[];
  value: number;
  /** Ce qui est déjà réservé. En dessous, la valeur choisie passe en danger. */
  dejaPris?: number;
  onChange: (v: number) => void;
  testID?: string;
};

export function RangeeDeValeurs({
  values,
  value,
  dejaPris,
  onChange,
  testID,
}: RangeeDeValeursProps) {
  const c = useColors();

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: 6 }}>
      {values.map((v) => {
        const choisi = v === value;
        const sousLeSeuil = dejaPris !== undefined && v < dejaPris;
        return (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityState={{ selected: choisi }}
            accessibilityLabel={String(v)}
            onPress={() => onChange(v)}
            style={{
              flex: 1,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius['radius.md'],
              borderWidth: choisi ? 2 : 1,
              borderColor: choisi
                ? sousLeSeuil
                  ? c['status.danger']
                  : c['accent.default']
                : c['border.default'],
              backgroundColor: choisi
                ? sousLeSeuil
                  ? c['status.danger.subtle']
                  : c['accent.subtle']
                : 'transparent',
            }}
          >
            <Texte
              variante="type.mono"
              couleur={choisi && sousLeSeuil ? 'status.danger' : 'text.primary'}
            >
              {v}
            </Texte>
          </Pressable>
        );
      })}
    </View>
  );
}
