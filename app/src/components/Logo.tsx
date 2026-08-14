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
 * ---
 *
 * ## Ce que la v1.0 change, et ce qu'elle laisse en attente
 *
 * **Une seule couleur par occurrence.** Le logo est monochrome : encre sur os
 * ou papier, clair sur orange, satin ou encre. Il ne suit plus l'accent du
 * rôle — il n'y a plus d'accent de rôle — et le défaut est donc l'encre, que
 * chaque appelant remplace par celle de la matière sur laquelle il le pose.
 *
 * **Le sigle s'écrit `B!ND`, en trait fin.** Le point d'exclamation est une
 * lettre, jamais un accent : il n'est **jamais coloré à part**, et c'est la
 * faute que la première lecture du brief avait commise.
 *
 * **`AGENCY` est centré dessous**, très espacé, jamais aligné à gauche. La
 * signature est optionnelle : dans une barre latérale, le sigle suffit et la
 * répéter à chaque écran en ferait un décor.
 *
 * **Ceci reste une approximation, et elle est nommée.** Les lettres du logo de
 * l'agence sont dessinées à la main — le D porte une coupe oblique qu'aucune
 * fonte ne donne. Toute reconstruction dans la fonte fonctionnelle du système,
 * y compris celle de la planche de design, s'en écarte. Le vectoriel est réclamé ; d'ici là, `tokens.json`
 * porte ce manque dans `$meta.unconfirmed` plutôt que de laisser croire que la
 * question est réglée.
 */
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { tokens, useColors, type ColorName } from '../theme';
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

/**
 * Proportion du trait.
 *
 * **Amincie avec la v1.0** : le logo de l'agence est monoline et fin, et un
 * trait calé sur celui des icônes — qui vient lui-même de passer à 2 — donnait
 * un signe plus gras que la marque qu'il représente.
 */
const TRAIT = 2 / 32;

export function Logo({
  taille = 32,
  couleur = 'ink.default',
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
      accessibilityLabel={tokens.logo.wordmark.text}
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
  couleur = 'ink.default',
  /**
   * `AGENCY` sous le sigle. Réservée aux écrans où la marque **se présente** —
   * accueil, connexion — et absente partout où elle ne fait que situer.
   */
  signature = false,
  testID,
}: {
  taille?: number;
  couleur?: ColorName;
  signature?: boolean;
  testID?: string;
}) {
  return (
    <View testID={testID} style={{ alignItems: signature ? 'center' : 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: taille * 0.3 }}>
        <Logo taille={taille} couleur={couleur} />
        <Texte
          variante="type.wordmark"
          couleur={couleur}
          style={{ fontSize: taille * 0.72, lineHeight: taille * 0.86 }}
        >
          {tokens.logo.wordmark.text}
        </Texte>
      </View>
      {signature ? (
        <Texte
          variante="type.tagline"
          couleur={couleur}
          align="center"
          testID="signature-agence"
          // L'interlettrage pousse la dernière lettre hors du bloc centré : le
          // décalage à gauche le recentre optiquement, ce qu'aucun `align` ne
          // fait — le texte est centré, le blanc final ne l'est pas.
          style={{ marginTop: taille * 0.18, marginLeft: tokens.logo.tagline.letterSpacing }}
        >
          {tokens.logo.tagline.text}
        </Texte>
      ) : null}
    </View>
  );
}
