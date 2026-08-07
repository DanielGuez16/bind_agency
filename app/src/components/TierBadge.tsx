/**
 * Badge de palier.
 *
 * **Trois marqueurs redondants, obligatoires ensemble** : le mot, un glyphe de
 * une à trois barres, et une matière propre au palier. Aucune information n'est
 * portée par la couleur seule — un daltonien, un écran mal calibré ou une
 * capture en noir et blanc doivent tous laisser lire le palier.
 *
 * **Le mot n'est jamais abrégé.** `HISTORIA` et `PUBLICACIÓN` passent sur deux
 * lignes dans les listes denses plutôt qu'en initiale. Une initiale ne se
 * devine pas, et « P » vaudrait pour `POST` comme pour `PUBLICACIÓN`.
 *
 * **Aucun chiffre de niveau.** Il invite à la comparaison entre créatrices, ce
 * que le produit ne fait nulle part.
 */
import { View } from 'react-native';

import { radius, tierTokens, useColors } from '../theme';
import { useI18n } from '../i18n';
import { Texte } from './Texte';

export type Palier = 'story' | 'post' | 'reel';

export type TierBadgeProps = {
  tier: Palier;
  size?: 'sm' | 'md';
  /** Posé sur une photo : un fond opaque garantit le contraste. */
  onPhoto?: boolean;
  testID?: string;
};

const HAUTEURS_DE_BARRE = [6, 9, 12];

export function TierBadge({ tier, size = 'md', onPhoto, testID }: TierBadgeProps) {
  const c = useColors();
  const { locale } = useI18n();
  const config = tierTokens[tier];
  const mot = config.label[locale] ?? config.label.en;

  // La matière : contour pour story, fond léger pour post, fond plein pour
  // reel. C'est le troisième marqueur, celui qui se lit sans lire.
  const plein = config.material === 'solidInverse';
  const fond = plein
    ? c[`tier.${tier}`]
    : config.material === 'solidAccent'
      ? c[`tier.${tier}.subtle`]
      : 'transparent';
  const surTeinte = plein ? (`tier.${tier}.onTier` as const) : (`tier.${tier}` as const);

  return (
    <View
      testID={testID}
      accessibilityLabel={mot}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: size === 'sm' ? 3 : 4,
        paddingHorizontal: size === 'sm' ? 6 : 8,
        borderRadius: radius['radius.sm'],
        borderWidth: plein ? 0 : 1,
        borderColor: c[`tier.${tier}`],
        backgroundColor: onPhoto && !plein ? c['badge.scrim'] : fond,
      }}
    >
      <Glyphe tier={tier} barres={config.glyphBars} plein={plein} />
      <Texte
        variante="type.mono"
        couleur={surTeinte}
        style={{ fontSize: size === 'sm' ? 10 : 11, letterSpacing: 0.66 }}
      >
        {mot}
      </Texte>
    </View>
  );
}

/** Une à trois barres. Les inactives restent dessinées, souvent transparentes. */
function Glyphe({ tier, barres, plein }: { tier: Palier; barres: number; plein: boolean }) {
  const c = useColors();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 }}
    >
      {HAUTEURS_DE_BARRE.map((hauteur, i) => (
        <View
          key={hauteur}
          // Nommée : la règle des trois marqueurs se vérifie sur le glyphe
          // lui-même, sans plonger dans l'arbre par type de composant — ce qui
          // casserait au premier `View` ajouté autour.
          testID={`glyphe-barre-${i}`}
          style={{
            width: 3,
            height: hauteur,
            backgroundColor:
              i < barres
                ? plein
                  ? c[`tier.${tier}.onTier`]
                  : c[`tier.${tier}.glyphFilled`]
                : c[`tier.${tier}.glyphEmpty`],
          }}
        />
      ))}
    </View>
  );
}

/**
 * La phrase de contrepartie, en clair.
 *
 * C'est elle qui informe, pas le badge. Le badge situe, la phrase dit ce qu'on
 * s'engage à faire et sous quel délai — et elle accompagne toujours le badge
 * sur une carte.
 */
export function LigneDeContrepartie({ tier }: { tier: Palier }) {
  const { locale } = useI18n();
  const config = tierTokens[tier];
  return (
    <Texte variante="type.caption" couleur="text.secondary">
      {config.counterpart[locale] ?? config.counterpart.en}
    </Texte>
  );
}
