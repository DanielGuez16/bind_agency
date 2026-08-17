/**
 * Thème et jetons — direction BIND AGENCY v1.0.
 *
 * Le test qui compte est celui des couleurs en dur : une couleur écrite dans un
 * écran survit au changement de direction artistique, et ne se voit qu'une fois
 * la bascule faite, sur un écran que personne ne rouvre. Le trouver à la
 * lecture est illusoire ; le trouver par un test est mécanique.
 *
 * Viennent ensuite les deux règles que la v1.0 pose et que le code peut
 * réellement tenir : **`brand.500` ne s'écrit jamais**, et **le Didone ne
 * descend jamais sous 34 px**. Les deux se vérifient « à l'œil » selon la
 * passation, et c'est précisément ce qui ne tient pas six semaines.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  ThemeProvider,
  codeColors,
  couleurs,
  matiereDePalier,
  matiereDeRole,
  PLANCHER_DIDONE,
  produit,
  tokens,
  typography,
  useTheme,
  type ColorName,
  type Palier,
} from '../src/theme';

const RACINE = join(__dirname, '..', 'src');
const PASSATION = join(__dirname, '..', '..', 'design_handoff_bind', 'tokens.json');

/** Seuls fichiers autorisés à porter un littéral de couleur. */
const TOLERES = ['src/theme/index.tsx', 'src/theme/tokens.json', 'src/theme/produit.json'];

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
  const { role, color, density, matiere } = useTheme();
  return (
    <>
      <Text>{role}</Text>
      <Text>{color['bg.page']}</Text>
      <Text>{String(density.screenPadding)}</Text>
      <Text>{matiere.surface}</Text>
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

  it('c’est bien la v1.0 qui est en place', () => {
    // Une assertion de volume, comme sur l'inventaire des routes publiques :
    // sans elle, un fichier vidé des deux côtés passerait le test précédent
    // sans rien prouver.
    expect(tokens.$meta.name).toBe('BIND AGENCY (v1.0)');
    expect(Object.keys(tokens.color.brand)).toContain('500');
    expect(Object.keys(couleurs).length).toBeGreaterThan(30);
  });

  it('rien de `produit.json` n’existe déjà dans `tokens.json`', () => {
    // La règle du fichier compagnon, tenue mécaniquement. Une clé présente des
    // deux côtés est une seconde vérité, et c'est la seconde qu'on oublie.
    // `motion` et `type` sont des sections partagées par construction : ce
    // sont leurs **clés internes** qui ne doivent pas se recouvrir.
    const doublons: string[] = [];
    for (const [section, valeur] of Object.entries(produit)) {
      if (section === '$meta') continue;
      const cote = (tokens as Record<string, unknown>)[section];
      if (cote === undefined) continue;
      for (const cle of Object.keys(valeur as object)) {
        if (cle.startsWith('$')) continue;
        if (cle in (cote as object)) doublons.push(`${section}.${cle}`);
      }
    }

    expect(doublons).toEqual([]);
  });

  it('les tables de matière disent la même chose que les jetons', () => {
    // `matiereDePalier` lit les hexadécimaux de `tokens.color.tier` dans le
    // vocabulaire du système — `brand.700` plutôt que `#A83E06`. C'est une
    // lecture, pas une seconde vérité, et c'est ce test qui fait la différence
    // entre les deux : les valeurs résolues doivent retomber sur celles de la
    // passation, sans quoi la table dérive en silence.
    const attendu: Record<Palier, { surface: string; texte: string; barres: number }> = {
      story: {
        surface: tokens.color.tier.story.surface,
        texte: tokens.color.tier.story.text,
        barres: tokens.color.tier.story.glyphFilled,
      },
      post: {
        surface: tokens.color.tier.post.surface,
        texte: tokens.color.tier.post.text,
        barres: tokens.color.tier.post.glyphFilled,
      },
      reel: {
        surface: tokens.color.tier.reel.surface,
        texte: tokens.color.tier.reel.text,
        barres: tokens.color.tier.reel.glyphFilled,
      },
    };

    for (const palier of ['story', 'post', 'reel'] as Palier[]) {
      const m = matiereDePalier(palier);
      expect({
        palier,
        surface: couleurs[m.surface],
        texte: couleurs[m.texte],
        barres: m.barresPleines,
      }).toEqual({ palier, ...attendu[palier] });
    }
  });

  it('la progression des matières est ordinale, et le reste sur l’encre', () => {
    // C'est le gain de la v1.0 sur les trois teintes : contour, teinte, aplat
    // s'ordonne sans apprentissage, et se lit en niveaux de gris. Un rose, un
    // vert et un violet ne disaient pas lequel était le plus exigeant.
    const ordre = (surEncre: boolean) =>
      (['story', 'post', 'reel'] as Palier[]).map((p) => matiereDePalier(p, surEncre).matiere);

    expect(ordre(false)).toEqual(['outline', 'tint', 'solid']);
    expect(ordre(true)).toEqual(['outline', 'tint', 'solid']);
    // « L'aplat ne bouge pas » : c'est lui qui garde l'ordre lisible d'un fond
    // à l'autre.
    expect(matiereDePalier('reel', true).surface).toBe(matiereDePalier('reel').surface);
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
    // Le nombre **décroît**. Ce test tombe dans les deux sens — si quelqu'un en
    // ajoute un, et si quelqu'un en migre un sans mettre la liste à jour, ce
    // qui laisserait une tolérance ouverte sur un fichier qui n'en a plus
    // besoin.
    expect(A_MIGRER).toHaveLength(3);

    for (const relatif of A_MIGRER) {
      expect(() => readFileSync(join(RACINE, '..', relatif), 'utf-8')).not.toThrow();
    }
  });

  it('aucun réglage de thème ne subsiste, ni dans les jetons ni dans l’écran', () => {
    // **Un interrupteur qui ne commande rien est pire que son absence** : il
    // fait douter de ceux qui commandent quelque chose. La v1.0 ne livre
    // qu'une palette, et `userOverride` désignait une bascule vers un second
    // thème qui n'existe pas. Il est parti des jetons comme il était déjà parti
    // de l'écran de réglages, et la clé porte à sa place la raison de son
    // absence — ce qui la rend relisible le jour où un jeu sombre arrive.
    expect(tokens.theme).not.toHaveProperty('userOverride');
    expect(tokens.theme.$userOverrideRetire.length).toBeGreaterThan(80);

    // Et rien dans les sources ne le lit encore : une clé retirée qu'un écran
    // interroge encore rend `undefined`, ce qui se lit comme « faux » et ne
    // casse rien — le pire des deux mondes.
    const fautifs = sources(RACINE).filter((chemin) =>
      readFileSync(chemin, 'utf-8')
        .split('\n')
        // La prose qui documente le retrait cite forcément ce qu'elle retire.
        .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
        .some((ligne) => /userOverride|setOverride|ThemeName/.test(ligne)),
    );
    expect(fautifs).toEqual([]);
  });

  it('l’écran de code a ses deux couleurs, exportées et conformes', () => {
    // Elles ne viennent d'aucun jeton de marque : la passation déclare cet
    // écran hors système. Il est lu par une caméra et par une vendeuse à un
    // mètre.
    expect(codeColors).toEqual({ fg: '#FFFFFF', bg: '#000000' });
    expect(codeColors.fg).toBe(produit.code.fg);
    expect(codeColors.bg).toBe(produit.code.bg);
    // Et la passation le sait : l'écran est nommé dans la liste des exceptions.
    expect(tokens.theme.outOfTheme.join(' ')).toContain('redemptionCode');
  });
});

