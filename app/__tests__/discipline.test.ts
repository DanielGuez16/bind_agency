/**
 * Garde-fou contre le défaut qui a rendu la CI rouge huit fois de suite.
 *
 * `render` est **asynchrone** depuis @testing-library/react-native 14 : elle
 * rend une promesse, et `screen` n'est peuplé qu'une fois celle-ci résolue.
 * L'oublier ne fait pas échouer le test tout de suite — `waitFor` réessaie — et
 * la résolution finit presque toujours par arriver à temps sur une machine peu
 * chargée. Presque. En intégration continue, elle n'arrivait jamais à temps.
 *
 * C'est le pire profil de défaut : vert en local, rouge ailleurs, et rien dans
 * le message d'erreur qui pointe vers la cause. Ce test le rend impossible à
 * réintroduire sans le voir.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DOSSIER = __dirname;

/**
 * Repère les appels dont **personne ne retient la promesse**.
 *
 * `await render(` et `return render(` sont corrects : le premier l'attend, le
 * second la rend à un appelant qui l'attendra. Ce qui ne l'est pas, c'est
 * `render(` en début d'instruction — la promesse est créée puis jetée.
 */
function lignesAvecRenderNonAttendu(source: string): string[] {
  return source
    .split('\n')
    .map((ligne, index) => ({ ligne: ligne.trim(), numero: index + 1 }))
    .filter(({ ligne }) => /^render\s*\(/.test(ligne))
    .map(({ ligne, numero }) => `${numero}: ${ligne}`);
}

describe('discipline des tests de rendu', () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.tsx'));

  it('il y a bien des fichiers à inspecter', () => {
    // Sans cette assertion, un renommage de dossier rendrait le garde-fou vert
    // en n'inspectant plus rien.
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it('repère un render dont la promesse est jetée', () => {
    // Le garde-fou éprouvé dans les deux sens : un test qui ne saurait rien
    // signaler passerait le cas nominal sans rien garantir.
    expect(lignesAvecRenderNonAttendu('  render(<Ecran />);')).toHaveLength(1);
    expect(lignesAvecRenderNonAttendu('  await render(<Ecran />);')).toEqual([]);
    expect(lignesAvecRenderNonAttendu('  return render(<Ecran />);')).toEqual([]);
  });

  it.each(fichiers)('%s attend chaque render', (fichier) => {
    const source = readFileSync(join(DOSSIER, fichier), { encoding: 'utf-8' });

    expect(lignesAvecRenderNonAttendu(source)).toEqual([]);
  });
});
