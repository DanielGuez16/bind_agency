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
import { familles, nomDeFonte, policesAcharger, typography } from '../src/theme';
import { ThemeProvider } from '../src/theme';

describe('la direction v1.1 a bien remplacé les familles', () => {
  it('nomme une seule famille de texte, et le mono ne bouge pas', () => {
    // **Le Didone est retiré, et avec lui la seconde famille.** La revue de
    // campagne l'a nommé en premier : un Bodoni à 34 px sur chaque écran fait
    // magazine, sur une application qu'on ouvre dix fois par jour.
    //
    // `display` et `sans` désignent désormais la même fonte, et ce n'est pas
    // une redondance : le rôle survit à la famille. Le jour où une direction
    // sépare à nouveau les titres du corps, seule cette table change.
    expect(familles).toEqual({
      display: 'Plus Jakarta Sans',
      sans: 'Plus Jakarta Sans',
      mono: 'IBM Plex Mono',
    });
  });

  it('ne charge plus une seule face des deux familles retirées', () => {
    // Une famille qui survit à la bascule ne casse rien de visible : elle pèse
    // au démarrage, et le texte qui la demanderait encore retomberait sur la
    // pile système sans erreur et sans test rouge — le défaut d'origine, à
    // l'identique. On regarde ce qui est réellement posé, pas ce qui est écrit.
    const retirees = Object.keys(policesAcharger()).filter((nom) =>
      /^(FamiljenGrotesk|IBMPlexSans|BodoniModa|Outfit)_/.test(nom),
    );

    expect(retirees).toEqual([]);
  });

  it('ne les garde pas non plus en dépendance', () => {
    // Le test précédent regarde ce que l'app pose ; celui-ci regarde ce que le
    // paquet embarque. Un `@expo-google-fonts` orphelin reste installé, reste
    // téléchargé en intégration continue, et fait croire à la relecture que la
    // famille est encore une option ouverte.
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const paquet = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    const polices = Object.keys(paquet.dependencies).filter((nom) =>
      nom.startsWith('@expo-google-fonts/'),
    );

    expect(polices.sort()).toEqual([
      '@expo-google-fonts/ibm-plex-mono',
      '@expo-google-fonts/plus-jakarta-sans',
    ]);
  });
});

