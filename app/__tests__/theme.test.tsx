/**
 * Thème et jetons.
 *
 * Le test qui compte est celui des couleurs en dur : une couleur écrite dans un
 * écran survit au changement de thème, et ne se voit qu'en mode clair, chez le
 * commerce, à la lumière du jour. Le trouver à la lecture est illusoire ; le
 * trouver par un test est mécanique.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ThemeProvider, codeColors, themeForRole, tokens, useTheme } from '../src/theme';

const RACINE = join(__dirname, '..', 'src');
const PASSATION = join(__dirname, '..', '..', 'design_handoff_bind', 'tokens.json');

/** Seuls fichiers autorisés à porter un littéral de couleur. */
const TOLERES = ['src/theme/index.tsx', 'src/theme/tokens.json'];

/**
 * Écrans écrits avant le système de design, qui seront refaits sur les jetons.
 *
 * La liste est **exacte**, pas un préfixe : y ajouter un fichier demande de
 * modifier ce test, ce qui se voit en relecture. Elle ne doit que rétrécir —
 * un test vérifie sa taille, pour qu'une dette nommée ne se mette pas à
 * grossir tranquillement.
 */
const A_MIGRER = [
  'src/screens/CameraScanner.tsx',
  'src/screens/MenuReviewScreen.tsx',
  'src/screens/RedemptionScreen.tsx',
];

function sources(dossier: string, trouves: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) sources(chemin, trouves);
    else if (/\.(ts|tsx)$/.test(entree)) trouves.push(chemin);
  }
  return trouves;
}

function Sonde() {
  const { name, role, color, density } = useTheme();
  return (
    <>
      <Text>{`${name}/${role}`}</Text>
      <Text>{color['bg.canvas']}</Text>
      <Text>{String(density.screenPadding)}</Text>
    </>
  );
}

describe('jetons', () => {
  it('le fichier de l’app est celui de la passation, sans retouche', () => {
    // Le retranscrire aurait créé une seconde vérité, et c'est la seconde
    // qu'on oublie de mettre à jour quand le design bouge.
    const app = readFileSync(join(RACINE, 'theme', 'tokens.json'), 'utf-8');
    const passation = readFileSync(PASSATION, 'utf-8');

    expect(JSON.parse(app)).toEqual(JSON.parse(passation));
  });

  it('les deux thèmes portent exactement les mêmes noms', () => {
    // Un nom présent d'un seul côté produit une couleur indéfinie dans un
    // thème et correcte dans l'autre — le pire des deux.
    expect(Object.keys(tokens.color.dark).sort()).toEqual(Object.keys(tokens.color.light).sort());
  });

  it('les jetons qui ne doivent pas être copiés diffèrent bien', () => {
    // `role.merchant` et `accent.default` sont déclinés par thème : l'ocre
    // clair du sombre est illisible sur blanc.
    for (const nom of ['role.merchant', 'accent.default', 'text.muted', 'badge.scrim'] as const) {
      expect(tokens.color.dark[nom]).not.toBe(tokens.color.light[nom]);
    }
  });
});

