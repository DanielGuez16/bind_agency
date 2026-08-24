/**
 * `TASKS.md` ne porte pas deux fois la même entrée.
 *
 * **C'est le canal entre quatre conversations**, et c'est ce qui rend un
 * doublon coûteux : une copie décochée d'une décision prise fait **refaire un
 * arbitrage déjà rendu**. Ce n'est pas un défaut de tenue, c'est du travail
 * perdu — et il s'est produit deux fois, dont une qui a coûté une demi-heure à
 * rouvrir la règle des sept jours, tranchée depuis des jours.
 *
 * **La cause est connue et la règle qui la produit est bonne.** Un conflit sur
 * ce fichier se résout en gardant les deux côtés : deux sessions y ajoutent des
 * lignes différentes, et une demande effacée ne revient pas. Mais quand les
 * deux côtés portent *la même* entrée à deux stades — le problème posé, puis la
 * décision rendue — garder les deux laisse la version périmée sous sa
 * remplaçante, et c'est celle-là qu'on lit.
 *
 * **La garde lit les titres, pas les corps.** Deux entrées peuvent partager un
 * paragraphe sans être la même chose ; ce qui les identifie est ce qu'elles
 * annoncent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TASKS = readFileSync(join(__dirname, '..', '..', 'TASKS.md'), 'utf-8');

type Entree = { ligne: number; etat: string; titre: string; cle: string };

/**
 * Le titre, ramené à ce qui l'identifie.
 *
 * **Les chiffres restent.** « Capture de preuve niveau 1 » et « niveau 2 » sont
 * deux tâches ; les effacer les rendrait identiques, et la garde crierait au
 * loup sur une paire légitime — ce qui apprend à ignorer le rouge.
 *
 * La queue après un tiret cadratin part : c'est là que vit « — tranché », qui
 * marque précisément la version qui remplace l'autre.
 */
function cle(titre: string): string {
  return titre
    .toLowerCase()
    .replace(/\s*—.*$/, '')
    .replace(/[^0-9a-zà-ÿ`]+/g, ' ')
    .trim();
}

function entrees(): Entree[] {
  return TASKS.split('\n').flatMap((ligne, rang) => {
    const trouve = /^- \[([ x])\] (?:\*\*)?(.+?)(?:\*\*)?$/.exec(ligne);
    if (!trouve) return [];
    return [{ ligne: rang + 1, etat: trouve[1], titre: trouve[2], cle: cle(trouve[2]) }];
  });
}

/** Deux chaînes se ressemblent-elles au-delà du seuil ? */
function ressemblance(a: string, b: string): number {
  // **Les chiffres comptent, si courts soient-ils.** « niveau 1 » et
  // « niveau 2 » ne se distinguent que par un caractère : un filtre de
  // longueur les rendrait identiques, et la garde crierait au loup sur une
  // paire légitime. Les mots courts partent, les nombres restent.
  const mots = (t: string) =>
    new Set(t.split(' ').filter((m) => m.length > 2 || /^[0-9]+$/.test(m)));
  const ma = mots(a);
  const mb = mots(b);
  if (ma.size === 0 || mb.size === 0) return 0;
  const communs = [...ma].filter((m) => mb.has(m)).length;
  // Jaccard : deux titres qui partagent tous leurs mots utiles sont la même
  // entrée, quel que soit l'ordre ou la ponctuation.
  return communs / (ma.size + mb.size - communs);
}

describe('TASKS.md ne dit pas deux fois la même chose', () => {
  it('la garde regarde bien quelque chose', () => {
    // Sans ceci, une expression qui ne trouve plus d'entrée passerait au vert
    // en n'ayant rien lu.
    expect(entrees().length).toBeGreaterThan(200);
  });

  it('aucune entrée n’a de jumelle', () => {
    const liste = entrees();
    const jumelles: string[] = [];

    for (let a = 0; a < liste.length; a += 1) {
      for (let b = a + 1; b < liste.length; b += 1) {
        if (ressemblance(liste[a].cle, liste[b].cle) < 0.9) continue;
        jumelles.push(
          `TASKS.md:${liste[a].ligne} « ${liste[a].titre} » ` +
            `≈ TASKS.md:${liste[b].ligne} « ${liste[b].titre} »`,
        );
      }
    }

    expect(jumelles).toEqual([]);
  });

  it('et elle attrape la forme qui a coûté : la version périmée sous la tranchée', () => {
    // L'exemple réel, tel qu'il était dans le fichier.
    const perimee = cle('Le bandeau ne devient pas une ligne de confirmation');
    const tranchee = cle('Le bandeau ne devient pas une ligne de confirmation — tranché');
    expect(ressemblance(perimee, tranchee)).toBeGreaterThanOrEqual(0.9);
  });

  it('mais laisse passer deux tâches que seul un mot distingue', () => {
    // Trois paires légitimes du fichier. Une garde qui les prendrait pour des
    // doublons apprendrait à ignorer le rouge, ce qui est pire qu'aucune garde.
    const legitimes: [string, string][] = [
      ['Capture de preuve niveau 1', 'Capture de preuve niveau 2'],
      ['Garde de durée côté jest', 'Garde de durée côté python'],
      ['Bloc écrans créateur', 'Bloc écrans commerce'],
    ];
    for (const [a, b] of legitimes) {
      expect({ a, b, prise: ressemblance(cle(a), cle(b)) >= 0.9 }).toEqual({
        a,
        b,
        prise: false,
      });
    }
  });
});
