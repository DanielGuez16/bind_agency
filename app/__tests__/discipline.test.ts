/**
 * Garde-fou contre le défaut qui a rendu la CI rouge huit fois de suite.
 *
 * **@testing-library/react-native 14 a rendu `render` et `fireEvent`
 * asynchrones.** Toutes deux rendent une promesse, et l'arbre n'est à jour
 * qu'une fois celle-ci résolue. Les oublier ne fait pas échouer le test tout de
 * suite — `waitFor` réessaie — et la résolution finit presque toujours par
 * arriver à temps sur une machine peu chargée. Presque.
 *
 * C'est le pire profil de défaut : vert en local, rouge ailleurs, et rien dans
 * le message d'erreur qui pointe vers la cause. `render` a coûté huit
 * exécutions rouges ; `fireEvent` a été trouvé en écrivant l'écran de caisse,
 * où les requêtes ne trouvaient plus le champ qu'elles venaient de remplir ;
 * `renderHook` a été ajouté en écrivant le client d'API — même bibliothèque,
 * même signature, même piège.
 *
 * Ce test rend les deux impossibles à réintroduire sans le voir.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DOSSIER = __dirname;

//: Les appels asynchrones de la bibliothèque. Ajouter une entrée ici suffit à
//: étendre le garde-fou.
const ASYNCHRONES = ['render', 'renderHook', 'fireEvent(?:\\.\\w+)?'];

/**
 * Repère les appels dont **personne ne retient la promesse**.
 *
 * `await render(` et `return render(` sont corrects : le premier l'attend, le
 * second la rend à un appelant qui l'attendra. Tout le reste jette la promesse.
 *
 * **La première version n'inspectait que le début de ligne**, et laissait donc
 * passer la forme la plus courante de toutes : `const vue = render(…)`. Elle a
 * couvert le dépôt pendant des semaines avec un seul cas qui lui échappait, et
 * ce cas a fait échouer la suite deux fois sur cinq — assez pour rendre la CI
 * illisible, trop peu pour qu'on l'attribue à autre chose qu'au hasard.
 *
 * On cherche donc l'appel **où qu'il soit sur la ligne**, et on regarde ce qui
 * le précède immédiatement. Les lignes de commentaire sont écartées : elles
 * citent `render(` en prose, et les compter ferait crier le garde-fou sur sa
 * propre documentation.
 */
function lignesNonAttendues(source: string): string[] {
  // Le point négatif devant évite `objet.render(`. Trois façons de ne pas
  // perdre la promesse : l'attendre, la rendre, ou la rendre depuis une
  // fonction fléchée — `() => render(…)` la confie à son appelant, exactement
  // comme `return`.
  const appel = new RegExp(`(await\\s+|return\\s+|=>\\s+)?(?<![.\\w])(?:${ASYNCHRONES.join('|')})\\s*\\(`);

  return source
    .split('\n')
    .map((ligne, index) => ({ ligne: ligne.trim(), numero: index + 1 }))
    .filter(({ ligne }) => !ligne.startsWith('*') && !ligne.startsWith('//'))
    .map(({ ligne, numero }) => ({ trouve: appel.exec(ligne), ligne, numero }))
    .filter(({ trouve }) => trouve !== null && trouve[1] === undefined)
    .map(({ ligne, numero }) => `${numero}: ${ligne}`);
}

