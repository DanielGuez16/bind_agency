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
import { size } from '../src/theme';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = join(__dirname, '..', '..');
const PRIMITIVES = JSON.parse(
  readFileSync(join(RACINE, 'design_handoff_bind', 'assets', 'primitives.json'), 'utf-8'),
) as Record<string, { d?: string | string[] }>;

const SOURCE = readFileSync(join(RACINE, 'app', 'src', 'components', 'Icone.tsx'), 'utf-8');

/**
 * Les rotations déclarées par le produit, en degrés.
 *
 * **Le champ `transform` fait partie du glyphe**, et ne pas le lire est la
 * façon exacte dont cette garde a laissé passer un défaut le jour où elle est
 * née : `retour` est « la flèche de l'avancée, retournée », donc son tracé est
 * celui de `fleche` et c'est la rotation qui fait la différence. Copié sans
 * elle, le retour pointait à droite sur tout le produit — et la comparaison des
 * seuls tracés restait verte.
 */
function rotationsDuProduit(): Record<string, number> {
  const bloc = /const ROTATION[^=]*=\s*\{([^}]*)\}/s.exec(SOURCE);
  if (!bloc) return {};
  return Object.fromEntries(
    [...bloc[1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
  );
}

/**
 * Les épaisseurs propres déclarées par le produit.
 *
 * Lues dans la source pour la même raison que les rotations : c'est ce que le
 * produit **dessine** qu'on veut comparer, et un tableau recopié dans le test
 * dirait seulement que je sais recopier.
 */
function epaisseursDuProduit(): Record<string, number> {
  const bloc = /const EPAISSEUR[^=]*=\s*\{([^}]*)\}/s.exec(SOURCE);
  if (!bloc) return {};
  return Object.fromEntries(
    [...bloc[1].matchAll(/(\w+):\s*([\d.]+)/g)].map((m) => [m[1], Number(m[2])]),
  );
}

/** Les degrés que la primitive prescrit, ou zéro. */
function rotationAttendue(clef: string): number {
  const brut = (PRIMITIVES[clef] as { transform?: string }).transform;
  const degres = brut ? /rotate\((-?\d+)/.exec(brut) : null;
  return degres ? Number(degres[1]) : 0;
}

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

  it.each(CORRESPONDANCE)('%s tourne comme sa primitive le dit', (nom, clef) => {
    // **L'autre moitié du glyphe.** Deux tracés identiques et une rotation qui
    // diffère font deux glyphes différents — c'est le cas de `fleche` et
    // `retour`, dont le `d` est le même.
    expect(rotationsDuProduit()[nom] ?? 0).toBe(rotationAttendue(clef));
  });

  it('le trait et le cadre sont ceux des primitives, pour tous', () => {
    /**
     * **Une garde qui ne compare qu'un champ n'éprouve que ce champ.**
     *
     * C'est la leçon du retour, et elle vaut au-delà de lui : la primitive
     * porte `d`, `transform`, `strokeWidth` et `viewBox`, et deux glyphes
     * peuvent partager le tracé en différant sur le reste. Les comparer tous
     * coûte ces quelques lignes et ferme la famille entière.
     *
     * Le trait et le cadre sont communs — `size.iconStroke` sur une grille de
     * 24 — donc ils se vérifient une fois pour toutes plutôt que par glyphe.
     */
    // Le cadre est commun à tout le jeu — c'est ce qui rend les tracés
    // interchangeables — donc il se vérifie pour tous.
    for (const [, clef] of CORRESPONDANCE) {
      const p = PRIMITIVES[clef] as { viewBox?: string };
      expect({ clef, cadre: p.viewBox }).toEqual({ clef, cadre: '0 0 24 24' });
    }
    expect(SOURCE).toContain('viewBox="0 0 24 24"');

    // L'épaisseur, elle, ne l'est pas : la coche est à 2,4 avec sa raison
    // écrite. Le produit doit donc rendre CE trait-là, glyphe par glyphe.
    const rendu = Object.fromEntries(
      CORRESPONDANCE.map(([nom]) => [nom, epaisseursDuProduit()[nom] ?? size.iconStroke]),
    );
    const voulu = Object.fromEntries(
      CORRESPONDANCE.map(([nom, clef]) => [
        nom,
        (PRIMITIVES[clef] as { strokeWidth?: number }).strokeWidth,
      ]),
    );
    expect(rendu).toEqual(voulu);
  });

  it('et au moins un glyphe tourne, sinon la garde ne compare rien', () => {
    // Sans ce compte, une table de rotations vide passerait les cas ci-dessus
    // pour tout glyphe dont la primitive n'en porte pas — c'est-à-dire presque
    // tous, ce qui rendrait la comparaison verte à vide.
    expect(Object.keys(rotationsDuProduit()).length).toBeGreaterThan(0);
    expect(rotationAttendue('retour')).toBe(180);
  });
});
