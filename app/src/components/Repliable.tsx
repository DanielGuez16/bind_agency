import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icone } from './Icone';
import { Texte } from './Texte';
import { useColors } from '../theme';

/**
 * Une section qui dit ce qu'elle contient avant qu'on l'ouvre.
 *
 * **Le résumé n'est pas un sous-titre.** Un titre nomme, un compte décide :
 * « 12 photos » dit s'il faut ouvrir, « Photos » ne dit rien de plus que le
 * titre. C'est ce qui permet de replier sans rien cacher d'utile.
 *
 * **Et une section qui retient quelque chose le dit en teinte.** Replier ne
 * doit jamais faire disparaître un blocage : une prestation qui ne se publie
 * pas faute de carte se voit fermé comme ouvert.
 */
export function Repliable({
  titre,
  resume,
  alerte = false,
  ouverte,
  onBasculer,
  children,
  testID,
}: {
  titre: string;
  resume: string;
  alerte?: boolean;
  ouverte: boolean;
  onBasculer: () => void;
  children: ReactNode;
  testID: string;
}) {
  const c = useColors();

  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: ouverte }}
        accessibilityLabel={`${titre} — ${resume}`}
        onPress={onBasculer}
        testID={`${testID}-entete`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: c['line.default'],
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Texte variante="type.bodyStrong">{titre}</Texte>
          <Texte
            variante="type.caption"
            // **Le mot, pas la teinte.** L'ambre ne se pose pas sans glyphe —
            // c'est la règle du système — et « 3 services ne peuvent pas
            // paraître sans elle » dit déjà tout ce qu'une couleur dirait, en
            // plus précis. L'encre pleine suffit à le sortir du gris.
            couleur={alerte ? 'ink.default' : 'ink.soft'}
            testID={`${testID}-resume`}
          >
            {resume}
          </Texte>
        </View>
        <View style={{ transform: [{ rotate: ouverte ? '90deg' : '0deg' }] }}>
          <Icone nom="chevron" couleur="ink.soft" taille={20} />
        </View>
      </Pressable>
      {ouverte ? <View style={{ paddingTop: 14 }}>{children}</View> : null}
    </View>
  );
}
