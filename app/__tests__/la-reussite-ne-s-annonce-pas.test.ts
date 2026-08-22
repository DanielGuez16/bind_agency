/**
 * La réussite ne s'annonce pas : le résultat qui apparaît **est** la
 * confirmation.
 *
 * **C'est une règle qui retire, donc elle se défait toute seule.** Le produit
 * la respecte aujourd'hui — aucun bandeau vert, aucune coche qui pulse, et
 * `StatusMessage` n'a même pas de niveau `success`. Rien ne l'empêche de
 * revenir : une règle écrite dans une note de composant est une intention, et
 * une intention ne survit pas à la personne qui l'a écrite. Cette garde est
 * donc toute la tranche — il n'y avait rien à supprimer, il y avait quelque
 * chose à tenir.
 *
 * **Elle lit les mots, comme celle de l'annulation.** Un bandeau de réussite
 * ne se distingue pas structurellement d'un bandeau d'erreur : même composant,
 * même place, même forme. Ce qui le trahit est sa phrase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';

/**
 * Les formes d'une confirmation, et non l'exemple qui a motivé la règle.
 *
 * Une garde qui ne chercherait que « Success » laisserait passer « Saved! »,
 * « Your changes have been saved » et « You're all set » — trois façons
 * d'écrire la même faute. Le garde-fou des rendus asynchrones n'a rien vu
 * pendant des semaines pour avoir cherché une seule forme.
 */
const CONFIRMATIONS: { nom: string; motif: RegExp }[] = [
  { nom: 'la réussite nue', motif: /\b(success|successful|successfully)\b/i },
  { nom: 'le point d’exclamation de joie', motif: /\b(done|saved|sent|updated|created|added)\s*!/i },
  { nom: 'les félicitations', motif: /\b(well done|nice work|great job|all set)\b/i },
  {
    nom: 'le passé composé de confirmation',
    motif: /\b(has been|have been)\s+(saved|sent|updated|created|added|recorded)\b/i,
  },
  { nom: 'les changements enregistrés', motif: /\bchanges (were |have been )?saved\b/i },
  { nom: 'l’équivalent espagnol', motif: /\b(guardado con éxito|hecho!|listo!|éxito)\b/i },
];

/** Toutes les chaînes d'un dictionnaire, chemin compris pour nommer la fautive. */
function phrases(bloc: unknown, chemin = ''): string[] {
  if (typeof bloc === 'string') return [`${chemin} = ${bloc}`];
  if (bloc && typeof bloc === 'object') {
    return Object.entries(bloc).flatMap(([cle, valeur]) =>
      phrases(valeur, chemin ? `${chemin}.${cle}` : cle),
    );
  }
  return [];
}

describe('la réussite ne s’annonce pas', () => {
  it.each([
    ['en', en],
    ['es', es],
  ])('aucune phrase de confirmation en %s', (_langue, dictionnaire) => {
    const toutes = phrases(dictionnaire);
    const fautives = toutes.filter((phrase) =>
      CONFIRMATIONS.some(({ motif }) => motif.test(phrase)),
    );
    expect(fautives).toEqual([]);
  });

  it('la garde regarde bien quelque chose', () => {
    // Sans ceci, un dictionnaire vidé par un renommage passerait au vert en
    // n'ayant rien lu. Quatre fois sur ce projet un test est passé sans rien
    // vérifier.
    expect(phrases(en).length).toBeGreaterThan(500);
    expect(phrases(es).length).toBeGreaterThan(500);
  });

  it.each(CONFIRMATIONS.map((c) => [c.nom, c.motif] as const))(
    'et elle attrape %s',
    (_nom, motif) => {
      const exemples: Record<string, string> = {
        'la réussite nue': 'x = Booking created successfully',
        'le point d’exclamation de joie': 'x = Saved!',
        'les félicitations': 'x = Nice work, you are all set',
        'le passé composé de confirmation': 'x = Your photo has been added',
        'les changements enregistrés': 'x = Changes saved',
        'l’équivalent espagnol': 'x = Guardado con éxito',
      };
      const exemple = Object.entries(exemples).find(([nom]) => CONFIRMATIONS.some(
        (c) => c.nom === nom && c.motif === motif,
      ));
      expect(exemple).toBeTruthy();
      expect(motif.test(exemple![1])).toBe(true);
    },
  );

  it('mais laisse passer ce qui décrit un état, pas une félicitation', () => {
    // « Honoured » sur une réservation tenue est un **résultat**, pas une
    // confirmation d'action : il reste affiché pour toujours et ne suit aucun
    // appui. La distinction est ce qui empêche cette garde de devenir une
    // chasse au vocabulaire.
    const innocentes = [
      'parcours.issueHonoree = Honoured',
      'commerce.repriseRefermee = Closed 12 Aug',
      'terrain.etat.claimed = Activated',
      'composition.archivee = Archived. Still readable from the bookings that cite it.',
    ];
    for (const phrase of innocentes) {
      expect({ phrase, prise: CONFIRMATIONS.some(({ motif }) => motif.test(phrase)) }).toEqual({
        phrase,
        prise: false,
      });
    }
  });

  it('et `StatusMessage` n’a toujours pas de niveau de réussite', () => {
    // La règle vit aussi dans le type : il n'y a aucun moyen de rendre un
    // bandeau vert, parce qu'il n'y a pas de valeur pour le demander.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'components', 'StatusMessage.tsx'),
      'utf-8',
    );
    const union = /export type Niveau = ([^;]+);/.exec(source)?.[1];
    expect(union).toBeTruthy();
    expect(union!.replace(/\s/g, '').split('|').sort()).toEqual([
      "'danger'",
      "'neutral'",
      "'warning'",
    ]);
  });
});
