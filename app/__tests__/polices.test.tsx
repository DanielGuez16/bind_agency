/**
 * Les fontes sont chargées, et chaque graisse a son fichier.
 *
 * Le défaut : les jetons nommaient trois familles, `Texte` les demandait par
 * `fontFamily`, et **aucune n'existait dans le dépôt**. Tout le produit rendait
 * en police système sans que rien ne le signale — ni une erreur, ni un test.
 * C'est le seul écart de rendu qui portait sur cent pour cent des écrans, et il
 * a tenu jusqu'à ce qu'on regarde une capture.
 *
 * Ce qui est éprouvé ici est ce qu'un œil ne peut pas vérifier : qu'aucune
 * graisse demandée par l'échelle ne manque à l'appel. Une graisse absente n'est
 * pas une erreur visible — le moteur la **synthétise**, et le texte paraît
 * seulement un peu gras, un peu sale.
 */
import { render, screen } from '@testing-library/react-native';

import { Texte } from '../src/components';
import { nomDeFonte, policesAcharger, tokens, typography } from '../src/theme';
import { ThemeProvider } from '../src/theme';

describe('les fontes du système', () => {
  it('charge un fichier pour chaque variante de l’échelle', async () => {
    // Déduit des jetons, jamais énuméré : une variante ajoutée amène sa fonte
    // sans qu'on y pense, et une variante retirée cesse de coûter un fichier.
    const chargees = policesAcharger();
    expect(Object.keys(chargees).length).toBeGreaterThan(0);

    for (const [nom, echelle] of Object.entries(typography)) {
      const attendu = nomDeFonte(
        echelle.fontFamily as never,
        (echelle as { fontWeight: string }).fontWeight,
      );
      expect({ variante: nom, presente: attendu in chargees }).toEqual({
        variante: nom,
        presente: true,
      });
    }
  });

  it('n’enregistre que des fichiers réels', async () => {
    // Une valeur nulle passerait `useFonts` sans rien charger, et la police
    // système reprendrait la main en silence.
    for (const [nom, fichier] of Object.entries(policesAcharger())) {
      expect({ nom, vide: fichier === undefined || fichier === null }).toEqual({
        nom,
        vide: false,
      });
    }
  });

  it('nomme la graisse, au lieu de la laisser synthétiser', async () => {
    // Sur iOS et Android, `fontWeight` ne choisit pas un fichier. Demander la
    // famille seule laisse le moteur épaissir les fûts lui-même.
    const famille = tokens.typography.fontFamily.ui;
    expect(nomDeFonte('ui', '600')).toBe(`${famille} 600`);
    expect(nomDeFonte('ui', '600')).not.toBe(famille);
  });

  it('retombe sur une graisse réelle quand celle qu’on demande manque', async () => {
    // Mieux vaut un 500 dessiné qu'un 800 fabriqué. La règle vaut surtout pour
    // la direction artistique à venir, qui n'aura pas forcément sept graisses.
    const famille = tokens.typography.fontFamily.mono;
    const retenue = nomDeFonte('mono', '800');

    expect(retenue).not.toBe(`${famille} 800`);
    expect(retenue in policesAcharger() || retenue.startsWith(famille)).toBe(true);
  });

  it('pose le nom enregistré sur le texte rendu', async () => {
    await render(
      <ThemeProvider role="creator">
        <Texte variante="type.display" testID="titre">
          BIND
        </Texte>
      </ThemeProvider>,
    );

    const style = screen.getByTestId('titre').props.style;
    const aplati = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    expect(aplati.fontFamily).toBe(nomDeFonte('display', '600'));
  });

  it('garde les familles dans les jetons, et nulle part ailleurs', async () => {
    // La direction artistique peut changer les trois familles. Elle doit alors
    // changer une ligne de jeton et l'entrée de fichier correspondante — jamais
    // un écran. Un nom de fonte écrit dans un composant casserait ce contrat.
    const { readFileSync, readdirSync, statSync } = require('fs');
    const { join } = require('path');

    const sources: string[] = [];
    const parcourir = (dossier: string) => {
      for (const entree of readdirSync(dossier)) {
        const chemin = join(dossier, entree);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.tsx?$/.test(entree)) sources.push(chemin);
      }
    };
    parcourir(join(__dirname, '..', 'src'));

    const familles = Object.values(tokens.typography.fontFamily);
    const fautifs = sources.filter((chemin) => {
      // Le dossier du thème est le seul endroit autorisé : les jetons les
      // déclarent, `polices.ts` dit quel fichier va avec.
      if (chemin.includes(join('src', 'theme'))) return false;
      const source = readFileSync(chemin, 'utf-8');
      return familles.some((famille) => source.includes(famille));
    });

    expect(fautifs).toEqual([]);
  });
});
