/**
 * Où cliquer, en image — pour ceux à qui « l'icône Aa » ne dit rien tant
 * qu'ils ne l'ont pas vue.
 *
 * **Composé des primitives existantes, pas un tracé de plus.** `Icone`
 * documente son propre jeu comme volontairement court — chaque glyphe ajouté
 * est une chose de plus à traduire visuellement. Une barre d'adresse minimale
 * et le glyphe `fleche` déjà là suffisent à montrer le geste ; rien ici ne
 * justifie un tracé dédié.
 *
 * **Silencieux, à dessein.** Le texte qui l'accompagne (`filReactiverIos*Web`)
 * dit déjà « l'icône Aa, à gauche de la barre d'adresse » : une légende
 * répétée ici serait une seconde traduction de la même phrase, à tenir à jour
 * deux fois.
 */
import { View } from 'react-native';

import { Icone, Texte } from '../../components';
import { radius, useColors } from '../../theme';

export function SchemaAaSafari({ testID }: { testID?: string }) {
  const c = useColors();

  return (
    <View testID={testID} style={{ gap: 4 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: radius['radius.md'],
          borderWidth: 1,
          borderColor: c['line.default'],
          backgroundColor: c['bg.surface'],
        }}
      >
        <View
          testID="schema-aa-icone"
          style={{
            width: 26,
            height: 26,
            borderRadius: radius['radius.pill'],
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c['bg.inset'],
          }}
        >
          <Texte variante="type.label" couleur="ink.default">
            Aa
          </Texte>
        </View>
        <Texte variante="type.caption" couleur="ink.soft">
          bind.app
        </Texte>
      </View>
      <View style={{ paddingLeft: 14, transform: [{ rotate: '-90deg' }] }}>
        <Icone nom="fleche" couleur="brand.700" taille={16} testID="schema-aa-fleche" />
      </View>
    </View>
  );
}
