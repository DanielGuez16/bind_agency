/**
 * La marque.
 *
 * **La marque est le mot.** `B!ND`, le point d'exclamation à la place du I,
 * `AGENCY` centré dessous en lettres très espacées, trait fin et monochrome.
 * Il n'y a pas de signe à côté du mot : le mot *est* le signe.
 *
 * **Ce que ce fichier a porté jusqu'ici.** Il dessinait un « B » construit —
 * deux arcs inégaux tenus par un axe qui dépassait en haut et en bas — hérité
 * du système vert, où il valait monogramme. La v1.0 l'a repeint sans le
 * regarder : il a traversé le remplacement complet du système, changé de
 * couleur, gardé sa forme, et il était encore en tête de l'accueil en ligne
 * pendant que tout le reste avait changé. Une direction artistique se remplace
 * en entier ou pas du tout ; recolorer le signe de l'ancienne revient à la
 * garder.
 *
 * **Une seule couleur par occurrence.** Encre sur os ou papier, clair sur
 * orange, satin ou encre. Le point d'exclamation n'est **jamais coloré à
 * part** : c'est une lettre, pas un accent, et c'est la faute que la première
 * lecture du brief avait commise.
 *
 * **Ceci reste une approximation, et elle est nommée.** Les lettres du logo de
 * l'agence sont dessinées à la main — le D porte une coupe oblique qu'aucune
 * fonte ne donne. Le rendu dans la fonte fonctionnelle du système
 * s'en écarte. Le vectoriel est réclamé ;
 * d'ici là `tokens.json` porte ce manque dans `$meta.unconfirmed`, plutôt que
 * de laisser croire que la question est réglée.
 */
import { View } from 'react-native';

import { tokens, useColors, type ColorName } from '../theme';
import { Texte } from './Texte';

/**
 * Le mot, et sa signature quand la marque se présente.
 *
 * `taille` est la hauteur de référence du mot, pas celle d'une boîte : il n'y a
 * plus de carré à côté duquel s'aligner. L'espacement des lettres est celui du
 * nom et non du texte courant — quatre lettres serrées ne se lisent pas comme
 * une marque.
 */
export function Marque({
  taille = 40,
  couleur = 'ink.default',
  /**
   * `AGENCY` sous le mot. Réservée aux écrans où la marque **se présente** —
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
      <Texte
        variante="type.wordmark"
        couleur={couleur}
        style={{ fontSize: taille * 0.72, lineHeight: taille * 0.86 }}
      >
        {tokens.logo.wordmark.text}
      </Texte>
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
