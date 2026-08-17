/**
 * Le logotype.
 *
 * **La marque est le mot, et le point est sa couleur.** `B!ND`, le point
 * d'exclamation à la place du I. Les lettres prennent l'encre du fond — encre
 * sur os et papier, blanc sur encre, satin et orange — et **seul le point du
 * « ! » est orange**, dans les deux cas. C'est la seule couleur du logotype, et
 * c'est elle qui fait la marque.
 *
 * **Le « ! » ne peut donc pas être un caractère.** Posé en texte, son fût
 * prendrait la couleur du point : une couleur de texte s'applique au glyphe
 * entier, et rien ne permet d'en peindre la moitié. Il se dessine — fût plus
 * point rond — et c'est une contrainte d'implémentation, pas une préférence.
 * Le mot se compose donc en trois morceaux : `B`, le signe, `ND`.
 *
 * **Le tracé vient de la fonte, il n'est pas inventé.** Mesuré sur le fichier
 * que l'application embarque, à 400 px : le fût s'affine de 31 à 22 pixels, et
 * le point est rond, de diamètre égal à la largeur haute du fût. Un rectangle
 * droit à côté de trois lettres de la même fonte se verrait — ce n'est pas un
 * pictogramme posé près du mot, c'est une de ses lettres.
 *
 * ---
 *
 * ## Ce que ce fichier a porté, et pourquoi la règle a changé deux fois
 *
 * Il a d'abord dessiné un « B » construit — deux arcs inégaux tenus par un axe
 * débordant — hérité du système vert. La v1.0 l'a *repeint sans le regarder* :
 * il a traversé le remplacement complet du système, changé de couleur, gardé sa
 * forme, et il était encore en tête de l'accueil en ligne quand tout le reste
 * avait changé.
 *
 * Puis il a porté un logotype **monochrome**, avec `AGENCY` dessous. Les deux
 * étaient faux, et l'erreur était méthodique : la règle avait été déduite de
 * visuels Instagram entièrement blancs sur orange, **où un point orange ne peut
 * pas se distinguer du fond**. L'information manquait de la seule source
 * disponible, et il en est sorti une règle au lieu d'une incertitude. Le
 * vectoriel de la fondatrice montre des lettres noires et un point orange.
 *
 * **Aucune signature.** Ni `AGENCY`, ni `CRÉATEUR DE LIEN` — cette dernière est
 * en français, et BIND s'adresse à Miami en anglais et en espagnol.
 *
 * ---
 *
 * ## Où le logotype a le droit d'aller
 *
 * **Le logotype partout où on a la place de le lire, la marque compacte
 * partout ailleurs. Le seuil est la lisibilité des quatre lettres, pas le
 * support.**
 *
 * Ce composant **refuse** de rendre sous le plancher, comme `Texte` refuse une
 * surface employée en encre. Un logotype illisible ne se signale pas : il
 * ressemble à un logotype, en plus petit, et il traverse une revue. C'est
 * exactement ainsi que l'ancien monogramme est passé.
 *
 * Le plancher n'est pas écrit, il se calcule depuis deux mesures tenues dans
 * `produit.json` — la largeur d'une lettre dans la fonte, et le minimum de
 * pixels par lettre.
 *
 * **Ceci reste une approximation, et elle est nommée.** Les lettres du logo de
 * l'agence sont dessinées à la main — le D porte une coupe oblique qu'aucune
 * fonte ne donne. Le rendu dans la fonte fonctionnelle du système s'en écarte.
 * Le vectoriel est réclamé ; d'ici là `tokens.json` porte ce manque dans
 * `$meta.unconfirmed`, plutôt que de laisser croire que la question est réglée.
 */
import Svg, { G, Path } from 'react-native-svg';

import { ENCRES_DU_LOGOTYPE, produit, tokens } from '../theme';
import { BOITE, LETTRES, POINT, REPERE } from './logotype';



/**
 * La taille sous laquelle le logotype ne se lit plus, et se refuse.
 *
 * Calculée, pas choisie. `taille` est la **hauteur** du tracé ; la boîte du mot
 * fait 1991 sur 682, donc une lettre vaut un quart de 2,919 fois la hauteur, et
 * il en faut dix pixels. Quatorze, aujourd'hui.
 *
 * Le plancher a baissé de vingt-quatre à quatorze, et ce n'est pas un
 * relâchement : `taille` désignait un corps de fonte dont l'encre n'occupait
 * qu'une part, elle désigne maintenant l'encre elle-même.
 */
export const PLANCHER_DU_LOGOTYPE = Math.ceil(
  produit.marque.pixelsParLettreMinimum / produit.marque.largeurParLettre,
);

/** Les deux fonds possibles. Le point ne change pas d'un cas à l'autre. */
export type VarianteDuLogotype = 'encre' | 'blanc';

/**
 * Le mot.
 *
 * `taille` est sa hauteur de référence. `variante` dit le fond, jamais une
 * couleur : un appelant qui choisit une encre choisit tôt ou tard celle du
 * point, et le logotype cesse d'avoir sa couleur.
 */
export function Marque({
  taille = 23,
  variante = 'encre',
  testID,
}: {
  taille?: number;
  variante?: VarianteDuLogotype;
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

  const encre = ENCRES_DU_LOGOTYPE[variante];
  const largeur = taille * (BOITE.largeur / BOITE.hauteur);

  return (
    <Svg
      testID={testID}
      width={largeur}
      height={taille}
      viewBox={`${BOITE.x} ${BOITE.y} ${BOITE.largeur} ${BOITE.hauteur}`}
      accessibilityRole="image"
      accessibilityLabel={tokens.logo.wordmark.text}
    >
      <G transform={REPERE}>
        {/* Les lettres et le fût suivent le fond. */}
        <Path testID={testID ? `${testID}-lettres` : undefined} d={LETTRES} fill={encre} />
        {/* Le point ne les suit pas : c'est la seule couleur du logotype. */}
        <Path
          testID={testID ? `${testID}-point` : undefined}
          d={POINT}
          fill={ENCRES_DU_LOGOTYPE.point}
        />
      </G>
    </Svg>
  );
}
