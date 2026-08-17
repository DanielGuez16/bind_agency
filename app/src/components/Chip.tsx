/**
 * Chip et chip de filtre.
 *
 * **La rangée est en `flexWrap`, jamais en défilement horizontal.** Une option
 * qui sort de l'écran n'existe pas pour qui ne pense pas à faire glisser, et
 * les libellés espagnols sortent bien plus vite que les anglais.
 */
import { Pressable, View } from 'react-native';

import { useI18n } from '../i18n';
import { formatNumber } from '../format';
import { radius, useColors } from '../theme';
import { Texte } from './Texte';

export type ChipProps = {
  label: string;
  /**
   * Ce que la chip ouvrirait, écrit à côté de son libellé.
   *
   * **Un filtre sans son nombre demande d'essayer pour voir**, et personne
   * n'essaie deux fois : c'est la même règle que les issues de l'état vide,
   * appliquée au geste qu'on fait dix fois par jour plutôt qu'une. Le nombre
   * est en mono, plus petit et sourd — il accompagne le mot, il ne le double
   * pas.
   *
   * `undefined` quand il n'est pas encore connu : la chip s'affiche alors sans
   * lui, parce que la navigation n'attend pas la donnée. `0` s'écrit, et il se
   * lit comme un cul-de-sac — c'est à l'appelant de ne pas proposer une chip
   * qui n'ouvre rien.
   */
  compte?: number;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
};

export function Chip({ label, compte, selected = false, onPress, testID }: ChipProps) {
  const c = useColors();
  const { locale } = useI18n();

  // Le lecteur d'écran entend le nombre dans la foulée du mot. Sans lui,
  // l'information qui décide du geste n'existe que pour qui voit.
  const annonce = compte === undefined ? label : `${label}, ${formatNumber(compte, locale)}`;

  const contenu = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 7,
        paddingHorizontal: 13,
        borderRadius: radius['radius.pill'],
        borderWidth: selected ? 0 : 1,
        borderColor: c['line.default'],
        backgroundColor: selected ? c['bg.inverse'] : 'transparent',
      }}
    >
      <Texte variante="type.label" couleur={selected ? 'ink.onDark' : 'ink.soft'}>
        {label}
      </Texte>
      {compte === undefined ? null : (
        <Texte
          variante="type.monoSmall"
          couleur={selected ? 'ink.onDark' : 'ink.mute'}
          testID={testID ? `${testID}-compte` : undefined}
        >
          {formatNumber(compte, locale)}
        </Texte>
      )}
    </View>
  );

  if (!onPress) return <View testID={testID}>{contenu}</View>;

  return (
    <Pressable
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={annonce}
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
