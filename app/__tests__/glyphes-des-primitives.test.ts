/**
 * Les glyphes viennent du fichier de primitives, ils ne sont pas retapés.
 *
 * **`assets/primitives.json` est la source depuis la v13**, et c'est la
 * première planche composée en les lisant. Un tracé recomposé de mémoire dérive
 * d'un dixième de point à chaque passage : quatre des huit glyphes du produit
 * avaient déjà dérivé — le cœur, la coche, le retour, et les deux chemins de
 * TikTok soudés en un seul.
 *
 * **La garde compare la géométrie, pas la ressemblance.** Un écart d'un
 * centième ne se voit sur aucun écran et se voit ici, ce qui est exactement le
 * partage qu'on veut : l'œil ne peut pas tenir cette règle, une comparaison si.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = join(__dirname, '..', '..');
const PRIMITIVES = JSON.parse(
  readFileSync(join(RACINE, 'design_handoff_bind', 'assets', 'primitives.json'), 'utf-8'),
) as Record<string, { d?: string | string[] }>;

const SOURCE = readFileSync(join(RACINE, 'app', 'src', 'components', 'Icone.tsx'), 'utf-8');

/** Le nom du glyphe dans le produit, et sa clé dans les primitives. */
const CORRESPONDANCE: [string, string][] = [
  ['chevron', 'chevron'],
  ['sortie', 'sortie'],
  ['tiktok', 'tiktok'],
  ['coeur', 'coeurVide'],
  ['horloge', 'horloge'],
  ['coche', 'coche'],
  ['retour', 'retour'],
  ['fleche', 'fleche'],
];

/** Les tracés déclarés par `Icone.tsx`, par nom. */
function tracesDuProduit(): Record<string, string> {
  return Object.fromEntries(
    [...SOURCE.matchAll(/^ {2}(\w+):\s+'([^']+)',/gm)].map((m) => [m[1], m[2]]),
  );
}

describe('les glyphes sont copiés, jamais retapés', () => {
  const produit = tracesDuProduit();

  it('la garde regarde bien quelque chose', () => {
    // **L'assertion de volume.** Le jour où `Icone.tsx` change de forme, la
    // lecture rend une table vide et la garde passe au vert en n'inspectant
    // rien — c'est arrivé deux fois sur ce dépôt.
    expect(Object.keys(produit).length).toBeGreaterThan(8);
    expect(CORRESPONDANCE.length).toBeGreaterThan(5);
  });

  it.each(CORRESPONDANCE)('%s est celui des primitives', (nom, clef) => {
    const declare = PRIMITIVES[clef]?.d;
    // Les primitives à plusieurs éléments — Instagram — ne portent pas de `d`
    // et ne se comparent pas ainsi : elles ne sont pas dans la table.
    expect(declare).toBeDefined();
    const attendu = Array.isArray(declare) ? declare.join(' ') : declare;

    expect(produit[nom]).toBe(attendu);
  });
});
