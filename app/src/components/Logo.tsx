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
 * ---
 *
 * ## Où le logotype a le droit d'aller
 *
 * **Le logotype partout où on a la place de le lire, la marque compacte
 * partout ailleurs. Le seuil est la lisibilité des quatre lettres, pas le
 * support.**
 *
 * La règle a coûté deux découvertes. Le logotype réduit à seize pixels donnait
 * quatre taches — d'où la marque compacte, livrée par Design. Puis la tuile
 * d'application, qu'on avait gardée au logotype *parce qu'elle est fournie en
 * 1024*, jusqu'à mesurer ce qu'un lanceur en affiche : vingt-sept pixels de
 * large pour quatre lettres à 48 dp. La résolution du fichier n'a jamais été la
 * question ; ce que l'œil reçoit l'a toujours été.
 *
 * Ce composant **refuse** donc de rendre sous le plancher, comme `Texte` refuse
 * une surface employée en encre. Un logotype illisible ne se signale pas : il
 * ressemble à un logotype, en plus petit, et il traverse une revue. C'est très
 * exactement ainsi que l'ancien monogramme a traversé le remplacement du
 * système.
 *
 * Le plancher n'est pas écrit, il se calcule depuis deux mesures tenues dans
 * `produit.json` — la largeur d'une lettre dans la fonte, et le minimum de
 * pixels par lettre.
 *
 * **Ceci reste une approximation, et elle est nommée.** Les lettres du logo de
 * l'agence sont dessinées à la main — le D porte une coupe oblique qu'aucune
 * fonte ne donne. Le rendu dans la fonte fonctionnelle du système
 * s'en écarte. Le vectoriel est réclamé ;
 * d'ici là `tokens.json` porte ce manque dans `$meta.unconfirmed`, plutôt que
 * de laisser croire que la question est réglée.
 */
import { View } from 'react-native';

import { produit, tokens, type ColorName } from '../theme';
import { Texte } from './Texte';

/**
 * Le mot, et sa signature quand la marque se présente.
 *
 * `taille` est la hauteur de référence du mot, pas celle d'une boîte : il n'y a
 * plus de carré à côté duquel s'aligner. L'espacement des lettres est celui du
 * nom et non du texte courant — quatre lettres serrées ne se lisent pas comme
 * une marque.
 */
/**
 * Le rapport entre `taille` et le corps du mot.
 *
 * Il vaut ce que la composition lui donne plus bas ; nommé ici parce que le
 * plancher s'en déduit, et qu'un rapport écrit à deux endroits finirait par
 * diverger de celui qui rend.
 */
const CORPS_POUR_TAILLE = 0.72;

/**
 * La taille sous laquelle le logotype ne se lit plus, et se refuse.
 *
 * Calculée, pas choisie : `taille × 0,72` donne le corps, `corps × 0,592` donne
 * la largeur d'une lettre, et il en faut dix pixels. Vingt-quatre, aujourd'hui.
 */
export const PLANCHER_DU_LOGOTYPE = Math.ceil(
  produit.marque.pixelsParLettreMinimum / (CORPS_POUR_TAILLE * produit.marque.largeurParLettre),
);

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
  if (taille < PLANCHER_DU_LOGOTYPE) {
    throw new Error(
      `Le logotype ne se lit plus à ${taille} : sous ${PLANCHER_DU_LOGOTYPE}, ` +
        `« ${tokens.logo.wordmark.text} » donne moins de ` +
        `${produit.marque.pixelsParLettreMinimum} pixels par lettre. ` +
        "C'est la marque compacte qu'il faut ici — celle du favicon et des tuiles.",
    );
  }

  return (
    <View testID={testID} style={{ alignItems: signature ? 'center' : 'flex-start' }}>
      <Texte
        variante="type.wordmark"
        couleur={couleur}
        style={{ fontSize: taille * CORPS_POUR_TAILLE, lineHeight: taille * 0.86 }}
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
