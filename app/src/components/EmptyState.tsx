/**
 * État vide.
 *
 * **Jamais un cul-de-sac.** Chaque issue proposée annonce son gain chiffré —
 * « Élargir à 5 km · 9 salons ». Une issue sans chiffre demande de tenter pour
 * voir, et personne ne tente deux fois.
 *
 * Côté commerce, la formule d'encouragement est remplacée par des repères
 * chiffrés sur sept jours : un commerçant ne veut pas être rassuré, il veut
 * savoir si son catalogue est le problème.
 */
import { View } from 'react-native';

import { radius, useTheme } from '../theme';
import { Button, type ButtonProps } from './Button';
import { Texte } from './Texte';

export type EmptyStateProps = {
  title: string;
  body: string;
  /** Une à trois. Chacune annonce son gain chiffré dans son libellé. */
  actions?: ButtonProps[];
  /** Repères chiffrés, côté commerce. Remplacent toute formule creuse. */
  reperes?: { label: string; valeur: string }[];
  testID?: string;
};

export function EmptyState({ title, body, actions = [], reperes, testID }: EmptyStateProps) {
  const { role, color: c } = useTheme();
  const centre = role === 'creator';

  return (
    <View
      testID={testID}
      style={{
        gap: 12,
        alignItems: centre ? 'center' : 'flex-start',
        paddingVertical: 24,
      }}
    >
      <View
        style={{
          width: 54,
          height: 54,
          borderRadius: 999,
          backgroundColor: c['bg.raised'],
        }}
      />
      <Texte variante="type.heading" align={centre ? 'center' : 'left'}>
        {title}
      </Texte>
      <Texte
        variante="type.caption"
        couleur="text.secondary"
        align={centre ? 'center' : 'left'}
      >
        {body}
      </Texte>

      {reperes?.length ? (
        <View
          style={{
            alignSelf: 'stretch',
            borderRadius: radius['radius.lg'],
            borderWidth: 1,
            borderColor: c['border.subtle'],
          }}
        >
          {reperes.map((repere, i) => (
            <View
              key={repere.label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c['border.subtle'],
              }}
            >
              <Texte variante="type.caption" couleur="text.secondary">
                {repere.label}
              </Texte>
              <Texte variante="type.mono">{repere.valeur}</Texte>
            </View>
          ))}
        </View>
      ) : null}

      {actions.length ? (
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          {actions.slice(0, 3).map((action) => (
            <Button key={action.label} {...action} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