// --------------------------------------------------------------------------
// les deux règles centrales de la v1.0
// --------------------------------------------------------------------------

/**
 * Les façons d'écrire du texte, dans le vocabulaire du produit.
 *
 * **Quatre formes, et pas seulement celle qu'on avait en tête.** Un
 * `couleur="brand.500"` sur `Texte` est la forme évidente ; `color:
 * c['brand.500']` dans un style en est une autre, et `tabBarActiveTintColor`
 * une troisième, qui ne ressemble à aucune des deux. Une garde calée sur la
 * première laisserait passer les autres, et ferait croire que la question est
 * réglée.
 */
const ENCRES = [
  /couleur=["']brand\.(500|600)["']/,
  /couleur=\{['"]brand\.(500|600)['"]\}/,
  /\bcolor:\s*c\[['"]brand\.(500|600)['"]\]/,
  // `tabBarActiveTintColor` : le mot est au milieu d'un nom composé, et une
  // garde ancrée sur un début de mot l'aurait laissé passer.
  /\w*(?:[Tt]int|[Tt]ext)Color[^,;]*brand\.(500|600)/,
];

describe('brand.500 est une surface, jamais une encre', () => {
  it('attrape les quatre formes, et rien d’innocent', () => {
    const fautives = [
      '  <Texte couleur="brand.500">x</Texte>',
      "  <Texte couleur={'brand.500'} />",
      "  style={{ color: c['brand.500'] }}",
      "  tabBarActiveTintColor: c['brand.500'],",
    ];
    for (const ligne of fautives) {
      expect({ ligne, prise: ENCRES.some((r) => r.test(ligne)) }).toEqual({ ligne, prise: true });
    }

    const innocentes = [
      "  backgroundColor: c['brand.500'],",
      '  <Texte couleur="brand.700">x</Texte>',
      "  borderLeftColor: actif ? c['brand.500'] : 'transparent',",
      "  style={{ color: c['ink.onBrand'] }}",
    ];
    for (const ligne of innocentes) {
      expect({ ligne, prise: ENCRES.some((r) => r.test(ligne)) }).toEqual({ ligne, prise: false });
    }
  });

  it('aucune source n’écrit du texte avec une surface de la rampe', () => {
    // 3,0:1 sur blanc : refusé à toute taille. C'est la règle centrale de la
    // direction et la seule que le code puisse réellement tenir. Le texte
    // orange du système est `brand.700`, sans exception.
    const fautives: string[] = [];
    for (const chemin of sources(RACINE)) {
      const relatif = chemin.slice(chemin.indexOf('src/'));
      readFileSync(chemin, 'utf-8')
        .split('\n')
        .forEach((ligne, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
          if (ENCRES.some((r) => r.test(ligne))) fautives.push(`${relatif}:${index + 1}`);
        });
    }

    expect(fautives).toEqual([]);
  });

  it('`Texte` refuse la surface au lieu de la rendre en silence', async () => {
    // La garde statique attrape ce qui est écrit ; celle-ci attrape ce qui est
    // calculé — une couleur passée en variable ne se lit dans aucune source.
    const { Texte } = require('../src/components');
    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    const sonde = (
      <ThemeProvider role="creator">
        <Texte couleur={'brand.500' as ColorName}>x</Texte>
      </ThemeProvider>
    );
    await expect(() => render(sonde)).rejects.toThrow(/surface/);
    silence.mockRestore();
  });
});

describe('un texte sur une photo ne tient que sur le plus opaque des arrêts', () => {
  /**
   * **Le motif se répète partout où un texte est posé sur une photo**, et il
   * s'est trouvé deux fois en un jour : la sous-ligne de l'accueil, puis le nom
   * des cartes du fil. Dans les deux cas la même erreur — croire qu'un dégradé
   * garantit une lisibilité alors qu'il en donne une par pixel.
   *
   * Ce que ces tests fixent est le fait de départ, pas ses conséquences : ce
   * qu'il faut d'opacité, et lesquels des arrêts du système l'atteignent. Le
   * jour où quelqu'un éclaircit `scrim.photoBottom` pour laisser voir la photo,
   * c'est ici que ça tombe.
   */
  const { opaciteMinimaleDuVoile, luminance, contraste } = require('../src/theme');

  /** L'opacité d'un `rgba(...)`, telle que les jetons l'écrivent. */
  const opacite = (jeton: string) => Number(/,\s*([\d.]+)\)/.exec(jeton)![1]);

  it('l’arithmétique de contraste dit ce que WCAG dit', () => {
    // Deux repères que tout le monde connaît : le noir sur blanc vaut 21:1, et
    // une couleur contre elle-même vaut 1:1. Sans eux, une erreur d'exposant
    // dans la luminance ne se verrait nulle part.
    expect(contraste(luminance('#FFFFFF'), luminance('#000000'))).toBeCloseTo(21, 1);
    expect(contraste(luminance('#FF5E00'), luminance('#FF5E00'))).toBeCloseTo(1, 5);
  });

  it('dit ce qu’il faut d’opacité pour chaque encre', () => {
    // Sur la pire photo possible — une blanche. C'est le seul raisonnement qui
    // vaille sur une image dont on ne maîtrise rien, et ce n'est pas un cas
    // d'école : les mosaïques de la fondatrice alternent justement des
    // ensembles presque blancs.
    expect(opaciteMinimaleDuVoile('ink.onScrim')).toBeCloseTo(0.606, 2);
    expect(opaciteMinimaleDuVoile('ink.onScrimMuted')).toBeCloseTo(0.733, 2);
    // La sourde en demande plus que la claire : c'est ce qui rend l'ordre
    // vérifiable plutôt que su.
    expect(opaciteMinimaleDuVoile('ink.onScrimMuted')).toBeGreaterThan(
      opaciteMinimaleDuVoile('ink.onScrim'),
    );
  });

  it('et seul `scrim.photoBottom` l’atteint', () => {
    // C'est la conclusion qui compte : un texte posé sur le haut ou le milieu
    // d'un voile n'est pas démontrable, quelle que soit son encre.
    const requis = opaciteMinimaleDuVoile('ink.onScrimMuted');

    expect(opacite(tokens.color.scrim.photoBottom)).toBeGreaterThanOrEqual(requis);
    expect(opacite(tokens.color.scrim.modal)).toBeLessThan(requis);
    expect(opacite(tokens.color.scrim.photoTop)).toBeLessThan(requis);
  });
});

describe('le Didone ne descend jamais sous son plancher', () => {
  it('toutes les variantes en serif sont à 34 px ou au-dessus', () => {
    // « Un serif de 22 px est un bug visible » — pour qui sait qu'il en est un.
    // Ce test le sait à notre place, et il tombe le jour où quelqu'un ajoute un
    // sous-titre en Bodoni parce que ça faisait joli sur la maquette.
    const fautives = Object.entries(typography)
      .filter(([, echelle]) => echelle.fontFamily === 'display')
      .filter(([, echelle]) => echelle.fontSize < PLANCHER_DIDONE)
      .map(([nom, echelle]) => `${nom} → ${echelle.fontSize}`);

    expect(fautives).toEqual([]);
  });

  it('et le plancher est bien celui de la passation', () => {
    expect(PLANCHER_DIDONE).toBe(34);
    // Le titre d'écran est juste en dessous, en Outfit : c'est la frontière
    // elle-même, et elle sépare deux familles et non deux rôles.
    expect(typography['type.screenTitle'].fontFamily).toBe('sans');
    expect(typography['type.heading'].fontFamily).toBe('display');
    expect(typography['type.heading'].fontSize).toBe(PLANCHER_DIDONE);
  });
});

// --------------------------------------------------------------------------
// le rôle, en matière
// --------------------------------------------------------------------------

describe('matière du rôle', () => {
  it('encre pour l’administration, os pour le commerce, papier pour la créatrice', () => {
    // §8 de la passation, alternative retenue : la couleur de rôle disparaît,
    // la distinction reste. Une capture d'écran dit donc encore d'où elle
    // vient, sans qu'une teinte ait à porter un sens que personne ne décode.
    expect(matiereDeRole('admin').surface).toBe('bg.inverse');
    expect(matiereDeRole('merchant').surface).toBe('bg.page');
    expect(matiereDeRole('creator').surface).toBe('bg.surface');

    // Les trois diffèrent réellement : une matière partagée ne distinguerait
    // rien, et c'est la faute qu'on ne verrait pas sur une seule capture.
    const surfaces = (['creator', 'merchant', 'admin'] as const).map(
      (role) => couleurs[matiereDeRole(role).surface],
    );
    expect(new Set(surfaces).size).toBe(3);
  });

  it('l’encre de chaque matière tient dessus', () => {
    // L'administration est la seule dont le fond est sombre : son encre doit
    // être claire, sinon le rôle qu'on reconnaît d'un regard est illisible.
    expect(matiereDeRole('admin').texte).toBe('ink.onDark');
    expect(matiereDeRole('merchant').texte).toBe('ink.default');
    expect(matiereDeRole('creator').texte).toBe('ink.default');
  });

  it('plus aucune teinte de rôle dans les jetons', () => {
    // `role.creator` et `role.merchant` sont supprimés. Le fichier de jetons
    // garde une note à leur place : elle dit pourquoi, et où retrouver
    // l'alternative.
    expect(Object.keys(tokens.color.role)).toEqual(['$removed']);
    expect(couleurs).not.toHaveProperty('role.creator');
    expect(couleurs).not.toHaveProperty('role.merchant');
  });
});

describe('rôle et densité', () => {
  it('la densité reste celle du rôle', () => {
    // Un créateur parcourt, un commerce travaille au comptoir.
    expect(produit.density.creator.screenPadding).not.toBe(produit.density.merchant.screenPadding);
  });

  it.each([
    ['creator', '20', 'bg.surface'],
    ['merchant', '16', 'bg.page'],
    // L'administration n'a pas de densité propre : elle hérite de celle du
    // créateur, et c'est sa barre latérale qui la resserre.
    ['admin', '20', 'bg.inverse'],
  ] as const)('le rôle %s rend sa densité et sa matière', async (role, padding, surface) => {
    const vue = await render(
      <ThemeProvider role={role}>
        <Sonde />
      </ThemeProvider>,
    );

    await waitFor(() => expect(vue.getByText(role)).toBeTruthy());
    expect(vue.getByText(padding)).toBeTruthy();
    expect(vue.getByText(surface)).toBeTruthy();
  });

  it('un composant rendu hors du fournisseur lève', async () => {
    // Retomber sur des valeurs par défaut ferait perdre la densité du rôle
    // sans que personne ne s'en aperçoive avant une capture d'écran.
    const silence = jest.spyOn(console, 'error').mockImplementation(() => {});
    // `await` : sans lui, la promesse de l'assertion est jetée et le test
    // passe même si le rendu ne lève pas.
    await expect(() => render(<Sonde />)).rejects.toThrow(/ThemeProvider/);
    silence.mockRestore();
  });
});

// --------------------------------------------------------------------------
// surfaces
// --------------------------------------------------------------------------

describe('les surfaces de la v1.0', () => {
  it('les rayons sont tombés à trois, et le défaut est l’angle droit', () => {
    // « La mode ne s'arrondit pas, et le bloc plein ne fonctionne que
    // d'équerre. » Restent la vignette photo et la pilule des chips de filtre.
    expect(tokens.radius.none).toBe(0);
    expect(tokens.radius.photo).toBe(2);
    expect(tokens.radius.pill).toBe(999);
  });

  it('aucun rayon écrit en dur dans une source', () => {
    // Les 6, 8, 12 et 16 de la v0.4 disparaissent. Un `borderRadius: 12` oublié
    // dans un coin est le genre de détail qu'on ne voit qu'en comparant deux
    // cartes côte à côte, ce que personne ne fait.
    const fautifs: string[] = [];
    for (const chemin of sources(RACINE)) {
      const relatif = chemin.slice(chemin.indexOf('src/'));
      if (A_MIGRER.includes(relatif)) continue;
      readFileSync(chemin, 'utf-8')
        .split('\n')
        .forEach((ligne, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
          // Un nombre littéral, jamais un jeton : `radius['radius.photo']`
          // passe, `borderRadius: 12` non.
          if (/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*\d/.test(ligne)) {
            fautifs.push(`${relatif}:${index + 1} → ${ligne.trim()}`);
          }
        });
    }

    expect(fautifs).toEqual([]);
  });

  it('l’ombre de carte n’existe plus, et une seule ombre subsiste', () => {
    // `elevation.1` est supprimé : une carte se tient à son filet de 1 px.
    // Répétée sous chaque carte d'un fil, l'ombre faisait une nappe grise.
    expect(Object.keys(tokens.elevation).filter((cle) => !cle.startsWith('$'))).toEqual([
      '0',
      'float',
    ]);

    const fautifs = sources(RACINE)
      .filter((chemin) => !chemin.includes(join('src', 'theme')))
      .filter((chemin) =>
        readFileSync(chemin, 'utf-8')
          .split('\n')
          // Les commentaires citent le jeton supprimé en prose ; les compter
          // ferait crier la garde sur la documentation de sa propre règle.
          .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
          .some((ligne) => /useElevation|elevation\.1/.test(ligne)),
      );

    expect(fautifs).toEqual([]);
  });
});
