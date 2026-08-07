/**
 * Icônes.
 *
 * Vingt-quatre points, trait 1,75, jamais de remplissage : les valeurs
 * viennent de `size.icon` et `size.iconStroke`, pas d'une constante locale.
 *
 * Le jeu est volontairement minuscule. Chaque icône ajoutée est une chose de
 * plus à traduire visuellement, et la plupart des écrans se passent d'icône —
 * un mot dit ce qu'une icône suggère.
 */
import Svg, { Circle, Path } from 'react-native-svg';

import { size, useColors, type ColorName } from '../theme';

export type NomIcone = 'chevron' | 'croix' | 'coche' | 'horloge' | 'lieu' | 'appareil-photo';

const CHEMINS: Record<NomIcone, string> = {
  chevron: 'M9 6l6 6-6 6',
  croix: 'M6 6l12 12M18 6L6 18',
  coche: 'M5 13l4 4L19 7',
  horloge: 'M12 7v5l3 2',
  lieu: 'M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z',
  'appareil-photo': 'M4 8h3l2-2h6l2 2h3v11H4z',
};

export function Icone({
  nom,
  couleur = 'text.primary',
  testID,
}: {
  nom: NomIcone;
  couleur?: ColorName;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Svg
      testID={testID}
      width={size.icon}
      height={size.icon}
      viewBox="0 0 24 24"
      fill="none"
      // Décorative par défaut : le sens est porté par le texte à côté. Une
      // icône annoncée deux fois double la lecture d'écran sans rien ajouter.
      accessibilityElementsHidden
    >
      {nom === 'horloge' ? <Circle cx={12} cy={12} r={9} stroke={c[couleur]} strokeWidth={size.iconStroke} /> : null}
      {nom === 'appareil-photo' ? (
        <Circle cx={12} cy={13} r={3.5} stroke={c[couleur]} strokeWidth={size.iconStroke} />
      ) : null}
      <Path
        d={CHEMINS[nom]}
        stroke={c[couleur]}
        strokeWidth={size.iconStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
