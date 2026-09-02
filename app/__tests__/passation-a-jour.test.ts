/**
 * La passation nomme des jetons qui existent.
 *
 * **Un document juste que rien ne confronte au produit cesse d'être juste, et
 * personne ne le voit.** La section 1 de `rules.md` a décrit pendant des
 * semaines une bascule clair/sombre retirée depuis, en nommant six jetons —
 * `bg.raised`, `role.merchant`, `accent.default`, `badge.scrim`,
 * `media.placeholderStripe`, `elevation.1` — dont aucun n'existait. La section 5
 * en nommait trois autres. La section 8 annonçait une largeur que `tokens.json`
 * contredisait depuis la v1.1.
 *
 * Rien ne pouvait le dire : un document ne se compile pas. Et le coût n'est pas
 * l'erreur elle-même, c'est ce qu'elle apprend — **on cesse de lire un document
 * dont une section sur huit est fausse**, et on cesse de le lire *en entier*,
 * y compris les sept sections vraies. C'est le mécanisme qui a coûté trois
 * campagnes à l'audience, une couche plus haut.
 *
 * Cette garde ne lit pas la prose : elle ne juge ni le sens ni la justesse d'une
 * règle. Elle vérifie la seule chose qu'une machine sache vérifier ici — que
 * **tout nom de jeton cité entre accents graves désigne un jeton livré**. C'est
 * ce qui aurait attrapé neuf des dix cas ci-dessus.
 *
 * **Elle ne regarde que les documents courants.** Les fichiers `-v1.0`
 * enregistrent un état passé : leur demander d'être vrais aujourd'hui n'aurait
 * pas de sens, et les corriger serait un mensonge d'un autre genre.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const RACINE = join(__dirname, '..', '..');
const PASSATION = join(RACINE, 'design_handoff_bind');

/** Les documents que la passation tient à jour. Les `-v1.0` sont des archives. */
const COURANTS = ['rules.md', 'components.md', 'PASSATION-v1.1.md'];

/**
 * Les familles qui ouvrent un chemin de jeton.
 *
 * **La liste est fermée, et c'est ce qui rend la garde sûre.** Un document parle
 * aussi de `flexWrap`, de `expo-keep-awake` et de `useWindowDimensions` : sans
 * cette liste, la garde réclamerait un jeton pour chacun et deviendrait du bruit
 * qu'on apprend à ignorer — le défaut même qu'elle combat.
 */
const FAMILLES = [
  'color', 'brand', 'bg', 'ink', 'line', 'status', 'scrim',
  'radius', 'type', 'size', 'elevation', 'satin', 'breakpoint', 'logo',
  'motion', 'space', 'font', 'code', 'tier', 'badge', 'density', 'marque',
];

function chemins(objet: unknown, prefixe = ''): Set<string> {
  const trouves = new Set<string>();
  if (objet === null || typeof objet !== 'object') return trouves;
  for (const [cle, valeur] of Object.entries(objet as Record<string, unknown>)) {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    trouves.add(chemin);
    for (const sous of chemins(valeur, chemin)) trouves.add(sous);
  }
  return trouves;
}

/** Tout ce que le produit livre, les deux couches confondues. */
function jetonsLivres(): Set<string> {
  const socle = JSON.parse(
    readFileSync(join(RACINE, 'app', 'src', 'theme', 'tokens.json'), 'utf-8'),
  );
  const produit = JSON.parse(
    readFileSync(join(RACINE, 'app', 'src', 'theme', 'produit.json'), 'utf-8'),
  );

  const tous = new Set<string>([...chemins(socle), ...chemins(produit)]);

  // **Les deux couches se citent sans leur préfixe commun.** `tokens.json` range
  // les couleurs sous `color.`, et un document écrit `ink.mute` : les deux
  // désignent la même chose. Sans ce dépliage, la garde crierait sur des noms
  // parfaitement justes, ce qui est pire que se taire.
  for (const chemin of [...tous]) {
    const point = chemin.indexOf('.');
    if (point > 0) tous.add(chemin.slice(point + 1));
  }
  return tous;
}

