/**
 * Thème et jetons — direction **BIND AGENCY v1.0**.
 *
 * **`tokens.json` est la source.** Il est copié tel quel du dossier de
 * passation, sans retouche : le retranscrire en TypeScript aurait créé une
 * seconde vérité, et c'est la seconde qu'on oublie de mettre à jour quand le
 * design bouge. Un test compare les deux fichiers.
 *
 * **`produit.json` porte ce que la passation conserve sans le réénumérer** —
 * densités du gabarit v0.6, écran de code hors système, repères en mono,
 * libellés de palier. Un test refuse qu'une clé existe des deux côtés.
 *
 * **Aucune couleur écrite en dur nulle part.** Un test parcourt les sources et
 * refuse tout littéral hexadécimal hors de ce dossier.
 *
 * ---
 *
 * ## Ce que la v1.0 change ici, et pourquoi
 *
 * **Une seule teinte, deux emplois qui ne se confondent jamais.** `brand.500`
 * est une **surface** et ne s'écrit jamais — 3,0:1 sur blanc, refusé à toute
 * taille. `brand.700` est une **encre** et ne se pose jamais en fond plein.
 * C'est la règle centrale du système, et c'est la seule que le code peut
 * réellement tenir : une garde vérifie qu'aucune source ne passe `brand.500`
 * en couleur de texte.
 *
 * **Il n'y a plus qu'un seul jeu de couleurs, et c'est délibéré.** La v0.4
 * livrait deux palettes complètes ; la v1.0 en livre une, met les trois rôles
 * en clair, et déclare **hors système** les deux seuls écrans qui restent
 * sombres — le code de retrait et la galerie plein écran, qui portent leurs
 * couleurs eux-mêmes. Ce qu'elle donne pour le sombre — `ink.onDark`,
 * `line.onDark`, `bg.sunken`, `scrim.badgeOnDark`, les variantes `onDark` des
 * paliers — est un **kit d'accommodation** pour ces surfaces-là, pas une
 * seconde palette : il n'y a ni gris intermédiaires, ni statuts, ni états de
 * bordure. Reconstituer un thème sombre demandait d'inventer une dizaine de
 * valeurs qu'aucune passation ne définit, c'est-à-dire exactement la seconde
 * vérité que ce fichier existe pour empêcher.
 *
 * Le fichier de jetons portait un réglage de bascule ; il a été retiré avec le
 * second thème, et la clé qui reste à sa place dit pourquoi. Un interrupteur
 * qui ne commande rien est pire que son absence : il fait douter de ceux qui
 * commandent quelque chose. Le jour où un jeu sombre est livré, il se rebranche
 * ici et nulle part ailleurs.
 *
 * **Le rôle reste lisible, en matière et non en teinte.** `role.creator` et
 * `role.merchant` sont supprimés du système. L'alternative du §8 de la
 * passation est retenue : encre pour l'administration, os pour le commerce,
 * papier pour le créateur. Une capture d'écran dit donc encore d'où elle
 * vient, sans qu'une teinte ait à porter un sens que personne ne décode.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import produitBrut from './produit.json';
import brut from './tokens.json';

export type Role = 'creator' | 'merchant' | 'admin';

export const tokens = brut;
export const produit = produitBrut;

export { nomDeFonte, policesAcharger, type Graisse, type Voix } from './polices';
export {
  familles,
  typography,
  PLANCHER_DIDONE,
  type EchelleTypo,
  type RoleDeFonte,
  type Variante,
} from './echelle';

// --------------------------------------------------------------------------
// couleurs
// --------------------------------------------------------------------------

/**
 * Les jetons de couleur, à plat.
 *
 * Les noms sont **ceux de la passation**, pas une traduction : `components.md`
 * se lit directement sur le code, et une règle écrite là-bas se cherche ici
 * sous le même mot. Les quelques entrées que la v1.0 ne nomme pas sont
 * dérivées d'une de ses valeurs, jamais inventées, et chacune porte sa raison.
 */
