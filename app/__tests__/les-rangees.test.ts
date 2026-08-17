/**
 * La règle des rangées par quartier, éprouvée sans un pixel.
 *
 * Comme le cycle du mur, le découpage vit hors du rendu : ce qui est promis —
 * « les quartiers restent l'ossature », « une rangée courte ne se cache pas »,
 * « aucun salon ne disparaît » — se vérifie sur des objets, pas sur un arbre de
 * composants. Monter six cartes pour éprouver un ordre est le meilleur moyen de
 * n'éprouver ni l'un ni les autres.
 */
import type { CommerceDuFil, Fil, Neighborhood } from '../src/api';
import { enRangees, SALONS_POUR_REMPLIR } from '../src/screens/mur/rangees';

function salon(id: string, quartier: Neighborhood | null, metres: number): CommerceDuFil {
  return {
    business_id: id,
    name: `Salon ${id}`,
    category: 'beauty',
    address: null,
    cover_photo_key: null,
    cover_portrait_key: null,
    neighborhood: quartier,
    distance_metres: metres,
    items: [],
  } as unknown as CommerceDuFil;
}

function compte(quartier: Neighborhood, commerces: number, metres: number) {
  return { quartier, commerces, prestations: commerces, distance_metres: metres };
}

function fil(
  commerces: CommerceDuFil[],
  quartiers: ReturnType<typeof compte>[],
): Fil {
  return {
    commerces,
    obstacles: [],
    rayon_metres: 15_000,
    total_prestations: commerces.length,
    categories: [],
    rayons: [],
    quartiers,
    prochain_palier: null,
  } as unknown as Fil;
}

describe('l’ossature est le quartier, dans l’ordre du serveur', () => {
  it('une rangée par quartier, du plus proche au plus lointain', async () => {
    const rangees = enRangees(
      fil(
        [
          salon('a', 'brickell', 4200),
          salon('b', 'wynwood', 320),
          salon('c', 'wynwood', 900),
        ],
        [compte('wynwood', 2, 320), compte('brickell', 1, 4200)],
      ),
    );

    expect(rangees.map((r) => r.quartier)).toEqual(['wynwood', 'brickell']);
    expect(rangees[0].salons.map((s) => s.business_id)).toEqual(['b', 'c']);
  });

  it('et un quartier annoncé sans salon rendu ne fait pas de rangée vide', async () => {
    // `quartiers` compte ce que le fil connaît ; si aucun salon n'en vient dans
    // ce qui est rendu, une rangée à titre seul se lirait comme un chargement
    // qui n'a pas fini.
    const rangees = enRangees(
      fil([salon('a', 'wynwood', 320)], [compte('wynwood', 1, 320), compte('midtown', 3, 5000)]),
    );

    expect(rangees.map((r) => r.quartier)).toEqual(['wynwood']);
  });

  it('aucun salon ne disparaît, même hors des quartiers ouverts', async () => {
    // **C'est le vrai risque de cette vue.** La liste des quartiers est fermée :
    // un salon hors des dix ouverts porte `neighborhood: null` et le serveur ne
    // le compte dans aucun quartier. Une ossature de quartiers le perdrait en
    // silence — filtrer par catégorie cacherait alors des salons réservables.
    const rangees = enRangees(
      fil(
        [salon('a', 'wynwood', 320), salon('b', null, 1500), salon('c', null, 2000)],
        [compte('wynwood', 1, 320)],
      ),
    );

    expect(rangees).toHaveLength(2);
    expect(rangees[1].quartier).toBeNull();
    expect(rangees[1].salons.map((s) => s.business_id)).toEqual(['b', 'c']);
  });

  it('et ils ferment la liste plutôt que de couper l’ordre des distances', async () => {
    const rangees = enRangees(
      fil(
        [salon('sans', null, 100), salon('a', 'wynwood', 320), salon('b', 'brickell', 4200)],
        [compte('wynwood', 1, 320), compte('brickell', 1, 4200)],
      ),
    );

    expect(rangees[rangees.length - 1].quartier).toBeNull();
  });
});

describe('une rangée courte ne ressemble pas à une erreur de chargement', () => {
  /** Trois salons remplissent la largeur : 216 + 5 + 150 s'arrête juste avant. */
  it('le seuil est celui de la largeur, et il est de trois', async () => {
    expect(SALONS_POUR_REMPLIR).toBe(3);
  });

  it('sous le seuil, la rangée annonce la suivante avec sa distance', async () => {
    const rangees = enRangees(
      fil(
        [
          salon('a', 'wynwood', 320),
          salon('b', 'brickell', 4200),
          salon('c', 'brickell', 4400),
          salon('d', 'brickell', 4600),
        ],
        [compte('wynwood', 1, 320), compte('brickell', 3, 4200)],
      ),
    );

    expect(rangees[0].suite).toEqual({
      quartier: 'brickell',
      commerces: 3,
      distanceMetres: 4200,
    });
  });

  it('au seuil, elle ne l’annonce pas : le dépassement suffit', async () => {
    // Le sens inverse. Une carte d'os sur une rangée qui déborde déjà prendrait
    // la place d'un salon pour dire quelque chose que le geste dit mieux.
    const rangees = enRangees(
      fil(
        [
          salon('a', 'wynwood', 320),
          salon('b', 'wynwood', 400),
          salon('c', 'wynwood', 500),
          salon('d', 'brickell', 4200),
        ],
        [compte('wynwood', 3, 320), compte('brickell', 1, 4200)],
      ),
    );

    expect(rangees[0].suite).toBeNull();
  });

  it('la dernière rangée n’annonce rien, faute de suite', async () => {
    // **Une carte qui renverrait à rien est un cul-de-sac**, la même faute que
    // l'élargissement qui n'ouvre aucun salon.
    const rangees = enRangees(
      fil([salon('a', 'wynwood', 320)], [compte('wynwood', 1, 320)]),
    );

    expect(rangees[0].suite).toBeNull();
  });

  it('et la rangée des sans-quartier ne s’annonce pas non plus', async () => {
    // Elle n'a pas de nom à porter : « Elsewhere · 1,5 km » ne situerait rien.
    const rangees = enRangees(
      fil(
        [salon('a', 'wynwood', 320), salon('b', null, 1500)],
        [compte('wynwood', 1, 320)],
      ),
    );

    expect(rangees[0].suite).toBeNull();
  });
});
