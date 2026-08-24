/**
 * Champ de saisie.
 *
 * **Le message d'erreur remplace l'aide, il ne s'y ajoute pas.** Empiler les
 * deux ferait grandir le champ au moment de l'erreur et pousserait le reste du
 * formulaire vers le bas, sous le doigt de quelqu'un qui appuyait déjà.
 *
 * **Le focus épaissit la bordure sans halo**, et le padding est compensé pour
 * que le texte ne bouge pas d'un pixel quand on entre dans le champ.
 *
 * **Et cette bordure est une encre, jamais l'orange.** Sur un écran qui porte
 * de l'orange — un bouton principal, un filet d'onglet actif, un badge de
 * palier — un focus orange se perd dans le décor. Deux pixels d'encre, eux, ne
 * se confondent avec rien. C'est aussi la seule marque de focus du système :
 * la direction v1.0 n'a pas de halo, et un anneau flou n'existe pas en
 * React Native sans une ombre, qui est réservée à ce qui flotte.
 *
 * Le commentaire annonçait ce focus depuis la v0.4 et **rien ne l'implémentait** :
 * le champ n'écoutait ni `onFocus` ni `onBlur`, et la bordure restait à 1 px
 * d'un bout à l'autre de la saisie. Un focus décrit dans un commentaire n'est
 * pas un focus.
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
  const [enFocus, setEnFocus] = useState(false);
  // **Toujours masqué au départ**, y compris après une erreur : on ne laisse
  // pas un mot de passe révélé par un écran précédent.
  const [revele, setRevele] = useState(false);

  return (
    <View style={{ gap: 6 }}>
      <Texte variante="type.label" couleur="ink.soft">
        {label}
      </Texte>
      <View
        style={{
          minHeight: lignes ? 24 * lignes + 20 : size.field,
          borderRadius: radius['radius.md'],
          // L'erreur prime sur le focus : un champ refusé qu'on rouvre doit
          // continuer de dire qu'il est refusé.
          borderWidth: enErreur || enFocus ? 2 : 1,
          borderColor: enErreur
            ? c['status.danger.rule']
            : enFocus
              ? c['line.ink']
              : c['line.default'],
          backgroundColor: disabled
            ? c['bg.deep']
            : enErreur
              ? c['status.danger.surface']
              : 'transparent',
          // **Rien ne se peint hors du rayon.** Sur le web, l'`input` est un
          // enfant carré qui porte son propre fond : l'autoremplissage le
          // rendait visible aux quatre coins, débordant d'un champ qu'on croyait
          // arrondi. Le rayon vit sur ce conteneur, donc c'est lui qui découpe —
          // et il découpe tout, pas seulement ce qu'on avait prévu.
          overflow: 'hidden',
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
          placeholderTextColor={c['ink.mute']}
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
          onFocus={() => setEnFocus(true)}
          onBlur={() => setEnFocus(false)}
          style={{
            flex: 1,
            // Le pixel de bordure gagné au focus est repris sur le padding :
            // sans cette compensation, tout le texte se décale d'un pixel au
            // moment précis où le curseur arrive dessus.
            paddingHorizontal: enErreur || enFocus ? 13 : 14,
            paddingVertical: enErreur || enFocus ? 9 : 10,
            color: c[disabled ? 'ink.faint' : 'ink.default'],
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
            style={({ pressed }) => ({ paddingHorizontal: 12, height: '100%', justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icone
              nom={revele ? 'oeil-barre' : 'oeil'}
              couleur={disabled ? 'ink.faint' : 'ink.mute'}
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
              borderRadius: radius['radius.pill'],
              // Le filet du statut, pas son encre : c'est une pastille, une
              // surface, et la v1.0 sépare les deux.
              backgroundColor: c['status.danger.rule'],
            }}
          />
          <Texte variante="type.caption" couleur="status.danger.text" style={{ flexShrink: 1 }}>
            {errorText}
          </Texte>
        </View>
      ) : helpText ? (
        <Texte variante="type.caption" couleur="ink.mute">
          {helpText}
        </Texte>
      ) : null}
    </View>
  );
}
