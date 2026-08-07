/**
 * Message d'état.
 *
 * **Ce qui s'est passé, puis quoi faire.** Toujours dans cet ordre, et jamais
 * de code technique en face utilisateur. Un « oops » ou un identifiant de
 * requête ne dit rien à quelqu'un qui voulait réserver un soin.
 *
 * Il n'existe pas de niveau `success` : une chose qui a marché se voit à
 * l'écran qui a changé, pas à un bandeau vert qu'il faut fermer.
 */
import { View } from 'react-native';

import { radius, useColors, type ColorName } from '../theme';
import { Button, type ButtonProps } from './Button';
import { Texte } from './Texte';

export type Niveau = 'danger' | 'warning' | 'neutral';

const FOND: Record<Niveau, ColorName> = {
  danger: 'status.danger.subtle',
  warning: 'status.warning.subtle',
  neutral: 'bg.raised',
};
const TEINTE: Record<Niveau, ColorName> = {
  danger: 'status.danger',
  warning: 'status.warning',
  neutral: 'border.default',
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

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{
        padding: 14,
        borderRadius: radius['radius.lg'],
        backgroundColor: c[FOND[level]],
        borderWidth: 1,
        borderColor: c[TEINTE[level]],
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            marginTop: 2,
            backgroundColor: c[TEINTE[level]],
          }}
        />
        <View style={{ flex: 1, gap: 4 }}>
          {title ? <Texte variante="type.label">{title}</Texte> : null}
          <Texte variante="type.caption" couleur="text.secondary">
            {body}
          </Texte>
        </View>
      </View>
      {action ? <Button {...action} size={action.size ?? 'sm'} /> : null}
    </View>
  );
}
