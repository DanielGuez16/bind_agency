/**
 * Le cycle du mur : six positions, un ordre fixe, qui se répète.
 *
 * **Ce que ces tests protègent n'est pas une mise en page, c'est une
 * promesse.** Les salons arrivent triés par distance et se posent dans les
 * positions ; personne ne décide quel salon mérite le grand format. Le jour où
 * quelqu'un ajoutera « et si le salon est bien noté, on le monte en héros », ce
 * sont ces tests qui diront non — pas une relecture.
 */
import { CYCLE, enBlocs, FILET, SALONS_PAR_CYCLE } from '../src/screens/mur/cycle';

/** Des salons numérotés : leur ordre est tout ce qu'on éprouve ici. */
const salons = (nombre: number) => Array.from({ length: nombre }, (_, rang) => rang);

describe('la règle du cycle', () => {
  it('porte huit salons, répartis sur cinq blocs', () => {
    expect(SALONS_PAR_CYCLE).toBe(8);
    expect(CYCLE.filter((position) => position.salons > 0)).toHaveLength(5);
    expect(CYCLE).toHaveLength(6);
  });

  it('se referme sur une respiration, qui ne porte aucun salon', () => {
    const derniere = CYCLE[CYCLE.length - 1];
    expect(derniere.format).toBe('respiration');
    expect(derniere.salons).toBe(0);
  });

  it('n’a qu’une seule gouttière, et elle vaut trois', () => {
    // La seule mesure constante de l'écran. Une gouttière qui varierait
    // redonnerait un bord à chaque bloc, donc une carte.
    expect(FILET).toBe(3);
  });

  it('les six hauteurs sont toutes distinctes', () => {
    // **Le sens inverse de « six formats ».** Deux positions de même hauteur se
    // liraient comme un même format répété, et le cycle cesserait de s'entendre.
    const hauteurs = CYCLE.map((position) => position.hauteur);
    expect(new Set(hauteurs).size).toBe(hauteurs.length);
  });
});

describe('la distance ordonne, la position met en valeur', () => {
  it('pose les salons dans l’ordre reçu, sans en réordonner aucun', () => {
    // **Aucun classement éditorial.** Le plus proche tombe en position 1, la
    // plus grande — mais c'est un effet du tri, pas un choix. Ce test tomberait
    // au premier tri ajouté ici, et c'est ce qu'on lui demande.
    const blocs = enBlocs(salons(8));
    expect(blocs.flatMap((bloc) => bloc.salons)).toEqual(salons(8));
  });

  it('remplit les cinq blocs porteurs dans l’ordre du cycle', () => {
    const blocs = enBlocs(salons(8));
    expect(blocs.map((bloc) => bloc.format)).toEqual([
      'heros',
      'duo',
      'bande',
      'herosGalerie',
      'triptyque',
    ]);
    expect(blocs.map((bloc) => bloc.salons.length)).toEqual([1, 2, 1, 1, 3]);
  });

  it('vingt salons font deux cycles pleins et un dernier partiel', () => {
    // Le compte de la planche, tel quel.
    const blocs = enBlocs(salons(20));
    const respirations = blocs.filter((bloc) => bloc.format === 'respiration');

    expect(respirations).toHaveLength(2);
    // Seize salons dans les deux cycles pleins, quatre dans le troisième —
    // héros, duo, bande — et le triptyque n'a pas de quoi se former.
    expect(blocs.flatMap((bloc) => bloc.salons)).toHaveLength(20);
    expect(blocs[blocs.length - 1].format).toBe('bande');
  });
});

describe('un bloc partiel ne se rend pas', () => {
  it('deux salons ne font pas un triptyque', () => {
    // **Un triptyque à deux images est un duo mal cadré.** La géométrie qui
    // tient l'écran ne survit pas à une exception, et un bloc incomplet est
    // exactement l'endroit où l'on serait tenté d'en faire une.
    // Les quatre premières positions consomment cinq salons ; deux restent, et
    // le triptyque en veut trois.
    const blocs = enBlocs(salons(5 + 2));
    const dernier = blocs[blocs.length - 1];
    expect(dernier.format).not.toBe('triptyque');
    // Les deux salons de trop ne sont donc pas rendus, plutôt que rendus mal.
    expect(blocs.flatMap((bloc) => bloc.salons)).toHaveLength(5);
  });

  it.each([
    [1, ['heros']],
    [2, ['heros']],
    [3, ['heros', 'duo']],
    [4, ['heros', 'duo', 'bande']],
    [5, ['heros', 'duo', 'bande', 'herosGalerie']],
  ])('%i salons s’arrêtent avant le bloc qu’ils ne remplissent pas', (nombre, attendus) => {
    expect(enBlocs(salons(nombre)).map((bloc) => bloc.format)).toEqual(attendus);
  });

  it('et le mur se termine sur un bloc complet, jamais sur une moitié', () => {
    // Le sens inverse, sur toutes les tailles jusqu'à trois cycles : quel que
    // soit le nombre reçu, aucun bloc rendu n'est à moitié rempli.
    for (let nombre = 0; nombre <= 24; nombre += 1) {
      const partiels = enBlocs(salons(nombre)).filter(
        (bloc) => bloc.salons.length > 0 && bloc.salons.length !== CYCLE[bloc.rangDuCycle - 1].salons,
      );
      expect({ nombre, partiels }).toEqual({ nombre, partiels: [] });
    }
  });
});

describe('la respiration s’intercale, elle ne conclut pas', () => {
  it('n’apparaît pas en queue de mur', () => {
    // Elle annonce ce qui vient. Posée en dernier, elle annoncerait le vide —
    // et la planche s'appuie dessus : « le salon juste dessous en vient ».
    const blocs = enBlocs(salons(8));
    expect(blocs[blocs.length - 1].format).not.toBe('respiration');
    expect(blocs.some((bloc) => bloc.format === 'respiration')).toBe(false);
  });

  it('sépare deux cycles quand un second commence', () => {
    const blocs = enBlocs(salons(9));
    const rangs = blocs.map((bloc) => bloc.format);
    expect(rangs).toContain('respiration');
    // Elle est bien entre les deux, pas ailleurs.
    expect(rangs.indexOf('respiration')).toBe(5);
    expect(rangs[6]).toBe('heros');
  });

  it('numérote les cycles, pour que la respiration sache ce qu’elle annonce', () => {
    const blocs = enBlocs(salons(17));
    expect(blocs.filter((bloc) => bloc.format === 'respiration').map((bloc) => bloc.cycle)).toEqual([
      0, 1,
    ]);
  });
});

describe('les cas qui font tourner une boucle sans fin', () => {
  it('aucun salon ne rend aucun bloc', () => {
    expect(enBlocs([])).toEqual([]);
  });

  it('et une liste que le cycle n’entame pas ne boucle pas', () => {
    // La garde du `debutDuCycle`. Sans elle, un cycle dont la première position
    // porterait plus de salons qu'il n'en reste tournerait indéfiniment — le
    // genre de défaut qui ne se voit qu'en production, sur un fil court.
    expect(() => enBlocs(salons(0))).not.toThrow();
    expect(enBlocs(salons(1)).map((bloc) => bloc.format)).toEqual(['heros']);
  });
});
