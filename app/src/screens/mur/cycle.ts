/**
 * Le cycle du mur : six positions, un ordre fixe, qui se répète.
 *
 * **L'alternance devient une règle, et c'est tout le sujet.** La première passe
 * du fil alternait les formats par intention — quelqu'un décidait. Ici la
 * position décide : les salons arrivent triés par distance et se posent dans
 * l'ordre du cycle. Le plus proche tombe en position 1, la plus grande, mais
 * c'est un effet du tri et non une mise en avant. **Aucun classement éditorial,
 * aucun salon promu.**
 *
 * C'est ce qui rend l'écran tenable pour une application qu'on ouvre dix fois
 * par jour : le pouce apprend le rythme sans le remarquer, et personne n'a à
 * défendre pourquoi tel salon a eu le grand format.
 *
 * **Huit salons, puis une respiration.** Un cycle porte huit salons répartis
 * sur cinq blocs et se referme sur un panneau os. Vingt salons font donc deux
 * cycles pleins et un dernier partiel — le fil se termine sur un bloc complet,
 * jamais sur une moitié orpheline.
 *
 * Ce fichier ne rend rien. Il dit **où va quoi**, et se teste seul.
 */

/** Les six formats, dans l'ordre où ils se répètent. */
export type Format = 'heros' | 'duo' | 'bande' | 'herosGalerie' | 'triptyque' | 'respiration';

export type Position = {
  format: Format;
  /** La hauteur du bloc, en points. Elle ne dépend pas du contenu. */
  hauteur: number;
  /** Combien de salons le bloc porte. La respiration n'en porte aucun. */
  salons: number;
};

/**
 * L'ordre, et il ne se devine pas.
 *
 * Les hauteurs viennent de la planche telle quelle. Elles ne sont pas
 * proportionnelles à une grille : ce sont des valeurs dessinées, et les
 * arrondir à un multiple les ferait toutes se ressembler — ce que le cycle
 * cherche précisément à éviter.
 */
export const CYCLE: readonly Position[] = [
  { format: 'heros', hauteur: 520, salons: 1 },
  { format: 'duo', hauteur: 238, salons: 2 },
  { format: 'bande', hauteur: 150, salons: 1 },
  { format: 'herosGalerie', hauteur: 470, salons: 1 },
  { format: 'triptyque', hauteur: 158, salons: 3 },
  { format: 'respiration', hauteur: 212, salons: 0 },
] as const;

/**
 * Trois pixels séparent toujours deux photos, à l'horizontale comme à la
 * verticale, y compris de part et d'autre d'une respiration.
 *
 * **C'est la seule mesure constante de l'écran**, et c'est elle qui fait tenir
 * six formats ensemble sans qu'aucun ne ressemble à une carte. Une gouttière
 * qui varierait redonnerait à chaque bloc un bord, donc une carte.
 */
export const FILET = 3;

/** Ce qu'un cycle complet porte de salons. Huit, par construction. */
export const SALONS_PAR_CYCLE = CYCLE.reduce((somme, position) => somme + position.salons, 0);

/** Un bloc du mur, prêt à rendre : sa position, et les salons qui y tombent. */
export type Bloc<T> = {
  format: Format;
  hauteur: number;
  /** Vide sur une respiration. Jamais partiel ailleurs — voir `enBlocs`. */
  salons: T[];
  /** Le rang du cycle, à partir de 1. Sert à nommer et à éprouver. */
  rangDuCycle: number;
  /** Combien de cycles complets précèdent. La respiration s'en sert. */
  cycle: number;
};

/**
 * Pose une liste de salons dans les positions du cycle.
 *
 * **Un bloc partiel ne se rend pas.** Si les salons restants ne remplissent pas
 * la position qui vient — deux salons pour un triptyque — le mur s'arrête avant
 * elle. Un triptyque à deux images n'est pas un triptyque, c'est un duo mal
 * cadré, et la géométrie qui tient l'écran ne survit pas à une exception.
 *
 * **La respiration ne se rend qu'entre deux cycles**, jamais en queue. Elle
 * annonce ce qui vient ; posée en dernier, elle annoncerait le vide.
 */
export function enBlocs<T>(salons: readonly T[]): Bloc<T>[] {
  const blocs: Bloc<T>[] = [];
  let reste = [...salons];
  let cycle = 0;

  while (reste.length > 0) {
    const debutDuCycle = reste.length;

    for (const [rang, position] of CYCLE.entries()) {
      if (position.salons === 0) {
        // La respiration ferme un cycle. Elle n'a de sens que si un autre
        // suit : en queue de mur, elle promettrait une suite qui n'existe pas.
        if (reste.length > 0) {
          blocs.push({ ...position, salons: [], rangDuCycle: rang + 1, cycle });
        }
        continue;
      }
      if (reste.length < position.salons) return blocs;

      blocs.push({
        ...position,
        salons: reste.slice(0, position.salons),
        rangDuCycle: rang + 1,
        cycle,
      });
      reste = reste.slice(position.salons);
    }

    // Aucune position n'a consommé : sans cette garde, une liste que le cycle
    // ne sait pas entamer ferait tourner la boucle sans fin.
    if (reste.length === debutDuCycle) return blocs;
    cycle += 1;
  }

  return blocs;
}
