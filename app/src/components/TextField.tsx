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
import { useState } from 'react';
import { Pressable, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { radius, size, useColors } from '../theme';
import { Icone } from './Icone';
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
  /**
   * Un mot de passe : masqué à la frappe, révélable à la demande.
   *
   * Le champ ne l'était pas du tout — le mot de passe s'écrivait en clair, en
   * plein écran, dans un salon ou un café. Et le masquer sans donner le moyen
   * de relire est l'autre moitié du défaut : c'est ce qui fait ressaisir trois
   * fois une chaîne de douze caractères sur un clavier de téléphone.
   */
  secret?: boolean;
  /** Le libellé de la bascule, à traduire par l'appelant. */
  labelRevelation?: { montrer: string; masquer: string };
  /**
   * Un champ de plusieurs lignes, pour une note.
   *
   * **Une hauteur, pas une limite.** `multiline` seul donne un champ d'une
   * ligne qui s'étire en cachant le début de ce qu'on écrit ; la hauteur
   * minimale montre d'emblée qu'on attend une phrase et non un mot. Le nombre
   * de caractères, lui, se borne par `maxLength` — les deux disent des choses
   * différentes et l'un ne remplace pas l'autre.
   */
  lignes?: number;
  /** Borne de saisie. Doit valoir celle du serveur, qui la refuse aussi. */
  maxLength?: number;
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
  secret = false,
  labelRevelation,
  lignes,
  maxLength,
  onChangeText,
  testID,
}: TextFieldProps) {
  const c = useColors();
  const enErreur = errorText !== undefined;
  // **Toujours masqué au départ**, y compris après une erreur : on ne laisse
  // pas un mot de passe révélé par un écran précédent.
  const [revele, setRevele] = useState(false);

  return (
    <View style={{ gap: 6 }}>
      <Texte variante="type.label" couleur="text.secondary">
        {label}
      </Texte>
      <View
        style={{
          minHeight: lignes ? 24 * lignes + 20 : size.control.md,
          borderRadius: radius['radius.md'],
          borderWidth: 1,
          borderColor: enErreur ? c['status.danger'] : c['border.default'],
          backgroundColor: disabled
            ? c['bg.sunken']
            : enErreur
              ? c['status.danger.subtle']
              : 'transparent',
          justifyContent: lignes ? 'flex-start' : 'center',
          // La bascule vit dans la bordure, à droite du texte : posée
          // au-dessus, elle recouvrirait la fin de la saisie.
          flexDirection: 'row',
          alignItems: 'center',
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
          // **`secureTextEntry` seul ne suffit pas.** Sur iOS, un champ
          // masqué que l'on révèle garde la correction automatique et la
          // proposition de mot de passe fort si on ne les coupe pas ; les
          // deux réécrivent la saisie sous les doigts.
          secureTextEntry={secret && !revele}
          autoCapitalize={keyboard === 'code' ? 'characters' : 'none'}
          autoCorrect={false}
          autoFocus={autoFocus}
          multiline={Boolean(lignes)}
          numberOfLines={lignes}
          maxLength={maxLength}
          // Une note se lit du haut : sans cela, un champ multiligne centre
          // son texte verticalement et la première ligne flotte au milieu.
          textAlignVertical={lignes ? 'top' : 'center'}
          onChangeText={onChangeText}
          style={{
            flex: 1,
            paddingHorizontal: 14,
            paddingVertical: 10,
            color: c[disabled ? 'text.disabled' : 'text.primary'],
            fontSize: 15,
            lineHeight: 23,
          }}
        />
        {secret ? (
          <Pressable
            testID={testID ? `${testID}-revelation` : undefined}
            accessibilityRole="button"
            // L'état, pas seulement l'action : une lecture d'écran doit
            // pouvoir dire si le mot de passe est visible en ce moment.
            accessibilityLabel={
              revele ? labelRevelation?.masquer : labelRevelation?.montrer
            }
            accessibilityState={{ selected: revele }}
            disabled={disabled}
            onPress={() => setRevele((avant) => !avant)}
            // Quarante-quatre : la cible tactile minimale. L'icône fait 20,
            // et une cible dimensionnée sur elle se rate une fois sur trois.
            hitSlop={12}
            style={{ paddingHorizontal: 12, height: '100%', justifyContent: 'center' }}
          >
            <Icone
              nom={revele ? 'oeil-barre' : 'oeil'}
              couleur={disabled ? 'text.disabled' : 'text.muted'}
              taille={20}
            />
          </Pressable>
        ) : null}
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
