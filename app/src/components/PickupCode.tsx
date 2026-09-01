/**
 * Les blocs de l'écran de code de retrait. **Hors thème.**
 *
 * Toujours `code.fg` sur `code.bg` — 21:1 — quel que soit le rôle et quel que
 * soit le réglage du téléphone. Un code doit se lire à 1,20 m dans un salon
 * très éclairé ou en plein soleil ; le laisser suivre le thème le rendrait
 * illisible une fois sur deux. Les deux couleurs viennent de `codeColors`,
 * le seul endroit du code autorisé à porter un littéral.
 *
 * **Le code tourne de lui-même, à la cadence que le serveur fixe.** Ce
 * paragraphe disait « toutes les 30 secondes » : c'était vrai de la
 * configuration du jour, et faux le lendemain d'un réglage. Il n'existe donc ni
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
import { Animated, Easing, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { codeColors, motion, produit, radius } from '../theme';
import { useMouvementReduit } from './Mouvement';
import { Texte } from './Texte';

const { fg, bg } = codeColors;
const CONFIG = produit.code;

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
  const reduit = useMouvementReduit();
  const entree = useRef(new Animated.Value(1)).current;

  // À chaque rotation, les chiffres entrent : une seconde de plus sans rien
  // changer à l'écran laisse croire que le code est figé, et quelqu'un finit
  // par toucher l'écran pour vérifier.
  useEffect(() => {
    if (reduit) return;
    entree.setValue(0);
    const animation = Animated.timing(entree, {
      toValue: 1,
      duration: motion.slow,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [code, entree, reduit]);

  return (
    <Animated.View
      style={{
        opacity: entree,
        transform: [
          { scale: entree.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
        ],
      }}
    >
    <View
      testID={testID}
      accessibilityLabel={code.split('').join(' ')}
      style={{ flexDirection: 'row', justifyContent: 'center' }}
    >
      {/* La taille vient de la variante, comme partout ailleurs. Elle était
          réécrite ici à partir d'un second jeton, `codeFontSize`, qui répétait
          la même valeur : deux endroits à changer pour un seul chiffre. */}
      <Texte variante="type.code" style={{ color: fg }}>
        {code}
      </Texte>
    </View>
    </Animated.View>
  );
}

/**
 * Les secondes avant la rotation suivante, en chiffres, sous un libellé qui dit
 * ce qui arrive à zéro.
 *
 * Jamais en anneau de progression : un anneau ne se lit pas de loin, et c'est
 * de loin que cet écran est regardé.
 *
 * **Aucun état d'urgence, et c'est une correction.** Le bloc s'inversait sous
 * un tiers de la rotation. Or à zéro **il ne se passe rien** : l'écran recharge
 * seul, le QR devient un autre QR, et le scan marche à l'identique. On avait
 * donc mis une alarme sur la seule chose de cet écran qui ne demande aucune
 * action — un créateur au comptoir voyait un nombre nu virer au négatif et
 * descendre vers zéro, ce qui se lit comme « dépêche-toi » ou « ça va casser ».
 *
 * Le décompte garde une raison d'être, et une seule : **prouver au commerçant
 * que l'écran est vivant**, et non une capture prise la semaine dernière. La
 * rotation existe précisément pour qu'une capture ne vaille rien trente
 * secondes plus tard. C'est un signal de fraîcheur, pas un délai à tenir.
 *
 * **Le libellé n'est pas un ornement.** Le nombre était nu, et il chapeautait
 * deux codes aux durées de vie opposées : le QR qui tourne, et le code de
 * secours juste dessous qui ne bouge jamais. Rien ne disait auquel il
 * s'appliquait, et un commerçant à qui l'on dicte le second pendant que le
 * nombre descend a toutes les raisons de croire qu'il faut se presser.
 *
 * **Chaque seconde bat.** Un léger retrait puis retour d'échelle : de loin, on
 * voit que le compte tourne sans avoir à lire le chiffre. C'est une
 * transformation, la seule chose que React Native anime sans repasser par le
 * pont ; une couleur qui pulserait saccaderait.
 */
export function Countdown({
  secondes,
  libelle,
  annonce,
  testID,
}: {
  secondes: number;
  /** « Nouveau code dans », traduit par l'écran. Le nombre le suit. */
  libelle: string;
  /**
   * La phrase entière, secondes comprises, pour qui n'a que la voix.
   *
   * `accessibilityLabel` portait `String(secondes)` : un lecteur d'écran
   * annonçait « 20 », « 19 », « 18 », chaque seconde, sans jamais dire de quoi.
   * Le libellé visible ne suffit pas à le réparer — il est rendu à côté, dans
   * un autre nœud, et rien ne lie les deux à l'oreille.
   */
  annonce: string;
  testID?: string;
}) {
  const reduit = useMouvementReduit();
  const battement = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduit) return;
    const animation = Animated.sequence([
      Animated.timing(battement, {
        toValue: 0.92,
        duration: motion.fast,
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
      accessibilityLabel={annonce}
      style={{
        alignSelf: 'center',
        paddingHorizontal: 14,
        paddingVertical: 4,
        backgroundColor: bg,
      }}
    >
      {/* Le libellé est rendu ici et non par l'écran : séparés, ils finiraient
          par se retrouver de part et d'autre du QR au premier remaniement, et
          le nombre redeviendrait nu. */}
      <Texte variante="type.caption" align="center" style={{ color: fg, opacity: 0.7 }}>
        {libelle}
      </Texte>
      <Texte variante="type.countdown" align="center" style={{ color: fg }}>
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
        variante="type.data"
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
export function PickupCodeSurface({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={{ flex: 1, backgroundColor: bg, justifyContent: 'center', gap: 28, padding: 24 }}
    >
      <Halo />
      {children}
    </View>
  );
}

/**
 * Le souffle derrière le code.
 *
 * L'écran était un formulaire noir : des chiffres, un carré, deux lignes. C'est
 * pourtant le seul moment du produit où quelqu'un tend son téléphone à
 * quelqu'un d'autre, et il doit se reconnaître d'un coup d'œil au comptoir.
 *
 * Un disque très sombre qui respire lentement — huit secondes, deux pour cent
 * d'amplitude. Assez pour que l'écran soit vivant, pas assez pour attirer
 * l'œil : ce qu'on doit lire, ce sont les chiffres.
 *
 * **En blanc à très faible opacité, pas en couleur.** L'écran du code ignore le
 * thème et tient son contraste de 21:1 ; y poser une teinte le romprait.
 */
/**
 * Une demi-respiration du halo. Longue exprès : sur un écran qu'on tend à
 * quelqu'un, un battement rapide se lit comme une alerte.
 */
const HALO_DEMI_SOUFFLE = 4000;

function Halo() {
  const reduit = useMouvementReduit();
  const souffle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduit) return;
    const boucle = Animated.loop(
      Animated.sequence([
        Animated.timing(souffle, {
          toValue: 1,
          duration: HALO_DEMI_SOUFFLE,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(souffle, {
          toValue: 0,
          duration: HALO_DEMI_SOUFFLE,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    boucle.start();
    return () => boucle.stop();
  }, [reduit, souffle]);

  return (
    <Animated.View
      pointerEvents="none"
      testID="halo-du-code"
      style={{
        position: 'absolute',
        alignSelf: 'center',
        top: '18%',
        width: 320,
        height: 320,
        borderRadius: radius['radius.pill'],
        backgroundColor: fg,
        opacity: souffle.interpolate({ inputRange: [0, 1], outputRange: [0.03, 0.07] }),
        transform: [
          { scale: souffle.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.02] }) },
        ],
      }}
    />
  );
}
