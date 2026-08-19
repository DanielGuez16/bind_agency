/**
 * Composants du back office. Web dense, conçu pour 1360.
 *
 * **La gouttière droite des colonnes numériques est obligatoire.** Sans ses
 * 14 points, une valeur alignée à droite touche la colonne suivante et se lit
 * comme si elle lui appartenait — ce qui, sur une table de décision, fait
 * trancher sur le mauvais chiffre.
 *
 * **Un motif choisi dans une liste fermée est obligatoire pour toute décision
 * autre qu'une approbation.** La barre de décision le refuse structurellement :
 * `DecisionBar` demande un motif à chaque action qui n'est pas une approbation,
 * et ne peut pas être appelée sans.
 */
import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useRaccourcis } from '../shell/useRaccourcis';

import { breakpoint, radius, useColors } from '../theme';
import { Texte } from './Texte';

export type Colonne = {
  cle: string;
  label: string;
  largeur: number;
  /** Aligné à droite, en mono, avec la gouttière. */
  chiffre?: boolean;
};

const GOUTTIERE = 14;

export function TableHeader({ colonnes, testID }: { colonnes: Colonne[]; testID?: string }) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        height: 30,
        alignItems: 'center',
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      }}
    >
      {colonnes.map((colonne) => (
        <View
          key={colonne.cle}
          testID={`entete-${colonne.cle}`}
          style={{
            width: colonne.largeur,
            alignItems: colonne.chiffre ? 'flex-end' : 'flex-start',
            paddingRight: colonne.chiffre ? GOUTTIERE : 0,
          }}
        >
          <Texte variante="type.caption" couleur="ink.mute">
            {colonne.label}
          </Texte>
        </View>
      ))}
    </View>
  );
}

export function TableRow({
  colonnes,
  valeurs,
  actif,
  onPress,
  testID,
}: {
  colonnes: Colonne[];
  valeurs: Record<string, string>;
  actif?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: actif }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        minHeight: 36,
        alignItems: 'center',
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
        backgroundColor: actif ? c['brand.50'] : 'transparent',
        borderLeftWidth: 3,
        borderLeftColor: actif ? c['brand.700'] : 'transparent',
          opacity: pressed ? 0.7 : 1,
        })}
    >
      {colonnes.map((colonne) => (
        <View
          key={colonne.cle}
          style={{
            width: colonne.largeur,
            alignItems: colonne.chiffre ? 'flex-end' : 'flex-start',
            paddingRight: colonne.chiffre ? GOUTTIERE : 0,
          }}
        >
          <Texte
            variante={colonne.chiffre ? 'type.mono' : 'type.caption'}
            ellipseSurNomPropre={!colonne.chiffre}
          >
            {valeurs[colonne.cle] ?? ''}
          </Texte>
        </View>
      ))}
    </Pressable>
  );
}

export function KeyHint({ touche }: { touche: string }) {
  const c = useColors();
  return (
    <View
      style={{
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <Texte variante="type.mono" couleur="ink.soft" style={{ fontSize: 10 }}>
        {touche}
      </Texte>
    </View>
  );
}

export function DetailPanel({
  titre,
  identifiant,
  children,
  testID,
}: {
  titre: string;
  /** L'identifiant technique reste en anglais brut, jamais traduit. */
  identifiant: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        // La passation v0.6 fixe 440, dans la fourchette 400–470. La valeur
        // était écrite ici ; elle vient maintenant du jeton.
        width: breakpoint.detailPanelAdmin,
        borderLeftWidth: 1,
        borderLeftColor: c['line.default'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <View
        style={{
          height: 36,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: c['line.default'],
        }}
      >
        <Texte variante="type.label">{titre}</Texte>
        <Texte variante="type.mono" couleur="ink.mute" style={{ fontSize: 11 }}>
          {identifiant}
        </Texte>
      </View>
      <ScrollView>{children}</ScrollView>
    </View>
  );
}

export type Decision = {
  cle: string;
  label: string;
  touche: string;
  /**
   * Le nom accessible, quand le libellé ne suffit pas à désigner l'objet.
   *
   * « Approve » ne dit pas ce qu'on approuve. À l'œil, le panneau ouvert au-
   * dessus le dit ; à l'oreille, la barre arrive seule, et trois boutons
   * identiques d'un dossier à l'autre ne se distinguent plus.
   */
  accessibilityLabel?: string;
  /** Vrai pour une approbation seulement. Toute autre décision exige un motif. */
  approbation?: boolean;
  onPress: () => void;
};

export function DecisionBar({
  decisions,
  /** Le motif choisi. Sans lui, les décisions non approbatives sont retirées. */
  motif,
  testID,
}: {
  decisions: Decision[];
  motif?: string;
  testID?: string;
}) {
  const c = useColors();

  // Le bouton est **retiré**, pas grisé : une action impossible ne se grise que
  // si elle redeviendra possible d'elle-même, ce qui n'est pas le cas ici —
  // c'est à l'arbitre de choisir un motif.
  const offertes = decisions.filter((decision) => decision.approbation || motif);

  // **La pastille tenait une promesse que rien n'écoutait.** Elle dessinait
  // « A », « R », « N » depuis le début, et le clavier ne servait à rien : qui
  // traite vingt dossiers à la chaîne y croit, appuie, n'obtient rien, puis
  // cesse d'y croire. Les raccourcis suivent exactement les décisions offertes —
  // un raccourci qui survivrait à son bouton ferait ce que le bouton refuse.
  useRaccourcis(
    useMemo(
      () => offertes.map(({ touche, onPress }) => ({ touche, action: onPress })),
      // La liste se reconstruit à chaque rendu ; c'est son contenu qui compte.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [offertes.map((d) => d.touche).join(''), ...offertes.map((d) => d.onPress)],
    ),
  );

  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: 6, padding: 12 }}>
      {offertes
        .map((decision) => (
          <Pressable
            key={decision.cle}
            accessibilityRole="button"
            accessibilityLabel={decision.accessibilityLabel ?? decision.label}
            onPress={decision.onPress}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 34,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: radius['radius.lg'],
              borderWidth: 1,
              borderColor: c['line.default'],
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <KeyHint touche={decision.touche} />
            <Texte variante="type.caption" style={{ flexShrink: 1 }}>
              {decision.label}
            </Texte>
          </Pressable>
        ))}
    </View>
  );
}

export function Toolbar({
  children,
  compteurSelection,
  actionsDeMasse,
  testID,
}: {
  children?: React.ReactNode;
  compteurSelection?: string;
  /**
   * Permises **uniquement** sur les approbations et les relances de jobs.
   * L'appelant en porte la responsabilité ; le composant ne les invente pas.
   */
  actionsDeMasse?: React.ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 }}>{children}</View>
      {compteurSelection ? (
        <Texte variante="type.caption" couleur="ink.soft">
          {compteurSelection}
        </Texte>
      ) : null}
      {actionsDeMasse}
    </View>
  );
}