describe('les fontes du système', () => {
  it('charge un fichier pour chaque variante de l’échelle', async () => {
    // Déduit des jetons, jamais énuméré : une variante ajoutée amène sa fonte
    // sans qu'on y pense, et une variante retirée cesse de coûter un fichier.
    const chargees = policesAcharger();
    expect(Object.keys(chargees).length).toBeGreaterThan(0);

    for (const [nom, echelle] of Object.entries(typography)) {
      const attendu = nomDeFonte(
        echelle.fontFamily,
        echelle.fontWeight,
        echelle.fontStyle === 'italic' ? 'italic' : 'normal',
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
    const famille = familles.sans;
    expect(nomDeFonte('sans', '600')).toBe(`${famille.replace(/\s+/g, '')}_600`);
    expect(nomDeFonte('sans', '600')).not.toBe(famille);
  });

  it('retombe sur une graisse réelle quand celle qu’on demande manque', async () => {
    // Mieux vaut un 500 dessiné qu'un 800 fabriqué. La règle vaut surtout pour
    // la direction artistique à venir, qui n'aura pas forcément sept graisses.
    const famille = familles.mono.replace(/\s+/g, '');
    const retenue = nomDeFonte('mono', '800');

    expect(retenue).not.toBe(`${famille}_800`);
    expect(retenue.startsWith(`${famille}_`)).toBe(true);
  });

  it('pose le nom enregistré sur le texte rendu', async () => {
    await render(
      <ThemeProvider role="creator">
        <Texte variante="type.screenTitle" testID="titre">
          BIND
        </Texte>
      </ThemeProvider>,
    );

    const style = screen.getByTestId('titre').props.style;
    const aplati = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    // `type.screenTitle` passe de 600 à 700 avec la v1.1 : la hiérarchie est
    // désormais portée par la graisse, puisqu'il n'y a plus qu'une famille.
    expect(aplati.fontFamily).toBe(nomDeFonte('sans', '700'));
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


    const noms: string[] = Object.values(familles);
    const fautifs = sources.filter((chemin: string) => {
      // Le dossier du thème est le seul endroit autorisé : les jetons les
      // déclarent, `polices.ts` dit quel fichier va avec.
      if (chemin.includes(join('src', 'theme'))) return false;
      const source = readFileSync(chemin, 'utf-8');
      return noms.some((famille) => source.includes(famille));
    });

    expect(fautifs).toEqual([]);
  });

  it('ne charge aucun italique, parce que le système n’en demande aucun', async () => {
    // **Ce test disait l'inverse, et il avait raison de le dire.** En v1.0
    // l'accent était un changement de voix dans un Didone, où l'italique est un
    // autre dessin — et un `fontStyle: 'italic'` sur une romaine aurait produit
    // un oblique synthétique.
    //
    // L'accent est devenu une **graisse**, 800 contre 700, dans la seule
    // famille du système. Il n'y a donc plus de seconde voix à charger, et une
    // face italique posée au démarrage serait un fichier que rien ne demande.
    const italiques = Object.keys(policesAcharger()).filter((nom) => nom.endsWith('Italic'));
    expect(italiques).toEqual([]);

    // Et le sens inverse : la graisse d'accent, elle, est bien posée. Sans
    // elle, `displayAccent` retomberait sur la graisse voisine et l'accent
    // cesserait d'exister sans que rien ne tombe.
    expect(nomDeFonte('display', '800') in policesAcharger()).toBe(true);
  });

  it('retombe sur la romaine quand la famille n’a pas d’italique', async () => {
    // IBM Plex Mono et Outfit n'ont aucun emploi d'italique dans le système, et
    // en charger un coûterait un fichier au démarrage pour rien. Demander
    // l'italique là ne doit pas rendre un nom que rien n'enregistre : mieux
    // vaut un romain qu'un repli silencieux sur la pile système.
    for (const role of ['sans', 'mono'] as const) {
      expect(nomDeFonte(role, '500', 'italic')).toBe(nomDeFonte(role, '500'));
    }
  });

  it('ne charge que ce que l’échelle demande, italique compris', async () => {
    // Le contrat de `policesAcharger` : déduit des jetons, jamais énuméré. Une
    // variante italique ajoutée à l'échelle amène son fichier sans qu'on y
    // pense ; tant qu'aucune ne la demande, aucun fichier italique ne pèse au
    // démarrage.
    const chargees = Object.keys(policesAcharger());
    // Les **noms distincts** et non le nombre de variantes : `displayAccent` et
    // `headingAccent` sont le même fichier à deux tailles, et compter les
    // variantes ferait attendre deux fichiers là où un seul est chargé.
    const italiquesDemandees = new Set(
      Object.values(typography)
        .filter((echelle) => echelle.fontStyle === 'italic')
        .map((echelle) => nomDeFonte(echelle.fontFamily, echelle.fontWeight, 'italic')),
    );

    expect(chargees.filter((nom) => nom.endsWith('Italic')).sort()).toEqual(
      [...italiquesDemandees].sort(),
    );
  });

  it('rend un nom que le CSS accepte sans guillemets', async () => {
    // **Le défaut qui a rendu tout le produit en police système.**
    // `react-native-web` écrit `fontFamily` verbatim, sans guillemets : le nom
    // arrive tel quel dans `font-family:`. Un identifiant CSS ne peut pas
    // commencer par un chiffre, si bien que « IBM Plex Sans 600 » invalidait la
    // déclaration entière — et le navigateur la jetait sans rien dire.
    const valide = /^[A-Za-z][A-Za-z0-9_-]*$/;

    for (const role of ['display', 'sans', 'mono'] as const) {
      for (const graisse of ['400', '500', '600', '700']) {
        // Les deux voix : l'italique suffixe le même identifiant, et c'est là
        // qu'un séparateur mal choisi — un espace, un tiret devant un chiffre —
        // recréerait le défaut d'origine.
        for (const voix of ['normal', 'italic'] as const) {
          const nom = nomDeFonte(role, graisse, voix);
          expect({ nom, accepte: valide.test(nom) }).toEqual({ nom, accepte: true });
        }
      }
    }
  });

  it('ne demande plus la graisse en plus du nom qui la porte', async () => {
    // Chaque fichier est enregistré sans descripteur de graisse : pour le
    // navigateur, la face est normale. Demander 600 par-dessus la ferait
    // grossir une seconde fois, par synthèse, au-dessus d'un semi-gras déjà
    // dessiné.
    await render(
      <ThemeProvider role="creator">
        <Texte variante="type.bodyStrong" testID="fort">
          BIND
        </Texte>
      </ThemeProvider>,
    );

    const style = screen.getByTestId('fort').props.style;
    const aplati = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    expect(aplati.fontWeight).toBeUndefined();
    expect(aplati.fontFamily).toBe(nomDeFonte('sans', '600'));
  });
});

/**
 * La pile de repli, et **ce qu'elle ne doit jamais toucher**.
 *
 * Elle a coûté une CI rouge, et la leçon vaut d'être tenue. `nomDeFonte` sert
 * deux choses : écrire un style, et **enregistrer** la face auprès d'`expo-font`.
 * Composer la pile dedans a enregistré une famille appelée
 * « BodoniModa_400Regular, Didot, … » — plus aucune face posée, et toutes les
 * fontes du web perdues.
 *
 * Aucun test unitaire ne l'a vu : ils lisaient le nom rendu, jamais ce qui part
 * à l'enregistrement. C'est la suite de bout en bout qui l'a dit, vingt minutes
 * plus tard. Les deux tests ci-dessous ferment l'écart.
 */
describe('la pile de repli ne sort pas de son emploi', () => {
  const { nomDeFonte, policesAcharger } = require('../src/theme');
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const source = readFileSync(join(__dirname, '..', 'src', 'theme', 'polices.ts'), 'utf-8');

  it('ce qui s’enregistre est un nom, jamais une pile', () => {
    // **La propriété exacte qui a cassé.** Une virgule dans une clé
    // d'enregistrement, et `expo-font` ne pose plus rien.
    for (const nom of Object.keys(policesAcharger())) {
      expect({ nom, virgule: nom.includes(','), espace: nom.includes(' ') }).toEqual({
        nom,
        virgule: false,
        espace: false,
      });
    }
  });

  it('et `nomDeFonte` rend ce nom-là, pas la pile', () => {
    const nom = nomDeFonte('display', 400);
    expect(nom).not.toContain(',');
    expect(Object.keys(policesAcharger())).toContain(nom);
  });

  it('le repli ne se compose que dans `pileDeFontes`, et nulle part ailleurs', () => {
    // **Une garde de source, et c'est délibéré.** Le défaut ne se produit que
    // sur le web, et jest rend en natif : une première version de ce bloc
    // forçait `Platform.OS`, ce qui a demandé de mocker `react-native` entier
    // et fait tomber le module natif du menu de développement. La distinction
    // étant liée à une plateforme que la suite unitaire ne joue pas, ce qui se
    // vérifie ici est **où** le repli est composé — la seule chose qui compte.
    const corps = (nom: string) => {
      const d = source.indexOf(`export function ${nom}(`);
      const f = source.indexOf('\nexport ', d + 1);
      return source.slice(d, f === -1 ? undefined : f);
    };

    expect(corps('pileDeFontes')).toContain('repli');
    expect(corps('nomDeFonte')).not.toContain('repli');
    // Et une seule mention en tout : deux endroits divergeraient.
    expect(source.split('produit.repli').length - 1).toBe(1);
  });
});