/**
 * Le document, **moins la table des retraits**.
 *
 * **Une section dont le rôle est de nommer ce qui n'existe plus.** « 13 sexies.
 * Retiré » liste un retrait par ligne avec la version qui l'a décidé, et deux
 * de ces lignes sont des jetons supprimés — `size.listRow`, `userOverride`. Les
 * citer y est le sujet, pas une erreur : la garde y crierait sur la seule
 * section qui a le droit de les nommer.
 *
 * **La coupe s'arrête au titre suivant**, et non à la fin du fichier : une
 * exclusion qui déborderait avalerait le reste du document, et la garde
 * passerait au vert en n'inspectant plus rien. Le cas ci-dessous l'éprouve.
 */
export function horsTableDesRetraits(source: string): string {
  const debut = source.indexOf('## 13 sexies. Retiré');
  if (debut === -1) return source;
  const suivant = source.indexOf('\n## ', debut + 1);
  return suivant === -1 ? source.slice(0, debut) : source.slice(0, debut) + source.slice(suivant);
}

/** Les noms de jeton qu'un document cite entre accents graves. */
function jetonsCites(source: string): string[] {
  const cites = [...source.matchAll(/`([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)`/g)].map(
    (m) => m[1],
  );
  return cites.filter((nom) => FAMILLES.includes(nom.split('.')[0]));
}

describe('la passation nomme des jetons qui existent', () => {
  const livres = jetonsLivres();

  it.each(COURANTS)('%s ne cite aucun jeton disparu', (fichier) => {
    const source = horsTableDesRetraits(readFileSync(join(PASSATION, fichier), 'utf-8'));

    const fantomes = [...new Set(jetonsCites(source))].filter((nom) => !livres.has(nom));

    expect(fantomes.sort()).toEqual([]);
  });

  it('et elle en cite, sans quoi la garde ne garderait rien', () => {
    // **Le sens inverse.** « Aucun jeton disparu » est vrai d'un document qui
    // n'en cite aucun, et le serait aussi le jour où l'expression cesse de
    // reconnaître la forme d'un chemin de jeton : la garde passerait au vert en
    // ayant cessé de regarder. C'est exactement ce qui vient d'arriver à une
    // autre garde, dont la famille de fontes ressortait vide.
    const cites = COURANTS.flatMap((fichier) =>
      jetonsCites(readFileSync(join(PASSATION, fichier), 'utf-8')),
    );

    expect(cites.length).toBeGreaterThan(20);
  });

  it('et un jeton disparu se voit', () => {
    // La garde éprouvée sur la forme qu'elle doit attraper, plutôt que sur les
    // documents du jour : ceux-ci sont justes, et un test qui ne lit que du
    // juste ne prouve pas qu'il sait reconnaître le faux.
    const fantomes = jetonsCites('Le fond passe en `bg.raised` avec `elevation.1`.').filter(
      (nom) => !livres.has(nom),
    );

    expect(fantomes.sort()).toEqual(['bg.raised', 'elevation.1']);
  });

  it('et un nom qui n’en est pas un ne réveille personne', () => {
    // `flexWrap` n'a pas de point ; `expo-keep-awake` n'ouvre aucune famille.
    // Une garde qui crierait dessus ferait apprendre à ignorer son rouge.
    expect(jetonsCites('Les chips sont en `flexWrap`, et l’écran garde `expo-keep-awake`.')).toEqual(
      [],
    );
  });
});

describe('la table des retraits est écartée, et elle seule', () => {
  const DOC = [
    '## 13 sexies. Retiré',
    '| `size.listRow` | v1.1 | Deux jetons pour la même hauteur. |',
    '',
    '## 14. Interdits, inchangés',
    'Le focus reste `line.fantome`.',
    '',
  ].join('\n');

  it('laisse passer un jeton mort cité comme retiré', () => {
    expect(horsTableDesRetraits(DOC)).not.toContain('size.listRow');
  });

  it('et garde tout ce qui suit, sinon elle n’inspecterait plus rien', () => {
    // **Le sens qui compte.** Une coupe qui irait jusqu'à la fin du fichier
    // ferait passer la garde au vert en vidant ce qu'elle lit — le mode d'échec
    // que ce dépôt a déjà rencontré ailleurs, et qu'aucune relecture n'attrape.
    expect(horsTableDesRetraits(DOC)).toContain('line.fantome');
  });
});
