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

export type NomIcone =
  | 'chevron'
  | 'croix'
  | 'coche'
  | 'horloge'
  | 'lieu'
  | 'appareil-photo'
  // Les onglets. Un jeu volontairement court : chaque icône ajoutée est une
  // chose de plus à traduire visuellement, et une barre d'onglets qui en
  // compte plus de cinq a un autre problème.
  | 'paliers'
  | 'calendrier'
  | 'personne'
  | 'reglages'
  | 'image'
  | 'rapport'
  | 'liste';

const CHEMINS: Record<NomIcone, string> = {
  chevron: 'M9 6l6 6-6 6',
  croix: 'M6 6l12 12M18 6L6 18',
  coche: 'M5 13l4 4L19 7',
  horloge: 'M12 7v5l3 2',
  lieu: 'M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z',
  'appareil-photo': 'M4 8h3l2-2h6l2 2h3v11H4z',
  // Trois barres croissantes : le même glyphe que le badge de palier, pour
  // que l'onglet et le badge se répondent.
  paliers: 'M6 18v-4M12 18v-8M18 18V6',
  calendrier: 'M4 7h16v13H4zM4 11h16M8 4v5M16 4v5',
  personne: 'M5 20a7 7 0 0114 0',
  reglages: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5L13 16M14 13l2-2 4 4',
  rapport: 'M4 20h16M7 20v-7M12 20V6M17 20v-4',
  liste: 'M4 7h16M4 12h16M4 17h10',
};

//: Les icônes qui portent un cercle en plus de leur tracé.
const CERCLES: Partial<Record<NomIcone, { cx: number; cy: number; r: number }>> = {
  horloge: { cx: 12, cy: 12, r: 9 },
  'appareil-photo': { cx: 12, cy: 13, r: 3.5 },
  personne: { cx: 12, cy: 8, r: 3.5 },
  reglages: { cx: 12, cy: 12, r: 3.5 },
};

export function Icone({
  nom,
  couleur = 'text.primary',
  teinte,
  testID,
}: {
  nom: NomIcone;
  couleur?: ColorName;
  /**
   * Une couleur déjà résolue, quand elle vient d'ailleurs que du thème — la
   * barre d'onglets donne la sienne, tirée du thème de navigation qui est
   * lui-même construit sur nos jetons. La retraduire ici créerait une seconde
   * source, et c'est la seconde qui dérive.
   */
  teinte?: string;
  testID?: string;
}) {
  const c = useColors();
  const trait = teinte ?? c[couleur];
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
      {CERCLES[nom] ? (
        <Circle
          cx={CERCLES[nom]!.cx}
          cy={CERCLES[nom]!.cy}
          r={CERCLES[nom]!.r}
          stroke={trait}
          strokeWidth={size.iconStroke}
        />
      ) : null}
      <Path
        d={CHEMINS[nom]}
        stroke={trait}
        strokeWidth={size.iconStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
