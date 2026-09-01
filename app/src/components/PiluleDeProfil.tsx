/**
 * La pilule qui nomme la sortie : le logo du réseau, et le mot.
 *
 * **Elle n'est pas une cible.** C'est l'étiquette visible de la ligne qui la
 * contient, laquelle porte la zone cliquable sur toute sa hauteur. Un chevron
 * de sortie nu ne disait ni où l'on va ni que c'était touchable ; un lien de
 * dix-sept pixels n'était pas un lien.
 *
 * **44 points, bord de 1,5.** Relevé sur la planche v11, où la même pilule sert
 * la carte de décision et l'annuaire — deux écrans, une seule forme.
 *
 * Le glyphe de réseau vient de `assets/primitives.json`, copié et non retapé.
 */
import { View } from 'react-native';

import { Icone } from './Icone';
import { Texte } from './Texte';
import { radius, useColors } from '../theme';

/** La hauteur de la pilule, relevée sur la planche. */
export const HAUTEUR_DE_PILULE = 44;

export function PiluleDeProfil({
  plateforme,
  libelle,
  testID,
}: {
  plateforme: string;
  libelle: string;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      // Décorative : la ligne qui la contient porte déjà le rôle et l'annonce.
      // Une pilule annoncée en plus doublerait la lecture d'écran.
      accessibilityElementsHidden
      style={{
        flexShrink: 0,
        height: HAUTEUR_DE_PILULE,
        borderRadius: radius['radius.pill'],
        borderWidth: 1.5,
        borderColor: c['ink.default'],
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
      }}
    >
      <Icone nom={plateforme === 'tiktok' ? 'tiktok' : 'instagram'} taille={18} />
      <Texte variante="type.bodyStrong">{libelle}</Texte>
    </View>
  );
}
