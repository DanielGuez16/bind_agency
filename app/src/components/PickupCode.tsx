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
import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { codeColors, tokens } from '../theme';
import { useMouvementReduit } from './Mouvement';
import { Texte } from './Texte';

const { fg, bg } = codeColors;
const CONFIG = tokens.code;

/**
 * La taille du code de secours, et la hauteur de ligne qui va avec.
 *
 * La passation donne `codeFontSize` et `countdownFontSize`, pas celle-ci : le
 * code de secours n'a pas de jeton, il est dimensionné ici. La hauteur de ligne
 * se dérive de la taille plutôt que d'être écrite à côté — les deux ne peuvent
 * pas diverger.
 */
const SECOURS_TAILLE = 22;

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
 *
 * **Chaque seconde bat.** Un léger retrait puis retour d'échelle : de loin, on
 * voit que le compte tourne sans avoir à lire le chiffre. C'est une
 * transformation, la seule chose que React Native anime sans repasser par le
 * pont ; une couleur qui pulserait saccaderait.
 */
export function Countdown({
  secondes,
  testID,
}: {
  secondes: number;
  testID?: string;
}) {
  const urgent = secondes < CONFIG.countdownUrgentBelowSeconds;
  const reduit = useMouvementReduit();
  const battement = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduit) return;
    const animation = Animated.sequence([
      Animated.timing(battement, {
        toValue: 0.92,
        duration: tokens.motion.durationFast,
        useNativeDriver: true,
      }),
      Animated.spring(battement, {
        toValue: 1,
        speed: 20,
        bounciness: 8,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [battement, reduit, secondes]);

  return (
    <Animated.View style={{ transform: [{ scale: battement }], alignSelf: 'center' }}>
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
    </Animated.View>
  );
}

/**
 * Six caractères groupés trois par trois : « 4H2 9KX ». Il se dicte.
 *
 * **Sa hauteur de ligne est déclarée avec sa taille.** Grossir la police sans
 * elle laisse la hauteur de l'échelle mono, plus courte que les glyphes : ils
 * débordaient vers le haut et chevauchaient le libellé « or read this out »,
 * rendant illisible précisément le code qu'on dicte au comptoir.
 */
export function ManualCode({
  code,
  label,
  testID,
}: {
  code: string;
  label: string;
  testID?: string;
}) {
  // Le serveur groupe déjà : « PAPEDB » arrive en « PAP EDB ». Regrouper sans
  // défaire donnait « PAP  ED B » — trois groupes faux, sur le code qu'on dicte
  // au comptoir. On repart des caractères seuls, ce qui rend le groupement
  // idempotent quel que soit le format reçu.
  const taille = CONFIG.manualGroupSize;
  const nu = code.replace(/[^A-Za-z0-9]/g, '');
  const groupes = nu.match(new RegExp(`.{1,${taille}}`, 'g')) ?? [nu];

  return (
    <View testID={testID} style={{ alignItems: 'center', gap: 4 }}>
      <Texte variante="type.caption" style={{ color: fg, opacity: 1 }}>
        {label}
      </Texte>
      <Texte
        variante="type.mono"
        accessibilityLabel={nu.split('').join(' ')}
        style={{
          fontSize: SECOURS_TAILLE,
          lineHeight: SECOURS_TAILLE + 8,
          letterSpacing: 3,
          color: fg,
        }}
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