describe('couleurs en dur', () => {
  const fichiers = sources(RACINE);

  it('il y a bien des sources à inspecter', () => {
    expect(fichiers.length).toBeGreaterThan(3);
  });

  it('aucune couleur littérale hors du dossier de thème', () => {
    const fautives: string[] = [];

    for (const chemin of fichiers) {
      const relatif = chemin.slice(chemin.indexOf('src/'));
      if (TOLERES.includes(relatif) || A_MIGRER.includes(relatif)) continue;

      readFileSync(chemin, 'utf-8')
        .split('\n')
        .forEach((ligne, index) => {
          if (/#[0-9a-fA-F]{3,8}\b/.test(ligne) || /\brgba?\(/.test(ligne)) {
            fautives.push(`${relatif}:${index + 1} → ${ligne.trim()}`);
          }
        });
    }

    expect(fautives).toEqual([]);
  });

  it('la dette d’écrans non migrés ne grossit pas', () => {
    // Écrans écrits avant le système de design. Ils seront refaits sur les
    // jetons ; d'ici là, la dette est nommée et comptée plutôt que silencieuse.
    //
    // Le nombre **décroît** : cinq au départ, quatre quand l'écran des paliers
    // a été refait sur les composants et le client d'API, trois depuis que le
    // diagnostic de connexion a quitté ses couleurs en dur. Ce test tombe dans
    // les deux sens — si quelqu'un en ajoute un, et si quelqu'un en migre un
    // sans mettre la liste à jour, ce qui laisserait une tolérance ouverte sur
    // un fichier qui n'en a plus besoin.
    expect(A_MIGRER).toHaveLength(3);

    // Et chacun existe encore : une entrée obsolète couvrirait un fichier
    // recréé plus tard sous le même nom.
    for (const relatif of A_MIGRER) {
      expect(() => readFileSync(join(RACINE, '..', relatif), 'utf-8')).not.toThrow();
    }
  });

  it('l’écran de code a ses deux couleurs, exportées et conformes', () => {
    // Elles ne viennent d'aucun thème : un code de retrait doit se lire à
    // 1,20 m dans un salon très éclairé.
    expect(codeColors).toEqual({ fg: '#FFFFFF', bg: '#000000' });
    expect(codeColors.fg).toBe(tokens.code.fg);
    expect(codeColors.bg).toBe(tokens.code.bg);
  });
});

describe('bascule par rôle', () => {
  it('les trois rôles sont en clair depuis la v0.5', () => {
    // Le créateur était en sombre. La découverte est devenue un catalogue, et
    // un catalogue se regarde en clair : ce sont les photos qui portent la
    // couleur, le fond n'a pas à la leur disputer. Le jeu clair existait déjà
    // et tient AA — c'est le seul changement au niveau des jetons.
    expect(themeForRole('creator')).toBe('light');
    expect(themeForRole('merchant')).toBe('light');
  });

  it('la densité reste celle du rôle, pas celle du thème', () => {
    // Les deux ont bougé ensemble jusqu'ici, ce qui les rendait
    // indiscernables. Elles ne le sont plus : même thème, densités
    // différentes — un créateur parcourt, un commerce travaille au comptoir.
    expect(tokens.density.creator.screenPadding).not.toBe(
      tokens.density.merchant.screenPadding,
    );
  });

  it.each([
    ['creator', 'light', '20'],
    ['merchant', 'light', '16'],
  ] as const)('le rôle %s rend le thème %s et sa densité', async (role, theme, padding) => {
    const vue = await render(
      <ThemeProvider role={role}>
        <Sonde />
      </ThemeProvider>,
    );

    await waitFor(() => expect(vue.getByText(`${theme}/${role}`)).toBeTruthy());
    expect(vue.getByText(tokens.color[theme]['bg.canvas'])).toBeTruthy();
    // La densité suit le rôle, pas le thème : le commerce lit des listes
    // longues sur un téléphone posé au comptoir.
    expect(vue.getByText(padding)).toBeTruthy();
  });

  it('le choix de l’utilisateur l’emporte sur le rôle', async () => {
    const vue = await render(
      <ThemeProvider role="creator" initialTheme="light">
        <Sonde />
      </ThemeProvider>,
    );

    await waitFor(() => expect(vue.getByText('light/creator')).toBeTruthy());
    // La densité, elle, ne bouge pas : elle appartient au rôle.
    expect(vue.getByText('20')).toBeTruthy();
  });

  it('un composant rendu hors du fournisseur lève', () => {
    // Retomber sur le sombre afficherait des couleurs de créateur chez un
    // commerce, sans que personne ne s'en aperçoive avant une capture d'écran.
    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Sonde />)).rejects.toThrow(/ThemeProvider/);
    silence.mockRestore();
  });
});
