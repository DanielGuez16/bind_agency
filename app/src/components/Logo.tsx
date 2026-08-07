/**
 * La marque.
 *
 * **Deux arcs tenus par un axe.** C'est ce que fait le produit : deux parties
 * — le salon, la créatrice — liées par un même engagement. Le mot se lit « B »
 * sans être la lettre d'une police : l'axe dépasse en haut et en bas, ce qui en
 * fait un signe et non un caractère.
 *
 * **Rien qu'une géométrie.** Pas de dégradé, pas d'ombre, pas de remplissage :
 * un trait d'épaisseur constante, qui tient à 20 points dans une barre comme à
 * 96 sur l'écran de connexion. Une marque qui a besoin d'un effet pour exister
 * disparaît dès qu'on la met en petit.
 *
 * **Les deux arcs sont inégaux.** Le bas est plus large que le haut, comme dans
 * un « B » dessiné à la main. Deux arcs identiques donnent un signe mort, que
 * l'œil lit comme une erreur de construction.
 *
 * La couleur vient du thème, jamais d'un littéral : la marque suit l'accent du
 * rôle, aqua chez la créatrice, ocre chez le commerce.
 */
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useColors, type ColorName } from '../theme';
import { Texte } from './Texte';

/**
 * Le dessin, sur une grille de 32.
 *
 * L'axe court de 3 à 29 ; les arcs s'y accrochent de 5 à 27. Le décalage de
 * deux unités est ce qui distingue le signe de la lettre.
 */
const AXE = 'M9 3V29';
const ARC_HAUT = 'M9 5h4.5a5.5 5.5 0 010 11H9';
const ARC_BAS = 'M9 16h6a5.5 5.5 0 010 11H9';

/** Proportion du trait : 2,75 sur 32, soit la même densité que les icônes. */
const TRAIT = 2.75 / 32;

export function Logo({
  taille = 32,
  couleur = 'accent.default',
  testID,
}: {
  taille?: number;
  couleur?: ColorName;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Svg
      width={taille}
      height={taille}
      viewBox="0 0 32 32"
      fill="none"
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="BIND"
    >
      {[AXE, ARC_HAUT, ARC_BAS].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={c[couleur]}
          strokeWidth={taille * TRAIT}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

/**
 * La marque et le nom, côte à côte.
 *
 * Le nom n'est écrit qu'en grand — dans une barre, le signe suffit et le mot
 * répété n'ajoute rien. L'espacement des lettres est celui du nom, pas celui du
 * texte courant : quatre lettres serrées ne se lisent pas comme une marque.
 */
export function Marque({
  taille = 40,
  couleur = 'accent.default',
  testID,
}: {
  taille?: number;
  couleur?: ColorName;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: taille * 0.3 }}
    >
      <Logo taille={taille} couleur={couleur} />
      <Texte
        variante="type.display"
        couleur={couleur}
        style={{ fontSize: taille * 0.72, lineHeight: taille * 0.86, letterSpacing: taille * 0.1 }}
      >
        BIND
      </Texte>
    </View>
  );
}
