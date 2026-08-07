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
const ASYNCHRONES = ['render', 'renderHook', 'fireEvent\\.\\w+'];

/**
 * Repère les appels dont **personne ne retient la promesse**.
 *
 * `await render(` et `return render(` sont corrects : le premier l'attend, le
 * second la rend à un appelant qui l'attendra. Ce qui ne l'est pas, c'est un
 * appel en début d'instruction — la promesse est créée puis jetée.
 */
function lignesNonAttendues(source: string): string[] {
  const debut = new RegExp(`^(?:${ASYNCHRONES.join('|')})\\s*\\(`);

  return source
    .split('\n')
    .map((ligne, index) => ({ ligne: ligne.trim(), numero: index + 1 }))
    .filter(({ ligne }) => debut.test(ligne))
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

    expect(lignesNonAttendues('  await render(<Ecran />);')).toEqual([]);
    expect(lignesNonAttendues('  return render(<Ecran />);')).toEqual([]);
    expect(lignesNonAttendues('  await fireEvent.press(bouton);')).toEqual([]);
  });

  it.each(fichiers)('%s attend chaque appel asynchrone', (fichier) => {
    const source = readFileSync(join(DOSSIER, fichier), { encoding: 'utf-8' });

    expect(lignesNonAttendues(source)).toEqual([]);
  });
});
