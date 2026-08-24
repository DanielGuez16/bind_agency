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
 * `line.onDark`, `bg.onDark`, `scrim.badgeOnDark`, les variantes `onDark` des
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

/**
 * Les trois couleurs du logotype.
 *
 * **Le logotype ne suit pas l'échelle d'encres**, il a la sienne : la passation
 * lui donne l'encre du système sur os et papier, le **blanc pur** sur encre,
 * satin et orange — et non `ink.onDark`, qui est l'encre claire du texte
 * courant. Les faire coïncider ferait suivre le logo le jour où l'une des deux
 * bougerait.
 *
 * Le point est `brand.500` dans les deux cas. C'est la seule couleur du
 * logotype, et c'est elle qui fait la marque : une variante blanche dont le
 * point suivrait les lettres serait un logotype monochrome pâle, c'est-à-dire
 * l'erreur que le vectoriel de la fondatrice a corrigée.
 */
export const ENCRES_DU_LOGOTYPE = produitBrut.marque.encres;

/**
 * Un voile d'encre à l'opacité demandée.
 *
 * **Les jetons de voile sont des aplats ; le mur a besoin d'une pente.** Ses
 * dégradés à trois arrêts laissent le haut de l'image intact, ce qu'aucune
 * valeur fixe ne fait. Plutôt que d'écrire `rgba(23,18,14,…)` dans un écran —
 * ce que la garde des couleurs littérales refuse, et à raison — l'opacité se
 * compose ici, sur l'encre du système.
 */
export function voileDEncre(opacite: number): string {
  const [r, v, b] = [1, 3, 5].map((i) => parseInt(brut.color.ink.default.slice(i, i + 2), 16));
  return `rgba(${r},${v},${b},${opacite})`;
}

