/**
 * Le filet segmenté.
 *
 * Repris des carrousels de la fondatrice, où il compte les vues : autant de
 * segments de 3 px que d'images, gouttière de 14, les vues parcourues en
 * orange et les autres en blanc.
 *
 * **Le produit s'en sert mieux comme progression d'une mise en route.** Chez
 * elle c'est une pagination — on peut revenir en arrière, et le segment dit
 * seulement où l'on est. Ici les étapes ne se reprennent pas, et le filet dit
 * ce qui est fait : il remplace le compteur « 2 sur 4 », qui se lit mais ne se
 * voit pas.
 *
 * **L'orange y est admis alors qu'il est compté ailleurs**, parce que le filet
 * ne porte aucun texte : c'est une surface, comme le filet d'onglet actif, et
 * la règle du bloc ne parle que du bloc.
 *
 * **Il ne remplace pas les points de la galerie d'un salon.** Douze points
 * valent mieux que douze segments de 8 px : passé cinq ou six, le filet cesse
 * de se compter et redevient une barre de progression, qui ment sur ce qu'elle
 * mesure.
 */
import { View } from 'react-native';

import { segmentedRule, useColors } from '../theme';

export type FiletSegmenteProps = {
  /** Combien d'étapes en tout. */
  etapes: number;
  /** Combien sont franchies. Zéro est une valeur normale : on n'a rien fait. */
  faites: number;
  /**
   * Sur une surface sombre, le segment restant est clair ; sur une surface
   * claire, c'est le filet fort. Le jeton dit les deux, l'appelant dit lequel.
   */
  surSombre?: boolean;
  /** Ce que le filet mesure, pour qui ne le voit pas. */
  accessibilityLabel?: string;
  testID?: string;
};

export function FiletSegmente({
  etapes,
  faites,
  surSombre = false,
  accessibilityLabel,
  testID,
}: FiletSegmenteProps) {
  const c = useColors();

  // Zéro étape ne rend rien plutôt qu'un filet vide : une progression sans
  // étape n'est pas une progression à zéro pour cent, c'est l'absence de
  // parcours, et un trait gris posé là ferait croire à un chargement.
  if (etapes <= 0) return null;

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: etapes, now: faites }}
      style={{ flexDirection: 'row', gap: segmentedRule.gap }}
    >
      {Array.from({ length: etapes }, (_, i) => (
        <View
          key={i}
          testID={`${testID ?? 'filet'}-segment-${i}`}
          style={{
            flex: 1,
            height: segmentedRule.height,
            backgroundColor:
              i < faites
                ? c['brand.500']
                : surSombre
                  ? c['ink.onDark']
                  : c['line.strong'],
          }}
        />
      ))}
    </View>
  );
}
