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

import { type ColorName, tokens, typography, useColors } from '../theme';

export type Variante = keyof typeof typography;

const POLICES = tokens.typography.fontFamily;

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
          fontWeight: echelle.fontWeight as never,
          letterSpacing: 'letterSpacing' in echelle ? echelle.letterSpacing : undefined,
          fontFamily: POLICES[echelle.fontFamily as keyof typeof POLICES],
          color: c[couleur],
          textAlign: align,
        },
        style,
      ]}
    />
  );
}