export { nomDeFonte, pileDeFontes, policesAcharger, type Graisse, type Voix } from './polices';
export {
  familles,
  typography,
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
  'bg.inset': brut.color.bg.inset,
  'bg.inverse': brut.color.bg.inverse,
  'bg.onDark': brut.color.bg.onDark,

  'line.default': brut.color.line.default,
  'line.strong': brut.color.line.strong,
  'line.solo': brut.color.line.solo,
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
  // des surfaces creuses : `bg.inset` est exactement le cran de fond que la
  // v1.0 pose sous une surface, et le filet le raye.
  'media.placeholder': brut.color.bg.inset,
  'media.placeholderStripe': brut.color.line.default,
  'media.placeholderText': brut.color.ink.mute,
  'skeleton.base': brut.color.bg.inset,
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
 * Les rayons, par rôle.
 *
 * **La raison de la v1.0 est remplacée, pas conservée à côté de son contraire.**
 * Elle disait « la mode ne s'arrondit pas, et le bloc plein ne fonctionne que
 * d'équerre », et mettait les sept valeurs à zéro. Elle était vraie du bloc et
 * fausse de tout le reste : d'une propriété d'un objet on avait fait une loi de
 * système. La revue de campagne a nommé Uber Eats, et tout ce que les testeurs
 * trouvaient trop carré est ici.
 *
 * Ce qui reste vrai : **`none` est réservé au bloc accentué.** Un aplat de
 * marque aux angles arrondis devient un bouton, et la signature perd la raideur
 * qui la fait lire comme une signature.
 *
 * Deux valeurs pour les images, et ce n'est pas une hésitation : `photo` (16)
 * quand l'image est un objet dans une carte, `xl` (24) quand elle **est** la
 * carte. Une image encadrée et une image qui touche les bords ne demandent pas
 * le même arrondi optique.
 */
export const radius = {
  'radius.none': brut.radius.none,
  'radius.sm': brut.radius.sm,
  'radius.md': brut.radius.md,
  'radius.lg': brut.radius.lg,
  'radius.xl': brut.radius.xl,
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
  /**
   * Les quatre durées de l'attente. Elles disent **quand on montre**, pas
   * comment on décore — deux des trois règles retirent quelque chose.
   *
   * « Lent » veut dire « je ne sais pas si ça marche » : ce qui produit la
   * sensation n'est pas la durée mais l'incertitude. Rien n'a bougé, donc on
   * appuie une seconde fois, et la lenteur perçue devient mesurée.
   */
  appui: produit.motion.appui,
  etat: produit.motion.etat,
  fondu: produit.motion.fondu,
  seuilDAttente: produit.motion.seuilDAttente,
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
// ce qu'un voile doit peser pour qu'un texte tienne dessus
// --------------------------------------------------------------------------

/**
 * La luminance relative d'une couleur, au sens de WCAG.
 *
 * Exportée pour être éprouvée seule : c'est la seule arithmétique du dossier
 * de thème, et une erreur d'exposant s'y verrait nulle part ailleurs.
 */
export function luminance(hexa: string): number {
  const canaux = [1, 3, 5].map((i) => parseInt(hexa.slice(i, i + 2), 16) / 255);
  const lineaire = canaux.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lineaire[0] + 0.7152 * lineaire[1] + 0.0722 * lineaire[2];
}

/** Le rapport de contraste entre deux luminances. */
export function contraste(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * L'opacité minimale d'un voile pour qu'une encre claire y tienne.
 *
 * **Calculée sur la pire photo possible : une blanche.** Un voile est posé sur
 * une image dont on ne maîtrise rien ; le seul raisonnement qui vaille est
 * celui du cas le plus défavorable, et il n'est pas si rare — les mosaïques de
 * la fondatrice alternent justement des ensembles presque blancs.
 *
 * Elle vaut 0,606 pour `ink.onScrim` et 0,714 pour `ink.onScrimMuted` — l'ambre a
 * légèrement éclairci l'encre sourde, donc il en faut un peu moins.
 * **Des trois arrêts du système, seul `scrim.photoBottom` (0,88) les
 * dépasse** : un texte posé ailleurs que sur cet arrêt-là n'est pas
 * démontrable. C'est ce qui a fait passer la sous-ligne de l'accueil au blanc,
 * et le nom des cartes du fil sur une bande plutôt que sur la queue d'un
 * dégradé.
 */
export function opaciteMinimaleDuVoile(encre: 'ink.onScrim' | 'ink.onScrimMuted'): number {
  const claire = luminance(COULEURS[encre]);

  // Un pas de un millième : plus fin que ce qu'une valeur d'opacité écrite en
  // jeton peut porter, et le résultat est arrondi au millième de toute façon.
  for (let a = 0; a <= 1; a += 0.001) {
    // Le composite d'un voile d'encre sur du blanc, en luminance linéaire —
    // c'est bien le mélange des canaux, pas celui des luminances, mais sur du
    // blanc et de l'encre l'écart est sous le millième et le pas l'absorbe.
    const fond = luminance(melange(a));
    if (contraste(claire, fond) >= 4.5) return Math.round(a * 1000) / 1000;
  }
  // Aucune opacité ne suffit : l'encre n'est pas claire. Rendre 1 plutôt que
  // lever — l'appelant est un test, et un nombre se compare.
  return 1;
}

/** Le voile d'encre, à une opacité donnée, posé sur du blanc. */
function melange(alpha: number): string {
  const encre = [1, 3, 5].map((i) => parseInt(brut.color.ink.default.slice(i, i + 2), 16));
  const composite = encre.map((canal) => Math.round(255 * (1 - alpha) + canal * alpha));
  return `#${composite.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

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
/**
 * **La table d'hexadécimaux a disparu, et c'est une seconde vérité en moins.**
 * `color.tier` recopiait la rampe en valeurs — `#A83E06` pour le 700, `#F9BC97`
 * pour le 200 — si bien qu'un changement de direction la laissait derrière : au
 * passage à l'ambre, elle aurait encore porté l'orange brut. Design l'a
 * supprimée du système, et ce qu'elle contenait d'irremplaçable était deux
 * géométries, reprises ci-dessous depuis `components.md` §2.
 */
export const tierMatiere = null;

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
    epaisseur: 1.5, // components.md §2
    texte: 'brand.700',
    glyphePlein: 'brand.700',
    glypheVide: 'brand.200',
    barresPleines: 1,
  },
  // Teinte : la matière du milieu. Fond orange pâle, filet de marque.
  post: {
    matiere: 'tint',
    surface: 'brand.100',
    bordure: 'brand.500',
    epaisseur: 1, // components.md §2
    texte: 'brand.700',
    glyphePlein: 'brand.700',
    glypheVide: 'brand.200',
    barresPleines: 2,
  },
  // Aplat : toute la matière. C'est le seul des trois qui porte le bloc plein,
  // et la seule surface `brand.500` que la règle de comptage laisse se répéter.
  reel: {
    matiere: 'solid',
    surface: 'brand.500',
    bordure: 'transparent',
    epaisseur: 0, // components.md §2
    texte: 'ink.onBrand',
    glyphePlein: 'ink.onBrand',
    glypheVide: 'ink.onBrand',
    barresPleines: 3,
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
    epaisseur: 1.5,
    texte: 'brand.400',
    glyphePlein: 'brand.400',
    glypheVide: 'brand.900',
    barresPleines: 1,
  },
  post: {
    matiere: 'tint',
    surface: 'brand.900',
    bordure: 'brand.500',
    epaisseur: 1,
    texte: 'brand.200',
    glyphePlein: 'brand.200',
    glypheVide: 'brand.700',
    barresPleines: 2,
  },
  // L'aplat ne bouge pas. C'est ce qui garde l'ordre lisible d'un fond à
  // l'autre : le palier le plus exigeant est le seul dont la matière est la
  // même partout.
  reel: {
    matiere: 'solid',
    surface: 'brand.500',
    bordure: 'transparent',
    epaisseur: 0,
    texte: 'ink.onBrand',
    glyphePlein: 'ink.onBrand',
    glypheVide: 'ink.onBrand',
    barresPleines: 3,
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
 * Les deux ombres du système.
 *
 * **`elevation.card` revient, et la raison de la v1.0 est renversée.** Elle
 * disait « une carte se tient à son filet de 1 px » — c'était vrai d'une carte
 * d'équerre, et la v1.0 n'en avait pas d'autre. La v1.1 arrondit à 18 px, et un
 * coin de 18 px sans ombre ne se pose pas sur la page, il flotte au-dessus sans
 * dire à quelle hauteur. L'ombre est minuscule — 7 % d'encre à 10 px de flou —
 * et c'est le point : elle ne creuse pas, elle appuie.
 *
 * La crainte de la v1.0 tenait toujours : une ombre sous chaque carte d'un fil
 * produit une nappe grise. C'est ce qui décide de la valeur, pas de l'absence.
 *
 * **Une seule fonction par ombre, pour les trois plateformes.** iOS veut quatre
 * propriétés `shadow*`, Android un `elevation`, et le web un `boxShadow` —
 * les écrire à la main dans chaque composant produirait trois vérités.
 */
function ombreDe(jeton: string, elevationAndroid: number) {
  // Le jeton est écrit en CSS — « 0 2px 10px rgba(23,20,15,0.07) » — parce que
  // c'est la forme dans laquelle un designer le donne. Les quatre nombres en
  // sont extraits une fois, ici, plutôt que recopiés en quatre propriétés dans
  // chaque composant.
  const lu = /^0 (\d+)px (\d+)px rgba\([^)]*,\s*([\d.]+)\)$/.exec(jeton);
  if (!lu) {
    // Pas de repli silencieux : une ombre qui retombe sur des valeurs inventées
    // se voit à l'œil et jamais en revue. Le jeton vient de Design et sa forme
    // est stable ; si elle change, c'est ici qu'il faut le savoir.
    throw new Error(`elevation illisible : « ${jeton} »`);
  }
  const [, hauteur, flou, opacite] = lu;

  return Platform.select({
    web: { boxShadow: jeton },
    android: { elevation: elevationAndroid },
    default: {
      shadowColor: COULEURS['ink.default'],
      shadowOffset: { width: 0, height: Number(hauteur) },
      shadowOpacity: Number(opacite),
      shadowRadius: Number(flou),
    },
  }) as object;
}

/** Ce qui flotte au-dessus du contenu : feuille, menu, dialogue. */
export function elevationFlottante() {
  return ombreDe(brut.elevation.overlay, 12);
}

/**
 * Ce qui se pose sur la page : une carte, et rien d'autre.
 *
 * Android reçoit 1 et non 2 : son `elevation` dessine aussi un contour, et à 2
 * il double le filet de la carte au lieu de l'ombrer.
 */
export function elevationDeCarte() {
  return ombreDe(brut.elevation.card, 1);
}
