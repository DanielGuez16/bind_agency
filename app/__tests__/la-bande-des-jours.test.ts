/**
 * La bande de quatorze jours, éprouvée sans un pixel.
 *
 * Comme le cycle du mur avant elle, la règle vit hors du rendu : ce qui est
 * promis — « fermé n'est pas complet », « les deux jours ouverts les plus
 * proches », « on ouvre sur un jour qui a de la place » — se vérifie sur des
 * objets.
 *
 * **Ce que ces tests ne peuvent pas éprouver, ils le nomment.** Le quatrième
 * état — le jour écoulé — n'est pas servi : à 20 h, le jour même rend
 * `ouvert: true, creneaux_libres: 0`, indistinguable d'un jour complet. Un test
 * qui l'exigerait échouerait sur une donnée qui n'existe pas ; un test qui
 * l'ignorerait laisserait croire que la question est réglée. Il est donc écrit
 * en creux, et `TASKS.md` le porte.
 */
import { etatDuJour, joursProches, premierJourUtile } from '../src/screens/creneau/bande';

/** Un jour de la bande, réduit à ce qui décide. */
function jour(date: string, ouvert: boolean, libres: number) {
  return { jour: date, ouvert, creneaux_libres: libres };
}

/**
 * Une bande de six jours qui porte les trois états, et **les porte
 * distinctement**.
 *
 * Le 20 est fermé, le 21 est ouvert mais plein : c'est le couple qui sépare les
 * deux implémentations. Une bande dont tous les jours vides seraient fermés
 * passerait un test de « fermé » sans jamais éprouver « complet », et les deux
 * mots resteraient interchangeables — ce que la planche interdit.
 */
const BANDE = [
  jour('2026-08-19', true, 3),
  jour('2026-08-20', false, 0),
  jour('2026-08-21', true, 0),
  jour('2026-08-22', true, 2),
  jour('2026-08-23', true, 6),
  jour('2026-08-24', false, 0),
];

describe('trois états, et ils ne se confondent pas', () => {
  it('ferme, complet et ouvert se distinguent sur les deux champs', () => {
    // **Les deux champs, et non le seul compte.** Un écran qui n'aurait que
    // `creneaux_libres` peindrait le 20 et le 21 de la même façon, et la
    // personne croirait le salon fermé un jour où il déborde.
    expect(etatDuJour(BANDE[1])).toBe('ferme');
    expect(etatDuJour(BANDE[2])).toBe('complet');
    expect(etatDuJour(BANDE[0])).toBe('ouvert');
  });

  it('et un jour ouvert à zéro n’est jamais « fermé »', () => {
    // Le sens qui se perd en premier : la tentation est de traiter zéro comme
    // une fermeture, parce que les deux se rendent « sans place ».
    expect(etatDuJour(jour('2026-08-21', true, 0))).not.toBe('ferme');
    expect(etatDuJour(jour('2026-08-20', false, 0))).not.toBe('complet');
  });
});

describe('les deux jours ouverts les plus proches', () => {
  it('regarde en avant d’abord', () => {
    // On choisit un jour pour s'y rendre : l'ordre naturel est vers l'avant.
    // Depuis le 20 fermé, le 22 et le 23 — et non le 19 qui précède.
    expect(joursProches(BANDE, '2026-08-20').map((j) => j.jour)).toEqual([
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('puis en arrière quand l’avant ne suffit pas', () => {
    // Depuis le 24, dernier jour et fermé : rien devant, donc les deux
    // derniers ouverts en arrière, du plus proche au plus lointain.
    expect(joursProches(BANDE, '2026-08-24').map((j) => j.jour)).toEqual([
      '2026-08-23',
      '2026-08-22',
    ]);
  });

  it('ne propose jamais un jour sans place', () => {
    // **La moitié qui compte.** Compléter à deux avec un jour fermé ferait une
    // proposition qui ne mène nulle part, sur l'écran qui vient précisément
    // d'en refuser une. Une bande dont un seul jour est ouvert doit rendre un
    // seul jour, pas deux.
    const presqueVide = [
      jour('2026-08-19', false, 0),
      jour('2026-08-20', true, 1),
      jour('2026-08-21', false, 0),
    ];
    expect(joursProches(presqueVide, '2026-08-19').map((j) => j.jour)).toEqual(['2026-08-20']);
  });

  it('et rien du tout quand aucun jour n’a de place', () => {
    const tousFermes = [jour('2026-08-19', false, 0), jour('2026-08-20', true, 0)];
    expect(joursProches(tousFermes, '2026-08-19')).toEqual([]);
  });

  it('rend un tableau vide sur un jour hors de la bande', () => {
    // Un état conservé après un changement de prestation peut pointer sur une
    // date que la bande neuve ne contient pas. Chercher les voisins d'un jour
    // absent doit se taire, pas rendre les deux premiers de la liste.
    expect(joursProches(BANDE, '2027-01-01')).toEqual([]);
  });
});

describe('le jour sur lequel l’écran s’ouvre', () => {
  it('est le premier qui a de la place, pas le premier de la bande', () => {
    // Ouvrir sur un jour sans place demanderait un geste avant de voir quoi
    // que ce soit. Le montage commence par un jour fermé : sans la règle, on
    // ouvrirait dessus.
    const commenceFerme = [jour('2026-08-19', false, 0), ...BANDE.slice(1)];
    expect(premierJourUtile(commenceFerme)).toBe('2026-08-22');
  });

  it('et le premier de la bande quand aucun n’a de place', () => {
    // Il dira pourquoi. Rendre `null` laisserait l'écran sans jour choisi,
    // donc sans panneau, donc sans explication — le cas le plus muet.
    const tousPleins = [jour('2026-08-19', true, 0), jour('2026-08-20', false, 0)];
    expect(premierJourUtile(tousPleins)).toBe('2026-08-19');
  });

  it('et rien du tout sur une bande vide', () => {
    // Une bande vide ne dit pas « aucune place » : elle dit que la prestation
    // ne se propose plus. C'est l'état vide de l'écran, pas un jour à choisir.
    expect(premierJourUtile([])).toBeNull();
  });
});
