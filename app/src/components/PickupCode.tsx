/**
 * Les blocs de l'écran de code de retrait. **Hors thème.**
 *
 * Toujours `code.fg` sur `code.bg` — 21:1 — quel que soit le rôle et quel que
 * soit le réglage du téléphone. Un code doit se lire à 1,20 m dans un salon
 * très éclairé ou en plein soleil ; le laisser suivre le thème le rendrait
 * illisible une fois sur deux. Les deux couleurs viennent de `codeColors`,
 * le seul endroit du code autorisé à porter un littéral.
 *
 * **Le code tourne de lui-même toutes les 30 secondes.** Il n'existe donc ni
 * bouton de renouvellement — en proposer un donnerait à croire qu'il faut agir,
 * et laisserait quelqu'un attendre devant un écran qui se met déjà à jour — ni
 * état « expiré » : un code périmé est remplacé par le suivant. Ce qui expire
 * est le **droit de consommer**, et cela se dit sur l'écran de réservation.
 *
 * **Le code de secours ne tourne pas.** Ce qui le protège n'est pas son
 * entropie mais le fait qu'il soit lié à une réservation, à usage unique, à
 * durée courte et limité en tentatives.
 */
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { codeColors, tokens } from '../theme';
import { Texte } from './Texte';

const { fg, bg } = codeColors;
const CONFIG = tokens.code;

/** Six chiffres, 76 points. Annoncés caractère par caractère. */
export function CodeGlyphs({ code, testID }: { code: string; testID?: string }) {
  return (
    <View
      testID={testID}
      accessibilityLabel={code.split('').join(' ')}
      style={{ flexDirection: 'row', justifyContent: 'center' }}
    >
      <Texte
        variante="type.code"
        style={{
          fontSize: CONFIG.codeFontSize,
          lineHeight: CONFIG.codeFontSize + 8,
          color: fg,
        }}
      >
        {code}
      </Texte>
    </View>
  );
}

/**
 * Les secondes avant la rotation suivante, en chiffres.
 *
 * Jamais en anneau de progression : un anneau ne se lit pas de loin, et c'est
 * de loin que cet écran est regardé. Sous 10 s, le bloc s'inverse — le seuil de
 * 60 s valait pour un code qui expirait, pas pour un code qui tourne.
 */
export function Countdown({
  secondes,
  testID,
}: {
  secondes: number;
  testID?: string;
}) {
  const urgent = secondes < CONFIG.countdownUrgentBelowSeconds;

  return (
    <View
      testID={testID}
      accessibilityLabel={String(secondes)}
      style={{
        alignSelf: 'center',
        paddingHorizontal: 14,
        paddingVertical: 4,
        backgroundColor: urgent ? fg : bg,
      }}
    >
      <Texte
        variante="type.countdown"
        style={{
          fontSize: CONFIG.countdownFontSize,
          lineHeight: CONFIG.countdownFontSize + 6,
          color: urgent ? bg : fg,
        }}
      >
        {secondes}
      </Texte>
    </View>
  );
}

/** Six caractères groupés trois par trois : « 4H2 9KX ». Il se dicte. */
export function ManualCode({
  code,
  label,
  testID,
}: {
  code: string;
  label: string;
  testID?: string;
}) {
  const taille = CONFIG.manualGroupSize;
  const groupes = code.match(new RegExp(`.{1,${taille}}`, 'g')) ?? [code];

  return (
    <View testID={testID} style={{ alignItems: 'center', gap: 4 }}>
      <Texte variante="type.caption" style={{ color: fg, opacity: 1 }}>
        {label}
      </Texte>
      <Texte
        variante="type.mono"
        accessibilityLabel={code.split('').join(' ')}
        style={{ fontSize: 22, letterSpacing: 3, color: fg }}
      >
        {groupes.join(' ')}
      </Texte>
    </View>
  );
}

/**
 * Le QR, toujours affiché, régénéré à chaque rotation.
 *
 * Il porte l'identifiant du code et les chiffres du moment. Le masquer derrière
 * un geste ferait chercher au comptoir ce qui doit être tendu.
 */
export function QrBlock({
  contenu,
  testID,
}: {
  contenu: string;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        alignSelf: 'center',
        padding: 8,
        borderWidth: 2,
        borderColor: fg,
        backgroundColor: bg,
      }}
    >
      <QRCode value={contenu} size={170} color={fg} backgroundColor={bg} />
    </View>
  );
}

/** Le fond de l'écran. Aucun thème, aucun rayon, aucune ombre. */
export function PickupCodeSurface({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: bg, justifyContent: 'center', gap: 28, padding: 24 }}>
      {children}
    </View>
  );
}
