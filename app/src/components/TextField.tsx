/**
 * Champ de saisie.
 *
 * **Le message d'erreur remplace l'aide, il ne s'y ajoute pas.** Empiler les
 * deux ferait grandir le champ au moment de l'erreur et pousserait le reste du
 * formulaire vers le bas, sous le doigt de quelqu'un qui appuyait déjà.
 *
 * **Le focus épaissit la bordure sans halo**, et le padding est compensé pour
 * que le texte ne bouge pas d'un pixel quand on entre dans le champ.
 */
import { TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { radius, size, useColors } from '../theme';
import { Texte } from './Texte';

export type TextFieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  helpText?: string;
  /** Présent ⇒ état erreur. Il n'y a pas d'autre façon de le déclarer. */
  errorText?: string;
  disabled?: boolean;
  keyboard?: 'default' | 'numeric' | 'code';
  autoFocus?: boolean;
  onChangeText?: (v: string) => void;
  testID?: string;
};

const CLAVIERS: Record<string, KeyboardTypeOptions> = {
  default: 'default',
  numeric: 'number-pad',
  code: 'default',
};

export function TextField({
  label,
  value,
  placeholder,
  helpText,
  errorText,
  disabled = false,
  keyboard = 'default',
  autoFocus,
  onChangeText,
  testID,
}: TextFieldProps) {
  const c = useColors();
  const enErreur = errorText !== undefined;

  return (
    <View style={{ gap: 6 }}>
      <Texte variante="type.label" couleur="text.secondary">
        {label}
      </Texte>
      <View
        style={{
          minHeight: size.control.md,
          borderRadius: radius['radius.md'],
          borderWidth: 1,
          borderColor: enErreur ? c['status.danger'] : c['border.default'],
          backgroundColor: disabled
            ? c['bg.sunken']
            : enErreur
              ? c['status.danger.subtle']
              : 'transparent',
          justifyContent: 'center',
        }}
      >
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={c['text.muted']}
          keyboardType={CLAVIERS[keyboard]}
          autoCapitalize={keyboard === 'code' ? 'characters' : 'none'}
          autoCorrect={false}
          autoFocus={autoFocus}
          onChangeText={onChangeText}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            color: c[disabled ? 'text.disabled' : 'text.primary'],
            fontSize: 15,
            lineHeight: 23,
          }}
        />
      </View>
      {/* L'erreur remplace l'aide : la hauteur du bloc ne bouge pas. */}
      {enErreur ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              backgroundColor: c['status.danger'],
            }}
          />
          <Texte variante="type.caption" couleur="status.danger" style={{ flexShrink: 1 }}>
            {errorText}
          </Texte>
        </View>
      ) : helpText ? (
        <Texte variante="type.caption" couleur="text.muted">
          {helpText}
        </Texte>
      ) : null}
    </View>
  );
}
