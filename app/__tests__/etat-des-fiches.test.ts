/**
 * L'état d'une fiche préparée vient du serveur, et l'écran ne le dérive plus.
 *
 * **Deux dérivations sont mortes ici, dont une que j'avais ajoutée la veille.**
 * L'écran en portait une depuis le premier lot ; j'en ai posé une seconde dans
 * son propre module, sans voir la première. Le serveur sert désormais `etat`, et
 * les deux sont retirées — deux calculs de la même chose finissent par diverger,
 * et c'est celui de l'écran qui aurait tort.
 *
 * **L'ordre y est plus délicat qu'il n'y paraît.** Une fiche bloquée sur
 * l'engagement puis assumée est **assumée** : regarder `blocked_at` avant
 * `used_at` afficherait « bloquée » pour toujours sur un salon qui travaille
 * depuis un mois, et la tournée compterait un échec là où elle a réussi. C'est
 * exactement le genre d'ordre qu'un second calcul se trompe à reproduire.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(__dirname, '..', 'src', 'screens', 'TerrainScreen.tsx'),
  'utf-8',
);

/** Le code sans ses commentaires : ils parlent justement de ce qu'on interdit. */
const CODE = SOURCE.split('\n')
  .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
  .join('\n');

describe('l’état vient du serveur', () => {
  it('l’écran lit `etat` et ne le recalcule pas', () => {
    expect(CODE).toContain('fiche.etat');
  });

  it('et ne dérive plus rien des dates', () => {
    // **La garde vise les quatre champs, pas le nom de la fonction.** Une
    // dérivation réécrite sous un autre nom passerait une garde qui ne
    // chercherait que `etatDeLaFiche` ; ce qu'on interdit est de regarder ces
    // dates pour décider d'un état, quel que soit l'emballage.
    for (const date of ['used_at', 'revoked_at', 'expires_at', 'blocked_at']) {
      expect({ date, lu: CODE.includes(`fiche.${date}`) }).toEqual({ date, lu: false });
    }
  });

  it('et la fonction qui le dérivait n’est plus exportée', () => {
    // Sur la source : un import dynamique demande un drapeau de module que la
    // suite n'a pas, et l'exportation se lit très bien ici.
    expect(SOURCE).not.toMatch(/export function etatDeLaFiche/);
  });
});
