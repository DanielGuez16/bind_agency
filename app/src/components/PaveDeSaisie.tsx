/**
 * Le pavé de la caisse : douze touches de 56.
 *
 * **Conservé même là où un clavier physique existe.** C'est le seul écran du
 * produit qui se lit debout, à un mètre, entre deux clientes — au comptoir on
 * tape d'une main, souvent sans regarder ses doigts. Un pavé à l'écran n'est
 * pas une béquille pour appareil tactile, c'est la façon dont on saisit six
 * caractères quand l'autre main tient un téléphone ou un vernis.
 *
 * **La saisie clavier reste branchée en parallèle**, et l'aide sous le champ le
 * dit. Les deux entrent dans la même valeur : rien ne distingue, à l'arrivée,
 * ce qui a été tapé de ce qui a été touché.
 *
 * **L'alphabet est celui du code de secours**, sans `I`, `O`, `0` ni `1`. Une
 * touche qui produirait un caractère que le code ne contient jamais ne mènerait
 * qu'à des refus, et le comptoir accuserait la cliente.
 */
import { Pressable, View } from 'react-native';

import { radius, spacing, useColors } from '../theme';
import { Texte } from './Texte';

/** La touche, telle que la passation la dimensionne. */
const TOUCHE = 56;

/**
 * Les douze touches. Neuf chiffres, puis les deux lettres les plus fréquentes
 * du tirage — le reste se tape au clavier, et l'aide sous le champ le dit.
 *
 * `0` et `1` sont absents de l'alphabet des codes : les mettre au pavé
 * fabriquerait des saisies qui ne peuvent que se faire refuser.
 */
export const TOUCHES = ['2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D'];

export function PaveDeSaisie({
  onTouche,
  onEffacer,
  desactive,
  testID = 'pave',
}: {
  onTouche: (caractere: string) => void;
  onEffacer: () => void;
  desactive?: boolean;
  testID?: string;
}) {
  const c = useColors();

  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing['space.2'],
        // Quatre par ligne : trois colonnes feraient six rangées, et la
        // dernière tomberait sous le pli sur un portable.
        width: TOUCHE * 4 + spacing['space.2'] * 3,
      }}
    >
      {TOUCHES.map((caractere) => (
        <Pressable
          key={caractere}
          testID={`touche-${caractere}`}
          accessibilityRole="button"
          accessibilityLabel={caractere}
          disabled={desactive}
          onPress={() => onTouche(caractere)}
          style={({ pressed }) => ({
            width: TOUCHE,
            height: TOUCHE,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius['radius.md'],
            borderWidth: 1,
            borderColor: c['line.default'],
            backgroundColor: c['bg.surface'],
            // Deux raisons de pâlir, une seule opacité : la désactivation
            // l'emporte, sinon une touche inactive « réagirait » à l'appui.
            opacity: desactive ? 0.4 : pressed ? 0.7 : 1,
        })}
        >
          <Texte variante="type.mono" style={{ fontSize: 22 }}>
            {caractere}
          </Texte>
        </Pressable>
      ))}
    </View>
  );
}
