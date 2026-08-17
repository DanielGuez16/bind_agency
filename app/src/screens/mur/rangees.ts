/**
 * Les rangées par quartier : la règle, sans un pixel de rendu.
 *
 * C'est la direction 1b de la planche « Fil v2 », et elle ne remplace pas le
 * mur — elle devient **ce que montre une catégorie choisie**. Design l'écrit
 * ainsi : « le mur de 1a peut être le fil par défaut, et les rangées de 1b
 * devenir ce que montre une catégorie choisie ». Deux axes : on descend par
 * quartiers, on balaie à l'horizontale dans chacun.
 *
 * **Le quartier fait le tri que les filtres faisaient mal.** Ce n'est pas un
 * thème abstrait, ce sont des endroits qui existent, et une créatrice de Miami
 * sait déjà lequel elle aime.
 *
 * Ce fichier ne décide que trois choses, et chacune s'éprouve seule :
 *
 * — **L'ordre des rangées**, qui est celui de `quartiers` : le fil les rend du
 *   plus proche au plus lointain, et les retrier ici donnerait deux vérités.
 *
 * — **Les salons sans quartier ne disparaissent pas.** Le serveur ne les compte
 *   dans aucun quartier — la liste est fermée, un salon hors des dix ouverts
 *   porte `neighborhood: null` — et une vue dont l'ossature est le quartier les
 *   perdrait en silence. Filtrer par catégorie cacherait alors des salons
 *   réservables, ce qui est pire que ne pas filtrer. Ils forment une dernière
 *   rangée, qui n'a pas de nom de quartier à porter.
 *
 * — **Une rangée courte se termine par un aperçu de la suivante.** Sous trois
 *   salons, les cartes n'atteignent pas le bord droit : le geste horizontal ne
 *   s'annonce plus, et la rangée ressemble à une erreur de chargement. La carte
 *   d'os dit ce qu'il y a plus loin plutôt que de laisser un blanc.
 */
import type { CommerceDuFil, Fil, Neighborhood } from '../../api';

/**
 * Le nombre de salons sous lequel une rangée ne remplit plus sa largeur.
 *
 * Mesuré sur la planche et non choisi : la première carte fait 216, les
 * suivantes 150, l'écart 5, et la marge de gauche 18. Sur les 390 points de
 * l'écran de référence, deux cartes occupent 216 + 5 + 150 = 371 et s'arrêtent
 * juste avant le bord. Il en faut donc une troisième pour que quelque chose
 * dépasse, et c'est ce dépassement qui annonce le glissement — la planche s'y
 * tient : « les cartes dépassent le bord droit, le geste horizontal s'annonce
 * sans flèche ».
 */
export const SALONS_POUR_REMPLIR = 3;

/** Ce qu'une rangée courte annonce : le quartier d'après, et sa distance. */
export type ApercuDeLaSuite = {
  quartier: Neighborhood;
  commerces: number;
  distanceMetres: number;
};

export type Rangee = {
  /** `null` pour la rangée des salons hors des quartiers ouverts. */
  quartier: Neighborhood | null;
  /** Les salons du quartier, du plus proche au plus lointain. */
  salons: CommerceDuFil[];
  /**
   * Ce que la rangée annonce en la fermant. `null` quand elle remplit sa
   * largeur, ou qu'aucune rangée ne la suit — une carte qui renverrait à rien
   * serait le cul-de-sac chiffré que le produit refuse ailleurs.
   */
  suite: ApercuDeLaSuite | null;
};

/**
 * Le fil, découpé en rangées.
 *
 * Les quartiers viennent de `quartiers`, les salons de `commerces` : on ne
 * recompte pas ce que le serveur a compté, on ne retrie pas ce qu'il a trié.
 * Un quartier annoncé sans aucun salon rendu ne fait pas de rangée — il n'y
 * aurait rien à y mettre.
 */
export function enRangees(fil: Fil): Rangee[] {
  const parQuartier = new Map<Neighborhood, CommerceDuFil[]>();
  const ailleurs: CommerceDuFil[] = [];

  for (const commerce of fil.commerces) {
    if (commerce.neighborhood === null) {
      ailleurs.push(commerce);
      continue;
    }
    const deja = parQuartier.get(commerce.neighborhood);
    if (deja) deja.push(commerce);
    else parQuartier.set(commerce.neighborhood, [commerce]);
  }

  const rangees: Rangee[] = fil.quartiers
    .map((compte) => ({
      quartier: compte.quartier,
      salons: parQuartier.get(compte.quartier) ?? [],
      suite: null,
    }))
    .filter((rangee) => rangee.salons.length > 0);

  // Les sans-quartier ferment la liste : ils ne sont pas plus loin, ils sont
  // ailleurs, et les glisser au milieu couperait l'ordre des distances.
  if (ailleurs.length > 0) rangees.push({ quartier: null, salons: ailleurs, suite: null });

  return rangees.map((rangee, rang) => {
    if (rangee.salons.length >= SALONS_POUR_REMPLIR) return rangee;

    const suivante = rangees[rang + 1];
    if (!suivante) return rangee;

    // **Une seule garde, et elle couvre les deux cas.** Il y en avait deux :
    // celle-ci, et un `suivante.quartier === null` au-dessus pour la rangée des
    // sans-quartier, qui n'a pas de nom à annoncer. La seconde ne pouvait pas
    // tomber — `quartiers` ne contient que des quartiers nommés, donc chercher
    // `null` dedans ne rend jamais rien et cette ligne suffisait déjà. Une
    // mutation l'a montré ; la relecture ne l'avait pas vue.
    const compte = fil.quartiers.find((q) => q.quartier === suivante.quartier);
    if (!compte) return rangee;

    return {
      ...rangee,
      suite: {
        // Le nom vient du compte et non de la rangée : c'est lui qui le porte
        // typé, et c'est la même valeur — la rangée a été bâtie dessus.
        quartier: compte.quartier,
        commerces: suivante.salons.length,
        distanceMetres: compte.distance_metres,
      },
    };
  });
}
