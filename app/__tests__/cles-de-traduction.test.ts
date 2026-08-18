/**
 * Toute clé appelée existe, dans les deux langues.
 *
 * **La garde de parité ne suffisait pas, et c'est une garde partielle
 * classique.** Elle compare les deux catalogues **l'un à l'autre** : elle
 * attrape une clé traduite d'un seul côté, et laisse passer une clé qui manque
 * des deux. Elle n'a jamais regardé les **appels**.
 *
 * Le défaut s'est produit deux fois dans la même journée. Six clés du cadre 11c
 * ont atterri dans le domaine `parcours` quand l'écran les lisait sous `tiers` :
 * parité intacte, catalogues d'accord, et l'écran affichait
 * `[missing "en.tiers.prestationsOuvertes" translation]` — en clair, à la place
 * du titre. Rien ne l'a signalé ; c'est une assertion de texte dans un test
 * d'écran qui l'a trouvé, par accident.
 *
 * **La clé se résout par son chemin entier, jamais par sa feuille.** Chercher
 * `prestationsOuvertes` quelque part dans le catalogue aurait trouvé celle de
 * `parcours` et déclaré la garde satisfaite — c'est-à-dire reproduit exactement
 * le défaut qu'elle prétend interdire. Les catalogues sont donc importés et
 * parcourus, pas lus au motif.
 *
 * **Les clés composées sont hors de portée**, et elles sont dénombrées plutôt
 * que passées sous silence : `t(`quartiers.${q}`)` ne se résout pas sans
 * exécuter le code. Leurs domaines sont couverts ailleurs — les quartiers et
 * les catégories ont leur propre garde, qui recopie la liste à la main depuis
 * l'union TypeScript pour en faire un oracle.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';

const SRC = join(__dirname, '..', 'src');

/** Toutes les sources, la coquille et les écrans compris. */
function sources(): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (/\.tsx?$/.test(entree)) trouves.push(readFileSync(chemin, 'utf-8'));
    }
  };
  parcourir(SRC);
  return trouves;
}

/** Les clés littérales appelées, et le compte de celles qui se composent. */
function appels(): { litterales: string[]; composees: number } {
  const litterales = new Set<string>();
  let composees = 0;
  for (const source of sources()) {
    for (const [, cle] of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) litterales.add(cle);
    composees += [...source.matchAll(/\bt\(\s*`/g)].length;
  }
  return { litterales: [...litterales].sort(), composees };
}

/** La valeur au bout du chemin, ou `undefined`. Jamais la feuille seule. */
function resoudre(catalogue: unknown, cle: string): unknown {
  return cle
    .split('.')
    .reduce<unknown>(
      (noeud, part) => (noeud as Record<string, unknown> | undefined)?.[part],
      catalogue,
    );
}

describe('les clés de traduction', () => {
  const { litterales, composees } = appels();

  it('la garde regarde bien quelque chose', async () => {
    // L'assertion de volume : le jour où la forme des appels change, la lecture
    // rendrait une liste vide et le test passerait sans rien inspecter.
    expect(litterales.length).toBeGreaterThan(400);
  });

  it('chaque clé appelée existe en anglais', async () => {
    const absentes = litterales.filter((cle) => typeof resoudre(en, cle) !== 'string');
    expect(absentes).toEqual([]);
  });

  it('et en espagnol', async () => {
    // Le sens inverse de la parité : une clé peut exister d'un seul côté, et
    // c'est la langue qu'on ne relit pas qui en souffre.
    const absentes = litterales.filter((cle) => typeof resoudre(es, cle) !== 'string');
    expect(absentes).toEqual([]);
  });

  it('et les clés composées restent comptées, pas oubliées', async () => {
    // Elles ne se résolvent pas sans exécuter le code. Les dénombrer force à
    // constater leur nombre plutôt qu'à ignorer leur existence : si elles se
    // multipliaient, la garde couvrirait de moins en moins sans le dire.
    expect(composees).toBeLessThan(40);
  });
});
