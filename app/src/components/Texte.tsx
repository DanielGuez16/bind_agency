/**
 * Le texte, et rien d'autre.
 *
 * Tous les composants passent par ici plutôt que par `Text` de React Native,
 * pour deux raisons.
 *
 * **L'échelle typographique.** Écrire une taille en dur dans un composant
 * recréerait une seconde échelle à côté de celle du design, et c'est la
 * seconde qu'on oublie quand la première bouge.
 *
 * **L'espagnol.** Les libellés y sont jusqu'à 30 % plus longs, et la règle
 * « aucune troncature sur une action ni sur un statut » ne tient que si
 * personne ne peut poser `numberOfLines` par distraction. Le prop existe, mais
 * il s'appelle `ellipseSurNomPropre` : on ne l'écrit pas sans y penser, et il
 * se remarque en relecture.
 */
import { Text as TextNatif, type TextProps as TextPropsNatif } from 'react-native';

import { type ColorName, nomDeFonte, type RoleDeFonte, typography, useColors } from '../theme';

export type Variante = keyof typeof typography;

/**
 * **La graisse fait partie du nom, elle n'est plus un attribut.** Sur iOS et
 * Android, `fontWeight` ne choisit pas un fichier : une graisse absente est
 * synthétisée par le moteur, ce qui donne un gras baveux au lieu du dessin
 * voulu. Chaque graisse est enregistrée sous son propre nom, et c'est ce nom
 * qu'on demande.
 *
 * **`fontWeight` n'est plus posé du tout.** Chaque fichier est enregistré sous
 * son propre nom, sans descripteur de graisse : pour le navigateur, cette face
 * est donc de graisse normale. Lui demander 600 par-dessus la faisait
 * **grossir une seconde fois**, par synthèse, au-dessus d'un semi-gras déjà
 * dessiné. Le nom porte la graisse, et lui seul.
 */

export type TexteProps = Omit<TextPropsNatif, 'style'> & {
  variante?: Variante;
  /** Un nom de jeton, jamais une couleur. Défaut : `text.primary`. */
  couleur?: ColorName;
  align?: 'left' | 'center' | 'right';
  /**
   * L'ellipse est réservée aux **noms propres** — salon, créatrice — sur une
   * seule ligne. Jamais sur une action ni sur un statut : un bouton tronqué ne
   * dit plus ce qu'il fait, et un statut tronqué ment.
   */
  ellipseSurNomPropre?: boolean;
  style?: TextPropsNatif['style'];
};

export function Texte({
  variante = 'type.body',
  couleur = 'text.primary',
  align,
  ellipseSurNomPropre,
  style,
  ...reste
}: TexteProps) {
  const c = useColors();
  const echelle = typography[variante];

  return (
    <TextNatif
      {...reste}
      numberOfLines={ellipseSurNomPropre ? 1 : undefined}
      ellipsizeMode={ellipseSurNomPropre ? 'tail' : undefined}
      style={[
        {
          fontSize: echelle.fontSize,
          lineHeight: echelle.lineHeight,

          letterSpacing: 'letterSpacing' in echelle ? echelle.letterSpacing : undefined,
          fontFamily: nomDeFonte(echelle.fontFamily as RoleDeFonte, echelle.fontWeight),
          color: c[couleur],
          textAlign: align,
        },
        style,
      ]}
    />
  );
}
