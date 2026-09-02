/**
 * Le dépôt ne suit aucun lien symbolique.
 *
 * **Ce n'est pas une règle de style, c'est un incident.** `app/node_modules` a
 * été commité en lien vers `/Users/…/bind_lot1/app/node_modules` — le chemin
 * absolu d'un autre clone, sur une machine précise. Deux sessions partageaient
 * un dossier ; l'une a créé le lien pour ne pas réinstaller, l'autre l'a
 * ramassé dans un `git add -A`.
 *
 * **Pourquoi rien ne l'a arrêté** : `.gitignore` portait `node_modules/`, avec
 * la barre oblique, qui ne vise que les répertoires. Un lien symbolique est un
 * blob pour git — il traverse la règle. La barre est retirée des deux fichiers,
 * et cette garde tient le reste : un lien vers un chemin de machine ne se
 * clone pas, ne s'installe pas, et fuite une arborescence privée.
 */
import { execFileSync } from 'child_process';
import { join } from 'path';

const RACINE = join(__dirname, '..', '..');

/** Les entrées de l'index, avec leur mode. `120000` est un lien symbolique. */
function suivis(): { mode: string; chemin: string }[] {
  const sortie = execFileSync('git', ['ls-files', '-s'], {
    cwd: RACINE,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return sortie
    .split('\n')
    .filter(Boolean)
    .map((ligne) => {
      const [modeEtReste, chemin] = ligne.split('\t');
      return { mode: modeEtReste.split(' ')[0], chemin };
    });
}

it('ne suit aucun lien symbolique', () => {
  const liens = suivis().filter(({ mode }) => mode === '120000');
  expect(liens.map(({ chemin }) => chemin)).toEqual([]);
});

it('regarde bien quelque chose', () => {
  // Sans cette moitié, un `git` absent ou un dépôt vide rendrait la garde verte
  // en n'inspectant rien — c'est la même faute que le test qui comparait le nom
  // du jeton au lieu de la police rendue.
  const tous = suivis();
  expect(tous.length).toBeGreaterThan(200);
  expect(tous.some(({ chemin }) => chemin === 'app/package.json')).toBe(true);
});