describe('discipline des tests de rendu', () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.tsx'));

  it('il y a bien des fichiers à inspecter', () => {
    // Sans cette assertion, un renommage de dossier rendrait le garde-fou vert
    // en n'inspectant plus rien.
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it('repère un appel dont la promesse est jetée', () => {
    // Le garde-fou éprouvé dans les deux sens : un test qui ne saurait rien
    // signaler passerait le cas nominal sans rien garantir.
    expect(lignesNonAttendues('  render(<Ecran />);')).toHaveLength(1);
    expect(lignesNonAttendues('  fireEvent.press(bouton);')).toHaveLength(1);
    expect(lignesNonAttendues('  fireEvent.changeText(champ, "x");')).toHaveLength(1);
    // La forme nue, qu'on emploie pour un événement sans raccourci —
    // `fireEvent(vue, 'layout', …)`. Elle échappait à la garde.
    expect(lignesNonAttendues("  fireEvent(vue, 'layout', charge);")).toHaveLength(1);

    // La forme qui échappait à la première version, et qui a coûté une CI
    // illisible : l'appel n'est plus en début de ligne, la promesse est
    // pourtant tout aussi perdue.
    expect(lignesNonAttendues('  const vue = render(<Ecran />);')).toHaveLength(1);
    expect(lignesNonAttendues('  const { rerender } = renderHook(useX);')).toHaveLength(1);

    expect(lignesNonAttendues('  await render(<Ecran />);')).toEqual([]);
    expect(lignesNonAttendues('  return render(<Ecran />);')).toEqual([]);
    expect(lignesNonAttendues('  const vue = await render(<Ecran />);')).toEqual([]);
    expect(lignesNonAttendues('  await fireEvent.press(bouton);')).toEqual([]);
    // Ni un commentaire qui cite l'appel, ni une méthode homonyme.
    expect(lignesNonAttendues('  // render(<Ecran />) est asynchrone')).toEqual([]);
    expect(lignesNonAttendues('  moteur.render(scene);')).toEqual([]);
    // La flèche confie la promesse à son appelant, comme `return`.
    expect(lignesNonAttendues('  await expect(() => render(<S />)).rejects.toThrow();')).toEqual(
      [],
    );
  });

  it.each(fichiers)('%s attend chaque appel asynchrone', (fichier) => {
    const source = readFileSync(join(DOSSIER, fichier), { encoding: 'utf-8' });

    expect(lignesNonAttendues(source)).toEqual([]);
  });
});

/**
 * Aucun émoji dans le produit.
 *
 * Ils vieillissent mal, se rendent différemment d'un appareil à l'autre, et
 * remplacent un mot par une devinette. La règle porte sur les pictogrammes —
 * les flèches typographiques d'un commentaire n'en sont pas.
 */
describe('aucun émoji', () => {
  const PICTOGRAMMES =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  function fichiers(dossier: string, trouves: string[] = []): string[] {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) fichiers(chemin, trouves);
      else if (/\.tsx?$/.test(entree.name)) trouves.push(chemin);
    }
    return trouves;
  }

  it('ni dans les catalogues de langue, ni dans les composants', () => {
    const fautifs: string[] = [];
    for (const chemin of fichiers(join(__dirname, '..', 'src'))) {
      readFileSync(chemin, 'utf-8')
        .split('\n')
        .forEach((ligne, index) => {
          const trouve = PICTOGRAMMES.exec(ligne);
          if (trouve) {
            fautifs.push(`${chemin.slice(chemin.indexOf('src/'))}:${index + 1} → ${trouve[0]}`);
          }
        });
    }
    expect(fautifs).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// aucune date brute
// --------------------------------------------------------------------------

/**
 * `toLocaleString` et ses variantes, hors de `format.ts`.
 *
 * Sans options, elles rendent « 11/08/2026 16:45:00 » : un mois en chiffres,
 * que la moitié du monde lit à l'envers, et des secondes sur un rendez-vous en
 * salon. C'était partout — sept endroits, chacun ayant reformaté à la main ce
 * que `format.ts` faisait déjà correctement.
 *
 * **La garde cherche la faute, pas la forme qui l'a introduite.** Les six
 * appels relevés s'écrivaient de trois façons — `new Date(x).toLocaleString()`,
 * `toLocaleString([], { timeZone })`, `toLocaleDateString()` — et une garde
 * calée sur la première les aurait laissé passer toutes les deux autres. On
 * cherche donc le **nom de la méthode**, où qu'il soit sur la ligne et quels
 * que soient ses arguments.
 *
 * `format.ts` est le seul endroit qui a le droit de les appeler, et il ne les
 * appelle pas nus : `Intl.DateTimeFormat` y porte `dateStyle`, `timeStyle` et
 * `timeZone`. `toLocaleDateString('en-CA', …)` dans `CreneauxScreen` est une
 * **clé de regroupement**, jamais un affichage — d'où sa tolérance, nommée.
 */
describe('aucune date brute', () => {
  const METHODES = /\.toLocale(?:Date|Time)?String\s*\(/;

  //: Les usages légitimes, avec leur raison. Liste courte : c'est elle qu'on
  //: relit quand la garde tombe.
  const TOLERES = new Set([
    // La maison du formatage. Elle n'appelle rien nu.
    'src/format.ts',
    // Une clé de regroupement par jour, en ISO, jamais affichée.
    'src/screens/CreneauxScreen.tsx',
  ]);

  function fichiersSource(dossier: string, trouves: string[] = []): string[] {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) fichiersSource(chemin, trouves);
      else if (/\.tsx?$/.test(entree.name)) trouves.push(chemin);
    }
    return trouves;
  }

  it('formate par `format.ts`, et nulle part à la main', () => {
    const fautifs: string[] = [];
    for (const chemin of fichiersSource(join(__dirname, '..', 'src'))) {
      const relatif = chemin.slice(chemin.indexOf('src/'));
      if (TOLERES.has(relatif)) continue;
      readFileSync(chemin, 'utf-8')
        .split('\n')
        .forEach((ligne, index) => {
          // Les commentaires citent ces noms en prose ; les compter ferait
          // crier la garde sur sa propre documentation.
          if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
          if (METHODES.test(ligne)) fautifs.push(`${relatif}:${index + 1}`);
        });
    }

    expect(fautifs).toEqual([]);
  });

  it('attrape les trois formes, pas seulement celle qu’on avait en tête', () => {
    // Les six appels relevés s'écrivaient de trois façons. Une garde calée sur
    // la première en aurait laissé passer deux — et une garde partielle fait
    // croire que la question est réglée.
    const formes = [
      "  return new Date(x).toLocaleString();",
      "  return new Date(x).toLocaleString([], { timeZone: tz });",
      "  const j = new Date(x).toLocaleDateString();",
      "  label: new Date(x).toLocaleTimeString(locale, { hour: '2-digit' }),",
      "  valeur: n.toLocaleString(locale),",
    ];
    for (const forme of formes) expect(METHODES.test(forme)).toBe(true);

    // Et rien d'autre : une garde qui crie sur tout se désactive au bout d'une
    // semaine.
    for (const innocent of ['  const s = String(x);', '  toLocale(x);', '  // toLocaleString()']) {
      expect(METHODES.test(innocent) && !/^\s*\/\//.test(innocent)).toBe(false);
    }
  });

  it('a bien des fichiers à inspecter', () => {
    // Sans cela, un dossier déplacé rendrait la garde verte en ne lisant rien.
    expect(fichiersSource(join(__dirname, '..', 'src')).length).toBeGreaterThan(30);
  });

  it('tolère uniquement des fichiers qui existent encore', () => {
    for (const relatif of TOLERES) {
      expect(readFileSync(join(__dirname, '..', relatif), 'utf-8')).toBeTruthy();
    }
  });
});
