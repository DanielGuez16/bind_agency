/**
 * Message d'état.
 *
 * **Ce qui s'est passé, puis quoi faire.** Toujours dans cet ordre, et jamais
 * de code technique en face utilisateur. Un « oops » ou un identifiant de
 * requête ne dit rien à quelqu'un qui voulait réserver un soin.
 *
 * Il n'existe pas de niveau `success` : une chose qui a marché se voit à
 * l'écran qui a changé, pas à un bandeau vert qu'il faut fermer.
 *
 * ---
 *
 * **L'avertissement a perdu sa couleur, et son glyphe est devenu
 * obligatoire.** C'est la conséquence la plus lourde de la direction v1.0, et
 * elle est volontaire. Un ambre d'avertissement dans un système orange est
 * indiscernable de la marque : l'utilisateur lit une mise en avant, pas une
 * alerte. L'avertissement devient donc neutre et emphatique — fond `bg.inset`,
 * encre, filet d'encre — et le glyphe est le **seul marqueur qui lui reste**.
 *
 * Un avertissement sans glyphe est un bug, pas un choix. La règle est portée
 * par le composant et non par l'appelant : il n'y a aucun moyen d'en rendre un
 * sans, parce qu'il n'y a aucun prop pour l'enlever.
 *
 * **Et le glyphe est une forme, pas une pastille.** Les trois niveaux
 * portaient le même rond de 14 px, qui ne disait rien de plus que sa couleur.
 * Le triangle de l'avertissement porte l'alerte à lui seul : c'est ce qui
 * reste quand la teinte est partie.
 *
 * **Le danger passe au cramoisi.** L'ancien rouge de la v0.4 tirait sur
 * l'orange et se confondait avec la marque en vision protanope — c'est-à-dire
 * chez ceux pour qui le rouge compte le plus. La valeur est dans les jetons,
 * pas ici : la garde des couleurs en dur ne fait pas d'exception pour un
 * commentaire, et c'est délibéré — une valeur citée en prose vieillit sans que
 * rien ne la rattrape.
 */
import { View } from 'react-native';

import { radius, useColors, type ColorName } from '../theme';
import { Button, type ButtonProps } from './Button';
import { Icone, type NomIcone } from './Icone';
import { Texte } from './Texte';

export type Niveau = 'danger' | 'warning' | 'neutral';

const FOND: Record<Niveau, ColorName> = {
  danger: 'status.danger.surface',
  warning: 'status.warning.surface',
  neutral: 'bg.surface',
};

/** Le filet de gauche, 3 px, et la couleur du glyphe. */
const FILET: Record<Niveau, ColorName> = {
  danger: 'status.danger.rule',
  warning: 'status.warning.rule',
  neutral: 'line.strong',
};

const TEXTE: Record<Niveau, ColorName> = {
  danger: 'status.danger.text',
  warning: 'status.warning.text',
  neutral: 'ink.default',
};

/**
 * Le glyphe de chaque niveau.
 *
 * `null` pour le neutre, qui n'a rien à signaler et dont un pictogramme ferait
 * une alerte. Les deux autres en ont un, et celui de l'avertissement est le
 * seul dont l'absence serait un défaut.
 */
const GLYPHE: Record<Niveau, NomIcone | null> = {
  danger: 'croix',
  warning: 'alerte',
  neutral: null,
};

export type StatusMessageProps = {
  level: Niveau;
  title?: string;
  /** Ce qui s'est passé, puis quoi faire. */
  body: string;
  action?: ButtonProps;
  testID?: string;
};

export function StatusMessage({ level, title, body, action, testID }: StatusMessageProps) {
  const c = useColors();
  const glyphe = GLYPHE[level];

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{
        padding: 14,
        // Le filet de gauche remplace la bordure complète : trois pixels d'un
        // côté marquent plus qu'un pixel sur quatre côtés, et ils marquent
        // **là où l'œil descend**, au bord du texte.
        borderLeftWidth: 3,
        borderLeftColor: c[FILET[level]],
        borderRadius: radius['radius.md'],
        backgroundColor: c[FOND[level]],
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {glyphe ? (
          <Icone
            nom={glyphe}
            couleur={FILET[level]}
            taille={18}
            // Nommé : la règle « le glyphe d'avertissement est obligatoire » se
            // vérifie sur le glyphe lui-même, sans plonger dans l'arbre par
            // type de composant — ce qui casserait au premier `View` ajouté.
            testID={`glyphe-${level}`}
          />
        ) : null}
        <View style={{ flex: 1, gap: 4 }}>
          {title ? (
            <Texte variante="type.label" couleur={TEXTE[level]}>
              {title}
            </Texte>
          ) : null}
          <Texte variante="type.caption" couleur="ink.soft">
            {body}
          </Texte>
        </View>
      </View>
      {action ? <Button {...action} size={action.size ?? 'sm'} /> : null}
    </View>
  );
}
