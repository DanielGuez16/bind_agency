/**
 * Badge de palier.
 *
 * **Trois marqueurs redondants, obligatoires ensemble** : le mot, un glyphe de
 * une à trois barres, et une matière propre au palier. Aucune information n'est
 * portée par la couleur seule — un daltonien, un écran mal calibré ou une
 * capture en noir et blanc doivent tous laisser lire le palier.
 *
 * **Depuis la v1.0, la matière est la seule chose qui distingue les trois.**
 * Une seule teinte de marque a supprimé le rose, le vert et le violet ; ce qui
 * les remplace n'est pas une autre palette mais la **manière dont la teinte est
 * posée** : contour, teinte, aplat. Deux gains, au-delà du fait de survivre au
 * monochrome.
 *
 * D'abord **la progression devient ordinale**. Un rose, un vert et un violet ne
 * disaient pas lequel était le plus exigeant ; il fallait l'apprendre. De moins
 * de matière à plus de matière s'ordonne sans apprentissage.
 *
 * Ensuite **la règle des trois marqueurs devient vérifiable par
 * construction**. Avec trois teintes, « distinct en niveaux de gris » était
 * vrai en théorie et n'avait jamais été testé. Un contour, une teinte et un
 * aplat le restent quoi qu'on fasse de la couleur.
 *
 * **Le mot n'est jamais abrégé.** `HISTORIA` et `PUBLICACIÓN` passent sur deux
 * lignes dans les listes denses plutôt qu'en initiale. Une initiale ne se
 * devine pas, et « P » vaudrait pour `POST` comme pour `PUBLICACIÓN`.
 *
 * **Aucun chiffre de niveau.** Il invite à la comparaison entre créatrices, ce
 * que le produit ne fait nulle part.
 */
import { View } from 'react-native';

import { matiereDePalier, radius, tierTokens, useColors, type Palier } from '../theme';
import { useI18n } from '../i18n';
import { Texte } from './Texte';

export type { Palier };

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
  const m = matiereDePalier(tier);
  const mot = config.label[locale] ?? config.label.en;

  // Sur une photo, le contour et la teinte perdent leur fond : ce qui est
  // derrière est quelconque. Le voile de badge le leur rend. L'aplat, lui, est
  // déjà opaque — et c'est l'unique élément coloré que la couverture a le droit
  // de porter, la pastille de distance passant alors sur le même voile.
  const surface = onPhoto && m.matiere !== 'solid' ? c['scrim.badge'] : c[m.surface];
  const bordure = m.bordure === 'transparent' ? 'transparent' : c[m.bordure];

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
        borderWidth: m.epaisseur,
        borderColor: bordure,
        backgroundColor: surface,
      }}
    >
      <Glyphe tier={tier} />
      <Texte
        variante="type.mono"
        couleur={m.texte}
        style={{ fontSize: size === 'sm' ? 10 : 11, letterSpacing: 0.66 }}
      >
        {mot}
      </Texte>
    </View>
  );
}

/** Une à trois barres. Les inactives restent dessinées, souvent transparentes. */
function Glyphe({ tier }: { tier: Palier }) {
  const c = useColors();
  const m = matiereDePalier(tier);
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
            backgroundColor: i < m.barresPleines ? c[m.glyphePlein] : c[m.glypheVide],
            // Sur l'aplat, la barre vide est la même encre que la pleine et
            // disparaîtrait. Elle reste dessinée, en retrait : trois barres
            // dont une seule s'efface ne compteraient plus jusqu'à trois.
            opacity: i < m.barresPleines ? 1 : m.matiere === 'solid' ? 0.3 : 1,
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
    <Texte variante="type.caption" couleur="ink.soft">
      {config.counterpart[locale] ?? config.counterpart.en}
    </Texte>
  );
}
