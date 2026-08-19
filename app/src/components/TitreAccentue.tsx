/**
 * Le titre, et son mot accentué.
 *
 * **L'accent est un changement de graisse, pas de famille.** Sur les visuels de
 * la fondatrice, « L'accompagnement / Talent by *Bind* » est écrit d'une seule
 * fonte, l'accent portant la variation. La première lecture du brief avait
 * compris deux familles dans le même titre, et c'était faux : il n'y a pas de
 * raccord entre deux fontes à réussir.
 *
 * **En v1.0 l'accent était une italique ; en v1.1 c'est la graisse haute.** Le
 * composant ne change pas pour autant — il demande `type.displayAccent`, et
 * c'est l'échelle qui dit ce que l'accent est aujourd'hui. C'est exactement ce
 * que le composant existe pour absorber. La famille n'est pas nommée ici, et
 * une garde s'en assure : un nom de fonte écrit dans un écran est la première
 * chose qui reste vraie après que la direction a changé.
 *
 * **Les règles vivent dans ce composant, jamais chez l'appelant.** C'est toute
 * la raison de son existence : un titre accentué écrit à la main dans un écran
 * respecte la règle le jour où on l'écrit, et plus le mois suivant.
 *
 * - **Un seul mot.** Deux annulent l'accent — un accent qui porte sur une
 *   moitié de phrase n'accentue rien.
 * - **Rien sous `ecran`.** Le plancher de 34 px protégeait les déliés d'un
 *   serif ; il est tombé avec lui. Ce qui reste est une règle de composition et
 *   non de dessin : un titre d'écran de travail ne s'accentue pas, sinon
 *   l'accent devient la norme et n'accentue plus rien.
 * - **Le bloc ouvre sa ligne.** Posé au milieu d'une phrase, un retour à la
 *   ligne peut le couper en deux et la ponctuation qui suit s'en détache. Il
 *   pend donc sous la ligne du dessus, comme sur ses visuels.
 * - **Le bloc n'est jamais animé.** Une signature qui bouge est une bannière.
 *
 * **Le mot arrive par sa propre clé i18n, jamais par un index de caractères.**
 * L'accent se déplace en espagnol — « Your *tiers* » devient « Tus *niveles* »
 * — et un index se décalerait au premier accord.
 */
import { View } from 'react-native';

import { radius, useColors, type ColorName } from '../theme';
import { Texte } from './Texte';

export type TitreAccentueProps = {
  /** Le titre entier, mot accentué compris. Déjà traduit. */
  texte: string;
  /**
   * Le mot à accentuer, tel qu'il apparaît dans `texte`. Un seul mot ; un
   * groupe est ignoré, et le titre est rendu sans accent.
   */
  motAccentue?: string;
  /**
   * Le bloc plein derrière le mot. **Un par écran au maximum**, et jamais sur
   * un écran de travail quotidien : une garde le compte, elle ne se contente
   * pas d'y compter.
   */
  bloc?: boolean;
  /**
   * `display` pour un écran de seuil qui se présente, `heading` partout
   * ailleurs. `ecran` est le titre de travail : pas d'accent.
   */
  taille?: 'display' | 'heading' | 'ecran';
  /** L'encre du bloc. Blanc par défaut ; l'encre est une variante admise. */
  encreDuBloc?: Extract<ColorName, 'ink.onDark' | 'ink.onBrand'>;
  /**
   * L'encre du titre. Le titre suit la surface sur laquelle il est posé — un
   * voile de photo demande l'encre claire — et le bloc garde la sienne.
   */
  couleur?: ColorName;
  testID?: string;
};

export function TitreAccentue({
  texte,
  motAccentue,
  bloc = false,
  taille = 'heading',
  encreDuBloc = 'ink.onDark',
  couleur = 'ink.default',
  testID,
}: TitreAccentueProps) {
  const c = useColors();

  // Deux mots annulent l'accent, et l'absence du mot dans le titre aussi : un
  // accent qui ne trouve pas sa cible ne doit pas rendre un titre coupé en
  // deux au hasard. C'est le cas d'une traduction qui a bougé sans que la clé
  // de l'accent suive.
  const mot = motAccentue?.trim();
  const accentValide =
    mot !== undefined && mot.length > 0 && !/\s/.test(mot) && texte.includes(mot);

  // Un titre de travail ne s'accentue pas. La règle est portée par la taille
  // et non par une intention de l'appelant : c'est ce qui l'empêche de se
  // répandre écran par écran.
  if (taille === 'ecran' || !accentValide) {
    return (
      <Texte
        variante={taille === 'ecran' ? 'type.screenTitle' : `type.${taille}`}
        couleur={couleur}
        testID={testID}
      >
        {texte}
      </Texte>
    );
  }

  const variante = `type.${taille}` as const;
  const varianteAccent = taille === 'display' ? 'type.displayAccent' : 'type.headingAccent';

  const coupure = texte.indexOf(mot!);
  const avant = texte.slice(0, coupure).trimEnd();
  const apres = texte.slice(coupure + mot!.length);

  if (!bloc) {
    // Sans bloc, le mot s'insère dans la phrase : la graisse suffit à le
    // détacher, et le texte reste un seul flux que la mise en page peut couper
    // où elle veut.
    return (
      <Texte variante={variante} couleur={couleur} testID={testID}>
        {avant ? `${avant} ` : ''}
        <Texte variante={varianteAccent} couleur={couleur} testID={testID && `${testID}-mot`}>
          {mot}
        </Texte>
        {apres}
      </Texte>
    );
  }

  return (
    <View testID={testID} style={{ alignItems: 'flex-start' }}>
      {avant ? (
        <Texte variante={variante} couleur={couleur}>
          {avant}
        </Texte>
      ) : null}
      {/* Le bloc et sa ponctuation restent solidaires : la virgule qui suit le
          mot appartient au bloc visuellement, et la séparer les ferait
          diverger au premier retour à la ligne. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          testID="bloc-accentue"
          style={{
            backgroundColor: c['brand.500'],
            // **D'équerre, et c'est le seul aplat du produit qui le reste.**
            // La v1.1 arrondit tout le reste ; `radius.none` est réservé à ce
            // bloc. Un aplat de marque aux angles arrondis devient un bouton,
            // et la signature perd la raideur qui la fait lire comme une
            // signature. La bascule Ambre l'avait arrondi avec les 65 autres
            // sites — l'exception ne se déduit pas d'une recherche.
            borderRadius: radius['radius.none'],
            paddingHorizontal: 10,
            paddingBottom: 2,
          }}
        >
          {/* Nommé : c'est le seul nœud de **texte** que porte un titre à
              bloc — le reste est une pile de vues — et c'est sur lui que la
              suite de bout en bout lit la fonte réellement employée. Sans
              point d'accroche, elle lisait le conteneur, qui n'hérite d'aucune
              famille et rendait la pile système. */}
          <Texte
            variante={varianteAccent}
            couleur={encreDuBloc}
            testID={testID && `${testID}-mot`}
          >
            {mot}
          </Texte>
        </View>
        {apres.trim() ? (
          <Texte variante={variante} couleur={couleur}>
            {apres}
          </Texte>
        ) : null}
      </View>
    </View>
  );
}
