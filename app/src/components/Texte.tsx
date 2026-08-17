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
 *
 * **Et depuis la v1.0, une troisième : `brand.500` ne s'écrit jamais.** C'est
 * la règle centrale de la direction — la teinte de marque est une surface, et
 * la seule couleur du système qu'on ne peut pas poser sur du texte : 3,0:1 sur
 * blanc, refusé à toute taille. Le point de passage unique la rend tenable
 * autrement qu'à la relecture.
 */
import { Text as TextNatif, type TextProps as TextPropsNatif } from 'react-native';

import {
  type ColorName,
  pileDeFontes,
  type RoleDeFonte,
  typography,
  useColors,
  type Variante,
} from '../theme';

export type { Variante };

/**
 * **La graisse et la voix font partie du nom, elles ne sont plus des
 * attributs.** Sur iOS et Android, `fontWeight` ne choisit pas un fichier :
 * une graisse absente est synthétisée par le moteur, ce qui donne un gras
 * baveux au lieu du dessin voulu. `fontStyle: 'italic'` fait pire encore — il
 * penche la romaine, alors que l'italique d'un Didone est un autre dessin.
 * Chaque couple graisse × voix est enregistré sous son propre nom, et c'est ce
 * nom qu'on demande.
 *
 * **Ni `fontWeight` ni `fontStyle` ne sont posés du tout.** Chaque fichier est
 * enregistré sans descripteur : pour le navigateur, cette face est normale et
 * droite. Lui demander 600 ou l'italique par-dessus la ferait grossir ou
 * pencher **une seconde fois**, par synthèse, au-dessus d'un dessin qui les
 * portait déjà.
 */

/**
 * Les deux valeurs de la rampe qui sont des **surfaces**, jamais des encres.
 *
 * `brand.500` d'abord : la passation l'interdit en toutes lettres, « quelle que
 * soit la taille ou la surface ». `brand.600` avec lui — c'est l'état appuyé de
 * tout ce qui est en 500, donc une surface elle aussi.
 *
 * **Les matières claires — 50, 100, 200, 400 — ne sont pas dans la liste, et ce
 * n'est pas un oubli.** Elles échouent sur un fond clair et tiennent largement
 * sur l'encre, où ce sont précisément elles qui écrivent : « sur fond sombre,
 * contour et teinte s'éclaircissent ». Une garde qui les refuserait partout
 * interdirait le seul endroit où elles servent, et se ferait désactiver dans la
 * semaine. Ce qui les tient là-bas est le fond sur lequel on les pose, pas une
 * liste — et ce fond, un composant de texte ne le connaît pas.
 */
const JAMAIS_UNE_ENCRE: ColorName[] = ['brand.500', 'brand.600'];

export type TexteProps = Omit<TextPropsNatif, 'style'> & {
  variante?: Variante;
  /** Un nom de jeton, jamais une couleur. Défaut : `ink.default`. */
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
  couleur = 'ink.default',
  align,
  ellipseSurNomPropre,
  style,
  ...reste
}: TexteProps) {
  const c = useColors();
  const echelle = typography[variante];

  if (JAMAIS_UNE_ENCRE.includes(couleur)) {
    // Lever, et non retomber sur `brand.700` : un repli silencieux rendrait la
    // faute invisible, et c'est une faute d'accessibilité — 3,0:1, sous le
    // seuil à toute taille. Le message dit quoi écrire à la place, parce qu'un
    // refus qui ne propose rien se contourne.
    throw new Error(
      `${couleur} est une surface, jamais une encre : écrire du texte avec elle donne 3,0:1. Utilisez brand.700.`,
    );
  }

  return (
    <TextNatif
      {...reste}
      numberOfLines={ellipseSurNomPropre ? 1 : undefined}
      ellipsizeMode={ellipseSurNomPropre ? 'tail' : undefined}
      style={[
        {
          fontSize: echelle.fontSize,
          lineHeight: echelle.lineHeight,
          letterSpacing: echelle.letterSpacing,
          textTransform: echelle.textTransform,
          fontFamily: pileDeFontes(
            echelle.fontFamily as RoleDeFonte,
            echelle.fontWeight,
            echelle.fontStyle === 'italic' ? 'italic' : 'normal',
          ),
          color: c[couleur],
          textAlign: align,
        },
        style,
      ]}
    />
  );
}
