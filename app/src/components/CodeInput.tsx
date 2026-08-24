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
 *
 * **Le code se groupe pendant la frappe, comme il se lit chez le créateur.**
 * Six caractères d'affilée se recomptent à chaque fois qu'on lève les yeux :
 * la créatrice lit « PAP EDB » sur son écran, la caissière tapait
 * « PAPEDB », et retrouver où l'on en est demandait de compter. Le même
 * découpage des deux côtés, tiré du même jeton, fait qu'on suit la dictée
 * groupe par groupe au lieu de caractère par caractère.
 */
import { Pressable, View } from 'react-native';

import { produit, radius, useColors } from '../theme';
import { Texte } from './Texte';

export const ALPHABET = produit.code.alphabet;
export const LONGUEUR = produit.code.manualChars;

/** Le découpage, celui-là même que le code de retrait affiche au créateur. */
export const TAILLE_DE_GROUPE = produit.code.manualGroupSize;

/** L'écart entre deux caractères d'un même groupe, puis entre deux groupes. */
const ECART_DANS_LE_GROUPE = 14;
const ECART_ENTRE_GROUPES = 30;

/**
 * Les rangs, découpés en groupes. Le découpage porte sur les **positions**, pas
 * sur ce qui est déjà tapé : les emplacements vides se groupent comme les
 * autres, sinon le champ changerait de forme à chaque touche et les caractères
 * déjà saisis glisseraient sous les doigts.
 */
export function groupesDeRangs(longueur: number, taille: number): number[][] {
  const groupes: number[][] = [];
  for (let debut = 0; debut < longueur; debut += taille) {
    groupes.push(
      Array.from({ length: Math.min(taille, longueur - debut) }, (_, i) => debut + i),
    );
  }
  return groupes;
}

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
        // Épelé caractère par caractère, groupé ou non : une lecture d'écran
        // dit « P A P E D B », jamais « pap edb », qui se prononcerait.
        accessibilityValue={{ text: value.split('').join(' ') }}
        style={{
          height: 72,
          borderWidth: 2,
          borderColor: c['ink.default'],
          borderRadius: radius['radius.md'],
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          // L'écart entre groupes, porté par le conteneur. Un séparateur
          // dessiné — un tiret, un point — se dicterait avec le code.
          gap: ECART_ENTRE_GROUPES,
        }}
      >
        {groupesDeRangs(LONGUEUR, TAILLE_DE_GROUPE).map((groupe) => (
          <View
            key={groupe[0]}
            testID={testID ? `${testID}-groupe-${groupe[0] / TAILLE_DE_GROUPE}` : undefined}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: ECART_DANS_LE_GROUPE,
            }}
          >
            {groupe.map((i) => {
              const caractere = value[i];
              if (caractere) {
                return (
                  <Texte key={i} variante="type.data" style={{ fontSize: 40, lineHeight: 46 }}>
                    {caractere}
                  </Texte>
                );
              }
              // Le curseur est un tiret, pas une barre clignotante : il se voit
              // de loin et ne demande aucune animation.
              return (
                <View
                  key={i}
                  style={{
                    width: 26,
                    height: 3,
                    backgroundColor: i === value.length ? c['ink.default'] : c['line.default'],
                  }}
                />
              );
            })}
          </View>
        ))}
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
        backgroundColor: c['bg.surface'],
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Texte variante="type.data" style={{ fontSize: large ? 15 : 20 }}>
        {label}
      </Texte>
    </Pressable>
  );
}
