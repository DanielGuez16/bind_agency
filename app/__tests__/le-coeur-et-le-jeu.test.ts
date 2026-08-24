/**
 * Le remplissage est une exception, et elle doit le rester.
 *
 * **Le jeu d'icônes n'a jamais eu de plein**, et c'est écrit dans son en-tête :
 * vingt-quatre points, trait 1,75, jamais de remplissage. Le cœur des favoris
 * y déroge parce que son état **est** son remplissage — un cœur en contour et
 * un cœur plein sont les deux états d'une même icône, pas deux icônes.
 *
 * **Une exception sans garde devient une porte.** `rempli` est un prop comme
 * un autre : rien n'empêche de le poser sur la coche, sur l'alerte, sur le
 * lieu — et le jeu perdrait en trois écrans ce que son en-tête promet. Cette
 * garde le tient au seul glyphe pour lequel il a été ouvert.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = join(__dirname, '..', 'src');

function sources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((entree) => {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) return sources(chemin);
    return /\.tsx?$/.test(entree) ? [chemin] : [];
  });
}

/** Chaque balise `<Icone …>`, attributs compris, du premier `<` au `>` fermant. */
function balisesIcone(source: string): string[] {
  const vues: string[] = [];
  const debut = /<Icone\b/g;
  let trouve: RegExpExecArray | null;

  while ((trouve = debut.exec(source)) !== null) {
    let profondeur = 0;
    for (let i = trouve.index; i < source.length; i += 1) {
      const caractere = source[i];
      if (caractere === '{') profondeur += 1;
      else if (caractere === '}') profondeur -= 1;
      // On s'arrête au `>` qui ferme la balise ouvrante, jamais au premier
      // rencontré : `taille={x > 2}` en contient un, et couper là ferait lire
      // une balise tronquée.
      else if (caractere === '>' && profondeur === 0) {
        vues.push(source.slice(trouve.index, i + 1));
        break;
      }
    }
  }
  return vues;
}

describe('le remplissage ne sert qu’au cœur', () => {
  it('aucune autre icône n’est rendue pleine', () => {
    const fautives: string[] = [];

    for (const chemin of sources(RACINE)) {
      const source = readFileSync(chemin, 'utf-8');
      for (const balise of balisesIcone(source)) {
        if (!/\brempli\b/.test(balise)) continue;
        if (/nom="coeur"/.test(balise)) continue;
        const ligne = source.slice(0, source.indexOf(balise)).split('\n').length;
        fautives.push(`${chemin.slice(chemin.indexOf('src/'))}:${ligne}`);
      }
    }

    expect(fautives).toEqual([]);
  });

  it('la garde regarde bien quelque chose', () => {
    // Sans ceci, une expression qui ne trouve plus aucune balise passerait au
    // vert en n'ayant rien lu.
    const toutes = sources(RACINE).flatMap((chemin) =>
      balisesIcone(readFileSync(chemin, 'utf-8')),
    );
    expect(toutes.length).toBeGreaterThan(20);
    // Et le cœur plein existe : la garde éprouve un cas réel, pas un vide.
    expect(toutes.some((b) => /nom="coeur"/.test(b) && /\brempli\b/.test(b))).toBe(true);
  });

  it('et elle attrape les formes qu’on écrira', () => {
    // L'exemple qui a motivé la garde, puis les autres façons de l'écrire.
    const fautives = [
      '<Icone nom="coche" rempli />',
      '<Icone nom="alerte" rempli={true} />',
      '<Icone\n  nom="lieu"\n  rempli={estActif}\n  taille={20}\n/>',
      '<Icone nom="etincelle" taille={16} rempli />',
    ];
    for (const balise of fautives) {
      const prise = balisesIcone(balise).some(
        (b) => /\brempli\b/.test(b) && !/nom="coeur"/.test(b),
      );
      expect({ balise, prise }).toEqual({ balise, prise: true });
    }
  });
});
