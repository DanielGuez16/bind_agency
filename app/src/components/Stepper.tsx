/**
 * Compteur, et rangée de valeurs.
 *
 * **La rangée passe en danger quand la valeur descend sous les réservations
 * déjà prises.** C'est le seul endroit du système où une couleur d'alerte est
 * portée par un contrôle : le commerce qui réduit sa capacité doit voir tout de
 * suite qu'il passe sous ce qu'il a promis, avant d'enregistrer.
 *
 * **`bg.inset` et non `bg.onDark`.** Les deux se lisent « creux » ; un seul
 * l'est sur fond clair. `bg.onDark` est le plus sombre de la palette, plus
 * sombre encore que `bg.inverse` : il appartient au kit
 * d'accommodation sombre, celui des deux écrans déclarés hors système, et le
 * fichier de jetons le dit. Employé comme renfoncement il peint du noir : le
 * contrôle devenait une zone noire à deux signes illisibles, posée sur une
 * carte claire.
 */
import { Pressable, View } from 'react-native';

import { radius, size, useColors } from '../theme';
import { Texte } from './Texte';
import { etatAccessible } from './etatAccessible';

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
        height: size.touchMin,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: radius['radius.sm'],
        backgroundColor: c['bg.inset'],
        paddingHorizontal: 12,
        gap: 8,
      }}
    >
      <Texte variante="type.data">{label ? `${label} · ${value}` : String(value)}</Texte>
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
      {...etatAccessible({ disabled: !actif })}
      disabled={!actif}
      onPress={onPress}
      // 32 de haut mais 44 de zone tactile : `hitSlop` élargit sans changer la
      // géométrie, ce qu'aucune marge ne sait faire.
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: radius['radius.sm'],
        borderWidth: 1,
        borderColor: c['line.default'],
        alignItems: 'center',
        justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
    >
      <Texte variante="type.bodyStrong" couleur={actif ? 'ink.default' : 'ink.faint'}>
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
            {...etatAccessible({ selected: choisi })}
            accessibilityLabel={String(v)}
            onPress={() => onChange(v)}
            style={({ pressed }) => ({
              flex: 1,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius['radius.sm'],
              borderWidth: choisi ? 2 : 1,
              borderColor: choisi
                ? sousLeSeuil
                  ? c['status.danger.text']
                  : c['brand.700']
                : c['line.default'],
              backgroundColor: choisi
                ? sousLeSeuil
                  ? c['status.danger.surface']
                  : c['brand.50']
                : 'transparent',
          opacity: pressed ? 0.7 : 1,
        })}
          >
            <Texte
              variante="type.data"
              couleur={choisi && sousLeSeuil ? 'status.danger.text' : 'ink.default'}
            >
              {v}
            </Texte>
          </Pressable>
        );
      })}
    </View>
  );
}