const COULEURS = {
  'brand.50': brut.color.brand['50'],
  'brand.100': brut.color.brand['100'],
  'brand.200': brut.color.brand['200'],
  'brand.400': brut.color.brand['400'],
  'brand.500': brut.color.brand['500'],
  'brand.600': brut.color.brand['600'],
  'brand.700': brut.color.brand['700'],
  'brand.900': brut.color.brand['900'],

  'ink.default': brut.color.ink.default,
  'ink.soft': brut.color.ink.soft,
  'ink.mute': brut.color.ink.mute,
  'ink.faint': brut.color.ink.faint,
  'ink.onBrand': brut.color.ink.onBrand,
  'ink.onDark': brut.color.ink.onDark,

  'bg.page': brut.color.bg.page,
  'bg.surface': brut.color.bg.surface,
  'bg.deep': brut.color.bg.deep,
  'bg.inverse': brut.color.bg.inverse,
  'bg.sunken': brut.color.bg.sunken,

  'line.default': brut.color.line.default,
  'line.strong': brut.color.line.strong,
  'line.ink': brut.color.line.ink,
  'line.onDark': brut.color.line.onDark,

  'status.success.text': brut.color.status.success.text,
  'status.success.surface': brut.color.status.success.surface,
  'status.success.rule': brut.color.status.success.rule,
  'status.warning.text': brut.color.status.warning.text,
  'status.warning.surface': brut.color.status.warning.surface,
  'status.warning.rule': brut.color.status.warning.rule,
  'status.danger.text': brut.color.status.danger.text,
  'status.danger.surface': brut.color.status.danger.surface,
  'status.danger.rule': brut.color.status.danger.rule,

  'scrim.photoTop': brut.color.scrim.photoTop,
  'scrim.photoBottom': brut.color.scrim.photoBottom,
  'scrim.modal': brut.color.scrim.modal,
  'scrim.badge': brut.color.scrim.badge,
  'scrim.badgeOnDark': brut.color.scrim.badgeOnDark,

  // Un texte posé sur un voile de photo. `ink.onDark` est l'encre claire du
  // système, et `line.strong` sa nuance sourde : les deux tiennent largement
  // sur un voile à 0,88 d'opacité, et aucune n'est une valeur de plus.
  'ink.onScrim': brut.color.ink.onDark,
  'ink.onScrimMuted': brut.color.line.strong,

  // Le gabarit d'une image absente, et la pulsation d'un squelette. Ce sont
  // des surfaces creuses : `bg.deep` est exactement le cran de fond que la
  // v1.0 pose sous une surface, et le filet le raye.
  'media.placeholder': brut.color.bg.deep,
  'media.placeholderStripe': brut.color.line.default,
  'media.placeholderText': brut.color.ink.mute,
  'skeleton.base': brut.color.bg.deep,
} as const;

export type ColorTokens = typeof COULEURS;
export type ColorName = keyof ColorTokens;

/**
 * Les couleurs, sans passer par le fournisseur.
 *
 * Utile aux fonctions pures et aux tests. Les composants passent par
 * `useColors`, qui rend exactement le même objet.
 */
export const couleurs: ColorTokens = COULEURS;

/**
 * Les deux seules couleurs qui ne viennent d'aucun jeton de marque.
 *
 * L'écran de code de retrait est déclaré hors système par la passation : il
 * est lu par une caméra et par une vendeuse à un mètre, et le laisser suivre
 * quoi que ce soit le rendrait illisible une fois sur deux.
 */
export const codeColors = { fg: produitBrut.code.fg, bg: produitBrut.code.bg } as const;

// --------------------------------------------------------------------------
// mesures
// --------------------------------------------------------------------------

/**
 * Les rayons, réduits à trois.
 *
 * Les 6, 8, 12 et 16 de la v0.4 tombent à zéro : la mode ne s'arrondit pas, et
 * le bloc plein ne fonctionne que d'équerre. Restent 2 px sur les vignettes
 * photo — sans quoi un angle de photo paraît coupé — et la pilule sur les
 * seules chips de filtre.
 */
export const radius = {
  'radius.none': brut.radius.none,
  'radius.photo': brut.radius.photo,
  'radius.pill': brut.radius.pill,
} as const;

/** L'échelle d'espacement, préfixée comme l'échelle typographique. */
export const spacing = Object.fromEntries(
  Object.entries(brut.space).map(([cran, valeur]) => [`space.${cran}`, valeur]),
) as Record<`space.${keyof typeof brut.space & string}`, number>;

