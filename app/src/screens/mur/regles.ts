/**
 * Les deux règles que le mur applique à chaque photo.
 *
 * Séparées du rendu parce qu'elles se décident, et qu'une décision qui vit dans
 * du JSX se relit mal et se teste au travers de six composants.
 */
import { CYCLE, type Format } from './cycle';

// --------------------------------------------------------------------------
// le texte descend avec le format
// --------------------------------------------------------------------------

/**
 * Le corps du nom, par format.
 *
 * **Ce n'est pas une échelle typographique, c'est une échelle de place — et la
 * place se mesure en largeur, pas en hauteur.** C'est ce qui surprend en
 * lisant les valeurs : la bande fait 150 points de haut et porte un nom de 22,
 * quand le duo en fait 238 et n'en porte que 19. La bande est haute d'un
 * cinquième mais **large de tout l'écran**, et son texte vit à côté de l'image
 * plutôt que dessous ; le duo, lui, coupe l'écran en deux et n'en laisse que la
 * moitié à chaque nom.
 *
 * L'ordre est donc : d'abord le nombre de salons de front — un, deux, trois —
 * puis la hauteur pour départager. Un test le vérifie dans cet ordre, et une
 * lecture qui ne regarderait que la hauteur conclurait à une erreur.
 *
 * Les valeurs viennent de la planche, pas d'une progression calculée : une
 * suite régulière donnerait à deux formats voisins la même autorité.
 */
const CORPS_DU_NOM: Record<Exclude<Format, 'respiration'>, number> = {
  heros: 28,
  herosGalerie: 28,
  bande: 22,
  duo: 19,
  triptyque: 15,
};

/**
 * En dessous de ce corps, **le nom reste seul**.
 *
 * « Un triptyque ne porte jamais trois lignes » : à 158 points de haut, un
 * quartier, un nom et une prestation empilés ne laissent plus voir l'image, et
 * les trois deviennent illisibles ensemble plutôt que l'une d'elles utile.
 * C'est la prestation qui tombe, jamais le nom — c'est le nom qu'on cherche.
 */
export const CORPS_OU_LA_PRESTATION_TOMBE = 15;

export type Typographie = {
  /** Le corps du nom, en points. */
  nom: number;
  /** Faux quand le format est trop court pour porter une troisième ligne. */
  avecPrestation: boolean;
};

export function typographieDe(format: Format): Typographie {
  if (format === 'respiration') {
    // La respiration ne porte pas de salon, donc pas de nom. L'appeler ici est
    // une erreur d'appel, pas un cas à rendre — et un défaut silencieux
    // donnerait un nom de 15 sur un panneau qui n'en a pas.
    throw new Error(
      "La respiration ne porte aucun salon : elle n'a pas de typographie de nom.",
    );
  }
  const nom = CORPS_DU_NOM[format];
  return { nom, avecPrestation: nom > CORPS_OU_LA_PRESTATION_TOMBE };
}

// --------------------------------------------------------------------------
// une seule chose orange par photo
// --------------------------------------------------------------------------

/**
 * Ce qui porte l'orange sur une photo — **une chose, jamais deux**.
 *
 * La pastille de distance est orange par défaut. Quand un badge reel est là, il
 * prend le pas et la distance passe en voile clair : deux aplats de marque sur
 * la même image se disputent l'œil, et l'écran cesse d'avoir un point d'entrée.
 *
 * C'est la règle du bloc accentué transposée à la photo — le système compte
 * déjà les blocs orange par écran, et un mur en porterait vingt sans cette
 * borne locale.
 */
export type Accent = {
  /** Le badge de format prend l'orange quand la contrepartie est un reel. */
  badgeEnOrange: boolean;
  /** La pastille de distance ne l'a que si le badge ne l'a pas prise. */
  distanceEnOrange: boolean;
};

export function accentDe(contentFormat: string): Accent {
  const badgeEnOrange = contentFormat === 'reel';
  return { badgeEnOrange, distanceEnOrange: !badgeEnOrange };
}

// --------------------------------------------------------------------------
// le voile
// --------------------------------------------------------------------------

/**
 * D'où vient le voile qui rend le texte lisible sur la photo.
 *
 * **La bande est le seul format assez court pour que le texte vive à côté de
 * l'image plutôt que dessous.** À 150 points, un voile du bas mangerait la
 * moitié de la hauteur pour loger deux lignes ; à l'horizontale il n'en prend
 * que la gauche, et la photo garde son sujet. Partout ailleurs le texte se pose
 * en pied, et le voile monte du bas.
 */
export type SensDuVoile = 'bas' | 'gauche';

export function voileDe(format: Exclude<Format, 'respiration'>): SensDuVoile {
  return format === 'bande' ? 'gauche' : 'bas';
}

/**
 * Les arrêts du voile, repris de la planche.
 *
 * Ils ne se déduisent pas d'un jeton : `scrim.photoBottom` est un aplat, et ce
 * qu'il faut ici est une pente à trois arrêts qui laisse le haut de l'image
 * intact. Les valeurs sont celles que Design a posées.
 */
export const VOILE = {
  bas: [0, 0.44, 0.86],
  gauche: [0.82, 0.34, 0],
} as const;

// --------------------------------------------------------------------------
// l'aperçu de galerie
// --------------------------------------------------------------------------

/**
 * Quel héros porte l'aperçu de galerie.
 *
 * **Le seul de position 4.** Les deux héros ont presque la même hauteur — 520
 * et 470 — et sans cette différence ils se confondraient : le cycle donnerait
 * l'impression de répéter un format au lieu d'en tenir six. L'aperçu n'est donc
 * pas une décoration, c'est ce qui distingue deux positions.
 */
export function porteLApercuDeGalerie(format: Format): boolean {
  return format === 'herosGalerie';
}

/** Les vignettes montrées avant le « + n ». Au-delà, le compte parle mieux. */
export const VIGNETTES_DE_GALERIE = 3;

/** Ce que les hauteurs de la planche imposent, relu par les tests. */
export const HAUTEURS = Object.fromEntries(
  CYCLE.map((position) => [position.format, position.hauteur]),
) as Record<Format, number>;
