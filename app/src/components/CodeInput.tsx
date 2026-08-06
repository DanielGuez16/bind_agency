/**
 * Saisie du code, au comptoir.
 *
 * **La saisie manuelle est le chemin de premier rang, pas un secours dégradé.**
 * Le champ est en haut de l'écran, le pavé toujours ouvert, et le scan QR n'est
 * qu'un bouton secondaire. Un comptoir bruyant, une caméra sale, un téléphone
 * posé à plat : taper six caractères marche toujours, viser ne marche pas
 * toujours.
 *
 * **L'alphabet est réduit** — ni O ni 0, ni I ni 1. Ce qu'on dicte au téléphone
 * ne doit pas se confondre.
 */
import { Pressable, View } from 'react-native';

import { radius, tokens, useColors } from '../theme';
import { Texte } from './Texte';

export const ALPHABET = tokens.code.alphabet;
export const LONGUEUR = tokens.code.manualChars;

/** Douze touches : dix caractères fréquents, une correction, une validation. */
export type CodeInputProps = {
  value: string;
  onChange: (v: string) => void;
  /** Les caractères proposés au pavé. Douze touches, trois rangées de quatre. */
  touches?: string[];
  labelEffacer: string;
  accessibilityLabel: string;
  testID?: string;
};

export function CodeInput({
  value,
  onChange,
  touches,
  labelEffacer,
  accessibilityLabel,
  testID,
}: CodeInputProps) {
  const c = useColors();
  const jeu = touches ?? ALPHABET.slice(0, 11).split('');

  const taper = (caractere: string) => {
    if (value.length >= LONGUEUR) return;
    onChange(value + caractere);
  };

  return (
    <View testID={testID} style={{ gap: 16 }}>
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: value.split('').join(' ') }}
        style={{
          height: 72,
          borderWidth: 2,
          borderColor: c['text.primary'],
          borderRadius: radius['radius.md'],
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
        }}
      >
        {Array.from({ length: LONGUEUR }, (_, i) => {
          const caractere = value[i];
          if (caractere) {
            return (
              <Texte key={i} variante="type.mono" style={{ fontSize: 40, lineHeight: 46 }}>
                {caractere}
              </Texte>
            );
          }
          // Le curseur est un tiret, pas une barre clignotante : il se voit de
          // loin et ne demande aucune animation.
          return (
            <View
              key={i}
              style={{
                width: 26,
                height: 3,
                backgroundColor: i === value.length ? c['text.primary'] : c['border.default'],
              }}
            />
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {jeu.map((caractere) => (
          <Touche key={caractere} label={caractere} onPress={() => taper(caractere)} />
        ))}
        <Touche label={labelEffacer} onPress={() => onChange(value.slice(0, -1))} large />
      </View>
    </View>
  );
}

function Touche({
  label,
  onPress,
  large,
}: {
  label: string;
  onPress: () => void;
  large?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        // Trois rangées de quatre : chaque touche prend un quart de la largeur
        // moins les gouttières, sans mesure ni calcul de layout.
        width: large ? '48%' : '23%',
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius['radius.md'],
        backgroundColor: c['bg.raised'],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Texte variante="type.mono" style={{ fontSize: large ? 15 : 20 }}>
        {label}
      </Texte>
    </Pressable>
  );
}