export const size = brut.size;
export const breakpoint = brut.breakpoint;
export const density = produitBrut.density;

/** Les durées et la pulsation du squelette, qui n'appartient pas à la marque. */
export const motion = {
  fast: brut.motion.fast,
  default: brut.motion.default,
  slow: brut.motion.slow,
  animatable: brut.motion.animatable,
  skeletonLoop: produitBrut.motion.skeletonLoop,
  easing: produitBrut.motion.easing,
} as const;

/**
 * La règle de comptage du bloc plein, lisible par la garde qui l'applique.
 *
 * La passation dit que la règle « se vérifie à l'œil nu ». C'est précisément
 * ce qui ne tient pas : un bloc de plus arrive par un titre ajouté six
 * semaines plus tard, dans un écran que personne ne rouvre.
 */
export const blockRule = brut.blockRule;

/** Le motif du filet segmenté, repris des carrousels de la fondatrice. */
export const segmentedRule = brut.pattern.segmentedRule;

// --------------------------------------------------------------------------
// paliers
// --------------------------------------------------------------------------

export type Palier = 'story' | 'post' | 'reel';

/**
 * Les données de produit d'un palier : ordre, mot, barres, contrepartie.
 *
 * Séparées de la **matière**, qui est un jeton de design. Les deux se
 * rejoignent dans `TierBadge` sans jamais se recopier.
 */
export const tierTokens = produitBrut.tier;

/**
 * La matière d'un palier — contour, teinte, aplat.
 *
 * C'est elle qui distingue les paliers depuis la v1.0, et non plus la teinte :
 * une progression ordinale, de moins de matière à plus de matière, qui reste
 * lisible en niveaux de gris. Un rose, un vert et un violet ne disaient pas
 * lequel était le plus exigeant ; il fallait l'apprendre.
 */
export const tierMatiere = brut.color.tier;

export type MatiereDePalier = {
  /** Contour, teinte, aplat. De moins de matière à plus de matière. */
  matiere: 'outline' | 'tint' | 'solid';
  /** Toujours une surface nommée : aucun des trois n'est transparent. */
  surface: ColorName;
  /** L'aplat n'a pas de filet, et c'est ce qui le rend plein. */
  bordure: ColorName | 'transparent';
  epaisseur: number;
  texte: ColorName;
  glyphePlein: ColorName;
  glypheVide: ColorName;
  /** Combien des trois barres sont pleines. Le deuxième marqueur redondant. */
  barresPleines: number;
};

/**
 * La matière d'un palier, exprimée en **noms de jetons** et non en valeurs.
 *
 * `tokens.color.tier` donne des hexadécimaux — c'est la forme dans laquelle un
 * designer livre une matière. Les composants, eux, ne manipulent que des noms :
 * c'est ce qui fait tenir la garde des couleurs en dur et ce qui rend une
 * couleur relisible dans un écran. La table ci-dessous est donc une **lecture**
 * de ces hexadécimaux dans le vocabulaire du système, et un test vérifie que
 * les deux disent la même chose — sans quoi ce serait une seconde vérité,
 * exactement celle qu'on cherche à ne pas créer.
 */
const MATIERE_DE_PALIER: Record<Palier, MatiereDePalier> = {
  // Contour : le moins de matière. Fond papier, filet d'orange sombre.
  story: {
    matiere: 'outline',
    surface: 'bg.surface',
    bordure: 'brand.700',
    epaisseur: brut.color.tier.story.borderWidth,
    texte: 'brand.700',
    glyphePlein: 'brand.700',
    glypheVide: 'brand.200',
    barresPleines: brut.color.tier.story.glyphFilled,
  },
  // Teinte : la matière du milieu. Fond orange pâle, filet de marque.
  post: {
    matiere: 'tint',
    surface: 'brand.100',
    bordure: 'brand.500',
    epaisseur: brut.color.tier.post.borderWidth,
    texte: 'brand.700',
    glyphePlein: 'brand.700',
    glypheVide: 'brand.200',
    barresPleines: brut.color.tier.post.glyphFilled,
  },
  // Aplat : toute la matière. C'est le seul des trois qui porte le bloc plein,
  // et la seule surface `brand.500` que la règle de comptage laisse se répéter.
  reel: {
    matiere: 'solid',
    surface: 'brand.500',
    bordure: 'transparent',
    epaisseur: brut.color.tier.reel.borderWidth,
    texte: 'ink.onBrand',
    glyphePlein: 'ink.onBrand',
    glypheVide: 'ink.onBrand',
    barresPleines: brut.color.tier.reel.glyphFilled,
  },
};

/**
 * Les mêmes trois matières, posées sur l'encre.
 *
 * « Sur fond sombre, contour et teinte s'éclaircissent, l'aplat ne bouge pas.
 * L'ordre est conservé. » C'est la seule chose que la v1.0 dise du sombre pour
 * les paliers, et c'est suffisant : la progression ordinale est ce qu'il faut
 * préserver, pas les valeurs.
 */
const MATIERE_SUR_ENCRE: Record<Palier, MatiereDePalier> = {
  story: {
    matiere: 'outline',
    // Le contour n'a pas de fond : sur l'encre, c'est l'encre qu'on voit.
    surface: 'bg.inverse',
    bordure: 'brand.400',
    epaisseur: brut.color.tier.story.borderWidth,
    texte: 'brand.400',
    glyphePlein: 'brand.400',
    glypheVide: 'brand.900',
    barresPleines: brut.color.tier.story.glyphFilled,
  },
  post: {
    matiere: 'tint',
    surface: 'brand.900',
    bordure: 'brand.500',
    epaisseur: brut.color.tier.post.borderWidth,
    texte: 'brand.200',
    glyphePlein: 'brand.200',
    glypheVide: 'brand.700',
    barresPleines: brut.color.tier.post.glyphFilled,
  },
  // L'aplat ne bouge pas. C'est ce qui garde l'ordre lisible d'un fond à
  // l'autre : le palier le plus exigeant est le seul dont la matière est la
  // même partout.
  reel: {
    matiere: 'solid',
    surface: 'brand.500',
    bordure: 'transparent',
    epaisseur: brut.color.tier.reel.borderWidth,
    texte: 'ink.onBrand',
    glyphePlein: 'ink.onBrand',
    glypheVide: 'ink.onBrand',
    barresPleines: brut.color.tier.reel.glyphFilled,
  },
};

export function matiereDePalier(palier: Palier, surEncre = false): MatiereDePalier {
  return (surEncre ? MATIERE_SUR_ENCRE : MATIERE_DE_PALIER)[palier];
}

// --------------------------------------------------------------------------
// matière du rôle
// --------------------------------------------------------------------------

/**
 * La matière de la coquille, par rôle.
 *
 * §8 de la passation, alternative retenue : la couleur de rôle disparaît, la
 * distinction reste — **en matière et non en teinte**. Encre pour
 * l'administration, os pour le commerce, papier pour le créateur. Trois fonds
 * qui existent déjà dans le système, et aucune teinte de plus à décoder.
 */
export type MatiereDeRole = {
  /** Le fond de la barre latérale et de la coquille. */
  surface: ColorName;
  /** L'encre qui tient dessus. */
  texte: ColorName;
  /** Le sourd qui tient dessus — nom du commerce ou de la créatrice. */
  texteSourd: ColorName;
  /** Le filet qui sépare la coquille du contenu. */
  ligne: ColorName;
};

const MATIERE_DE_ROLE: Record<Role, MatiereDeRole> = {
  // Papier : le créateur parcourt un catalogue, et le blanc laisse les photos
  // porter la couleur.
  creator: {
    surface: 'bg.surface',
    texte: 'ink.default',
    texteSourd: 'ink.mute',
    ligne: 'line.default',
  },
  // Os : le commerce travaille en pleine journée sur un téléphone posé au
  // comptoir. Le fond chaud le distingue du contenu sans rien colorer.
  merchant: {
    surface: 'bg.page',
    texte: 'ink.default',
    texteSourd: 'ink.mute',
    ligne: 'line.strong',
  },
  // Encre : l'administration. C'est le rôle qu'on doit reconnaître d'un
  // regard sur une capture d'écran, parce que c'est celui dont une action a
  // des conséquences chez quelqu'un d'autre.
  admin: {
    surface: 'bg.inverse',
    texte: 'ink.onDark',
    texteSourd: 'line.strong',
    ligne: 'line.onDark',
  },
};

export function matiereDeRole(role: Role): MatiereDeRole {
  return MATIERE_DE_ROLE[role];
}

// --------------------------------------------------------------------------
// fournisseur
// --------------------------------------------------------------------------

type ThemeValue = {
  role: Role;
  color: ColorTokens;
  /** La matière de la coquille pour ce rôle. */
  matiere: MatiereDeRole;
  /**
   * Densité du rôle : le commerce est plus dense, il lit des listes longues.
   *
   * `gap` est normalisé — la passation le nomme `cardGap` côté créateur et
   * `rowGap` côté commerce, ce qui décrit la même chose et obligerait chaque
   * appelant à savoir de quel rôle il dépend.
   */
  density: {
    screenPadding: number;
    gap: number;
    rowHeight: number;
    /**
     * Les mêmes, sur un écran large. Le commerce était **plus serré** que le
     * créateur à 1512 — 16 contre 20 — parce que sa densité est calibrée pour
     * un téléphone posé au comptoir. Sur un bureau, cette raison disparaît.
     */
    screenPaddingLarge: number;
    gapLarge: number;
  };
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({
  role = 'creator',
  children,
}: {
  role?: Role;
  children: ReactNode;
}) {
  const value = useMemo<ThemeValue>(
    () => ({
      role,
      color: COULEURS,
      matiere: matiereDeRole(role),
      density:
        role === 'merchant'
          ? {
              screenPadding: produitBrut.density.merchant.screenPadding,
              gap: produitBrut.density.merchant.rowGap,
              rowHeight: produitBrut.density.merchant.rowHeight,
              screenPaddingLarge: produitBrut.density.merchant.screenPaddingLarge,
              gapLarge: produitBrut.density.merchant.gapLarge,
            }
          : {
              screenPadding: produitBrut.density.creator.screenPadding,
              gap: produitBrut.density.creator.cardGap,
              rowHeight: produitBrut.density.creator.rowHeight,
              screenPaddingLarge: produitBrut.density.creator.screenPaddingLarge,
              gapLarge: produitBrut.density.creator.gapLarge,
            },
    }),
    [role],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    // Lever plutôt que retomber sur des valeurs par défaut : un composant rendu
    // hors du fournisseur perdrait la densité de son rôle sans que personne ne
    // s'en aperçoive avant une capture d'écran.
    throw new Error('useTheme hors de ThemeProvider');
  }
  return value;
}

/** Raccourci : `const c = useColors(); c['bg.page']`. */
export function useColors(): ColorTokens {
  return COULEURS;
}

/**
 * L'unique ombre du système, pour ce qui flotte réellement.
 *
 * **`elevation.1` est supprimé.** Une carte se tient à son filet de 1 px ; une
 * ombre sous chaque carte d'un fil produisait une nappe grise, et c'est
 * précisément ce que la v1.0 refuse — le filet remplace l'ombre. Ce qui reste
 * est réservé à ce qui flotte au-dessus du contenu : feuille, menu, dialogue.
 *
 * **Une seule fonction pour les trois plateformes.** iOS veut quatre
 * propriétés `shadow*`, Android un `elevation`, et le web un `boxShadow` — les
 * écrire à la main dans chaque composant produirait trois vérités.
 */
export function elevationFlottante() {
  // Le jeton est écrit en CSS — « 0 12px 32px rgba(...) » — parce que c'est la
  // forme dans laquelle un designer le donne. Les trois nombres en sont
  // extraits une fois, ici, plutôt que recopiés en quatre propriétés.
  const [, decalage, rayon] = /^0 (\d+)px (\d+)px/.exec(brut.elevation.float) ?? ['', '12', '32'];
  const hauteur = Number(decalage);
  const flou = Number(rayon);

  return Platform.select({
    web: { boxShadow: brut.elevation.float },
    android: { elevation: 12 },
    default: {
      shadowColor: COULEURS['ink.default'],
      shadowOffset: { width: 0, height: hauteur },
      shadowOpacity: 0.14,
      shadowRadius: flou,
    },
  }) as object;
}
