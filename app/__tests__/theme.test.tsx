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

import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { I18nProvider } from '../src/i18n';
import { StatusMessage } from '../src/components/StatusMessage';
import { ReglesDesPaliers } from '../src/screens/ReglesDesPaliers';
import { TitreAccentue } from '../src/components/TitreAccentue';

import {
  ThemeProvider,
  codeColors,
  couleurs,
  matiereDePalier,
  matiereDeRole,
  produit,
  tokens,
  collisionsDeCouches,
  typography,
  useTheme,
  type ColorName,
  type Palier,
  contraste,
  elevationDeCarte,
  luminance,
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
const A_MIGRER = ['src/screens/CameraScanner.tsx', 'src/screens/RedemptionScreen.tsx'];

function sources(dossier: string, trouves: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) sources(chemin, trouves);
    else if (/\.(ts|tsx)$/.test(entree)) trouves.push(chemin);
  }
  return trouves;
}

/**
 * La source, commentaires retirés.
 *
 * **Un filtre ligne à ligne ne suffit pas**, et c'est le défaut qu'une garde de
 * ce fichier vient d'avoir : la prose qui documente une règle cite forcément le
 * jeton qu'elle encadre, et dans un commentaire de bloc les lignes **de suite**
 * ne commencent ni par `//` ni par `*`. Le fichier était donc compté comme
 * peignant ce qu'il se contentait d'expliquer — et la correction naturelle est
 * de retirer la note, c'est-à-dire de perdre l'explication pour sauver la garde.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((ligne) => ligne.replace(/\/\/.*$/, ''))
    .join('\n');
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

/**
 * Les blocs `style={…}` d'une source, découpés sur leurs accolades.
 *
 * **Il y avait une fenêtre, et elle a fini par coûter quelque chose.** La garde
 * lisait un bloc sur neuf cents caractères — d'abord six cents, relevé une fois
 * quand deux cartes sont sorties de l'inventaire en silence. Le compte n'est
 * pas le bon réglage : c'est le principe qui est faux. Un bloc de style porte
 * des commentaires, des ternaires et des valeurs conditionnelles, et sa
 * longueur n'est bornée par rien. Quatre lignes de prose ajoutées dans le style
 * d'une carte de l'annuaire ont suffi à la faire disparaître de l'inventaire —
 * **sans erreur, sans avertissement**, la garde cessant simplement de la voir.
 *
 * Le découpage suit donc l'imbrication, comme celui des balises `Pressable` du
 * garde-fou du retour au toucher, et n'a plus de longueur maximale. Les deux
 * formes se traitent d'un coup : `style={{ … }}` referme sa paire d'accolades,
 * `style={({ pressed }) => ({ … })}` referme la sienne au même endroit — celle
 * ouverte juste après `style=`.
 *
 * **Les chaînes et les commentaires sont traversés sans être comptés**, et
 * l'ordre des deux importe. Une accolade dans un littéral décalerait le compte
 * et couperait le bloc au mauvais endroit. Mais la première version ne
 * traversait que les chaînes, et **une apostrophe française de commentaire —
 * « qu'elle se presse » — la faisait entrer en mode chaîne** : tout le reste du
 * bloc était alors avalé, et deux cartes du produit disparaissaient de
 * l'inventaire. C'est exactement le défaut que la garde des pronoms genrés a
 * eu la veille, où l'appariement des apostrophes du source se désynchronisait
 * sur les mêmes commentaires. Un commentaire se saute donc avant qu'on
 * regarde ses guillemets.
 */
export function blocsDeStyle(source: string): string[] {
  const blocs: string[] = [];
  const MARQUE = 'style={';

  for (let depart = source.indexOf(MARQUE); depart !== -1; depart = source.indexOf(MARQUE, depart + 1)) {
    let profondeur = 0;
    let citation: string | null = null;
    let i = depart + MARQUE.length - 1;

    for (; i < source.length; i += 1) {
      const car = source[i];

      if (citation) {
        if (car === '\\') i += 1;
        else if (car === citation) citation = null;
        continue;
      }

      // Les commentaires d'abord : leur contenu n'est ni du code ni une
      // chaîne, et une apostrophe française y est une lettre.
      if (car === '/' && source[i + 1] === '/') {
        const finDeLigne = source.indexOf('\n', i);
        i = finDeLigne === -1 ? source.length : finDeLigne;
        continue;
      }
      if (car === '/' && source[i + 1] === '*') {
        const fin = source.indexOf('*/', i + 2);
        i = fin === -1 ? source.length : fin + 1;
        continue;
      }

      if (car === "'" || car === '"' || car === '`') {
        citation = car;
        continue;
      }
      if (car === '{') profondeur += 1;
      else if (car === '}') {
        profondeur -= 1;
        if (profondeur === 0) break;
      }
    }

    if (profondeur === 0) blocs.push(source.slice(depart, i + 1));
  }

  return blocs;
}

describe('la définition d’une carte', () => {
  const estUneCarte = (b: string) =>
    b.includes('radius.lg') &&
    b.includes('bg.surface') &&
    !(b.includes("overflow: 'hidden'") && !b.includes('elevationDeCarte()'));

  const bloc = (interieur: string) => `style={{ ${interieur} }}`;
  const SURFACE = "borderRadius: radius['radius.lg'], backgroundColor: c['bg.surface']";

  it('prend une surface pleine, sans filet', () => {
    // **Le trou que la définition laissait.** Elle exigeait rayon + fond +
    // filet ; une surface pleine est une carte tout autant qu'une surface
    // cerclée, et c'est même la plus visible des deux — rien d'autre que son
    // ombre ne la détache du fond.
    expect(estUneCarte(bloc(SURFACE))).toBe(true);
    expect(estUneCarte(bloc(`${SURFACE}, borderWidth: 1`))).toBe(true);
  });

  it('ne compte pas deux fois une carte qui enveloppe', () => {
    // **La raison pour laquelle le filet avait été exigé.** Une carte qui
    // clippe s'écrit en deux nœuds : sur iOS, une vue qui clippe coupe sa
    // propre ombre. Sans discriminant, les deux satisfaisaient la définition et
    // une carte comptait pour deux — le comptage d'égalité devenait faux, et
    // l'élargissement a été reculé deux fois pour ça.
    const enveloppe = bloc(`${SURFACE}, ...elevationDeCarte()`);
    const interieur = bloc(`${SURFACE}, borderWidth: 1, overflow: 'hidden'`);

    expect(estUneCarte(enveloppe)).toBe(true);
    // La moitié intérieure ne réclame pas d'ombre : la sienne vit sur son
    // enveloppe. C'est la divergence qui fait tenir le comptage.
    expect(estUneCarte(interieur)).toBe(false);
  });

  it('garde un nœud unique qui clippe et porte son ombre', () => {
    // La question n'est pas « clippe-t-il » mais « porte-t-il l'ombre ». Hors
    // iOS le cas courant est un seul nœud qui fait les deux, et l'exclure
    // rendrait le compte faux dans l'autre sens.
    expect(estUneCarte(bloc(`${SURFACE}, overflow: 'hidden', ...elevationDeCarte()`))).toBe(true);
  });

  it('ne prend pas une pastille qui porte un rayon de carte', () => {
    // `KeyHint` portait `radius.lg` sur quatorze points de haut. À cette taille
    // les deux rayons se ressemblent à l'œil, ce qui est pourquoi le mauvais a
    // survécu — mais l'inventaire le comptait comme une surface devant porter
    // une ombre. Le jeton corrigé, il sort de lui-même.
    expect(estUneCarte(bloc("borderRadius: radius['radius.sm'], backgroundColor: c['bg.surface']"))).toBe(false);
  });
});

describe('le découpage des blocs de style', () => {
  /** Une carte, avec de quoi faire dérailler un découpage naïf. */
  const carte = (interieur: string) =>
    `<View style={{ borderRadius: radius['radius.lg'], backgroundColor: c['bg.surface'], borderWidth: 1,${interieur} }}>`;

  const estUneCarte = (b: string) =>
    b.includes('radius.lg') && b.includes('bg.surface') && b.includes('borderWidth');

  it('voit une carte que la fenêtre de neuf cents caractères manquait', () => {
    // **Le cas qui a coûté quelque chose.** Quatre lignes de prose dans le
    // style d'une carte de l'annuaire l'ont fait sortir de l'inventaire, sans
    // erreur ni avertissement. La divergence est écrite ici : la même carte,
    // avec un commentaire assez long pour dépasser l'ancienne borne.
    const longue = carte(`\n// ${'x'.repeat(1200)}\n`);

    expect(longue.length).toBeGreaterThan(900);
    expect(/style=\{\{[\s\S]{0,900}?\}\}/.test(longue)).toBe(false);
    expect(blocsDeStyle(longue).filter(estUneCarte)).toHaveLength(1);
  });

  it('ne se laisse pas ouvrir par une apostrophe de commentaire', () => {
    // **La faute de ma première version**, et la même que celle de la garde des
    // pronoms la veille : traverser les chaînes sans traverser les commentaires
    // fait entrer en mode chaîne sur « qu'elle », et tout le bloc est avalé.
    const avecApostrophe = carte("\n// le style fonction, parce qu'elle se presse\n");

    expect(blocsDeStyle(avecApostrophe).filter(estUneCarte)).toHaveLength(1);
  });

  it('compte les accolades imbriquées jusqu’à la bonne', () => {
    // Un `shadowOffset` referme une accolade au milieu : couper là rendrait un
    // fragment sans `borderWidth`, donc une carte invisible.
    const imbrique =
      "<View style={{ borderRadius: radius['radius.lg'], shadowOffset: { width: 0, height: 2 }, backgroundColor: c['bg.surface'], borderWidth: 1 }}>";

    const [vu] = blocsDeStyle(imbrique);
    expect(estUneCarte(vu)).toBe(true);
    expect(vu.endsWith('}}')).toBe(true);
  });

  it('ne compte pas une accolade prise dans une chaîne', () => {
    // **L'accolade littérale vient avant `borderWidth`, et c'est le décor qui
    // compte.** Placée après les trois marques, la troncature les laisserait
    // toutes dans le fragment : la carte resterait vue, et la mutation qui
    // retire la traversée des chaînes survivrait. Il faut qu'elle coupe **entre**
    // deux marques pour que les deux implémentations divergent.
    // Deux accolades et non une : à l'intérieur de `style={{`, la profondeur
    // vaut deux, et une seule fermante la ramène à un sans rien couper. Le
    // décor doit refermer **jusqu'à zéro** pour que la troncature ait lieu.
    const avecLitteral =
      "<View style={{ borderRadius: radius['radius.lg'], alt: '}}', backgroundColor: c['bg.surface'], borderWidth: 1 }}>";

    expect(blocsDeStyle(avecLitteral).filter(estUneCarte)).toHaveLength(1);
  });

  it('prend les deux formes de style, objet et fonction', () => {
    const fonction =
      "<Pressable style={({ pressed }) => ({ borderRadius: radius['radius.lg'], backgroundColor: c['bg.surface'], borderWidth: 1, opacity: pressed ? 0.7 : 1 })}>";

    expect(blocsDeStyle(fonction).filter(estUneCarte)).toHaveLength(1);
    expect(blocsDeStyle(carte('')).filter(estUneCarte)).toHaveLength(1);
  });
});

describe('jetons', () => {
  it('chaque valeur de la passation est celle de l’app, sans retouche', () => {
    // **L'égalité profonde a cédé à l'inclusion, et il faut dire pourquoi.**
    // Le fichier de Design décrit un système ; celui de l'app fait tourner un
    // produit, et il porte six sections dont Design ne parle pas — `theme`,
    // `font`, `space`, `motion`, `pattern`, `blockRule`. Exiger l'égalité
    // obligeait à faire entrer ces sections dans la passation, c'est-à-dire à
    // demander au designer de maintenir des durées d'animation.
    //
    // Ce qui est gardé est ce qui comptait : **toute valeur que Design énonce
    // est celle de l'app.** Le retranscrire créerait une seconde vérité, et
    // c'est la seconde qu'on oublie de mettre à jour.
    const app = JSON.parse(readFileSync(join(RACINE, 'theme', 'tokens.json'), 'utf-8'));
    const passation = JSON.parse(readFileSync(PASSATION, 'utf-8'));

    const ecarts: string[] = [];
    const comparer = (attendu: unknown, obtenu: unknown, chemin: string) => {
      // Les clés en `$` documentent ; elles se relisent, elles ne s'exécutent pas.
      if (chemin.split('.').some((part) => part.startsWith('$'))) return;
      if (attendu !== null && typeof attendu === 'object') {
        if (obtenu === undefined) return void ecarts.push(`${chemin} : absent de l'app`);
        for (const [cle, valeur] of Object.entries(attendu)) {
          comparer(valeur, (obtenu as Record<string, unknown>)[cle], `${chemin}.${cle}`);
        }
        return;
      }
      if (obtenu !== attendu) ecarts.push(`${chemin} : passation ${attendu}, app ${obtenu}`);
    };
    comparer(passation, app, 'tokens');

    expect(ecarts).toEqual([]);
  });

  it('et l’app n’invente aucune couleur que la passation ne déclare pas', () => {
    // **Le sens inverse, sans lequel l'inclusion ne vaudrait rien.** Sans lui,
    // un `brand.550` ajouté côté produit passerait : la passation resterait
    // incluse, et le système aurait gagné une valeur que personne n'a dessinée.
    const app = JSON.parse(readFileSync(join(RACINE, 'theme', 'tokens.json'), 'utf-8'));
    const passation = JSON.parse(readFileSync(PASSATION, 'utf-8'));
    const sansDoc = (o: object) => Object.keys(o).filter((k) => !k.startsWith('$'));

    for (const famille of ['brand', 'bg', 'ink', 'line'] as const) {
      expect(sansDoc(app.color[famille])).toEqual(sansDoc(passation.color[famille]));
    }
    expect(sansDoc(app.radius)).toEqual(sansDoc(passation.radius));
    expect(sansDoc(app.type)).toEqual(sansDoc(passation.type));
  });

  it('c’est bien la v1.1 · Ambre qui est en place', () => {
    // Une assertion de volume, comme sur l'inventaire des routes publiques :
    // sans elle, un fichier vidé des deux côtés passerait le test précédent
    // sans rien prouver.
    expect(tokens.$meta.name).toBe('BIND · direction B · Ambre (v1.1)');
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

  it('la matière des paliers est celle de `components.md` §2', () => {
    // **La table d'hexadécimaux a disparu, et ce test change donc d'oracle.**
    // Il comparait `matiereDePalier` à `tokens.color.tier`, qui recopiait la
    // rampe en valeurs — `#A83E06` pour le 700. Cette recopie était une seconde
    // vérité : au passage à l'ambre elle serait restée à l'orange brut, et le
    // test aurait constaté que les deux mensonges concordaient.
    //
    // L'oracle est maintenant la table de `components.md` §2, recopiée ici à la
    // main. C'est ce qui en fait un oracle : la dériver des jetons qu'elle
    // vérifie la rendrait d'accord avec eux quoi qu'ils disent.
    const attendu: Record<Palier, { surface: string; texte: string; barres: number }> = {
      story: { surface: 'bg.surface', texte: 'brand.700', barres: 1 },
      post: { surface: 'brand.100', texte: 'brand.700', barres: 2 },
      reel: { surface: 'brand.500', texte: 'ink.onBrand', barres: 3 },
    };

    for (const palier of ['story', 'post', 'reel'] as Palier[]) {
      const m = matiereDePalier(palier);
      expect({ palier, surface: m.surface, texte: m.texte, barres: m.barresPleines }).toEqual({
        palier,
        ...attendu[palier],
      });
    }
  });

  it('et les trois restent distinctes en niveaux de gris', () => {
    // Le sens inverse, et la seule propriété qui compte vraiment : la
    // progression est ordinale. Trois surfaces de luminance croissante — papier,
    // teinte, aplat — se lisent sans couleur. C'est ce qu'aucune palette ne doit
    // casser, et ce qu'une rampe mal choisie casserait en silence.
    const gris = (nom: Palier) => luminance(couleurs[matiereDePalier(nom).surface]);
    expect(gris('story')).toBeGreaterThan(gris('post'));
    expect(gris('post')).toBeGreaterThan(gris('reel'));
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
    expect(A_MIGRER).toHaveLength(2);

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
    // **Depuis son module et non depuis le baril.** `../src/components`
    // réexporte la bibliothèque entière : demander `Texte` par là chargeait une
    // trentaine de modules pour en utiliser un, et c'est le premier rendu du
    // fichier qui payait la facture. Sur le poste ça se voit à peine — 286 ms —
    // et en intégration continue, sous parallélisme, la garde de durée l'a
    // relevé à 7,1 s. Le seuil n'était pas trop bas : le test faisait vraiment
    // ce travail.
    const { Texte } = require('../src/components/Texte');
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
    expect(opaciteMinimaleDuVoile('ink.onScrimMuted')).toBeCloseTo(0.714, 2);
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
  it('aucune variante ne demande une famille que le système ne charge pas', () => {
    // **Le plancher du Didone n'existe plus, et ce test le remplace.** Il
    // vérifiait qu'aucun serif ne descendait sous 34 px ; il n'y a plus de
    // serif, donc il ne pouvait plus tomber — un test qui ne peut plus échouer
    // est un test qui a fini de servir. Ce qui reste vrai est ailleurs : une
    // variante ne peut demander qu'un rôle que `polices.ts` sait charger.
    const roles = new Set(['display', 'sans', 'mono']);
    const fautives = Object.entries(typography)
      .filter(([, echelle]) => !roles.has(echelle.fontFamily))
      .map(([nom, echelle]) => `${nom} → ${echelle.fontFamily}`);

    expect(fautives).toEqual([]);
  });

  it('et l’accent est disponible à toutes les tailles, ce qui est le gain', () => {
    // La v1.0 devait refuser l'accent sous 34 px et retomber sur une autre
    // fonte : l'accent était un changement de FAMILLE. Il est devenu une
    // GRAISSE, donc il tient partout — et les deux paires le prouvent en
    // partageant taille et famille, et en ne différant que par le poids.
    for (const [base, accent] of [
      ['type.display', 'type.displayAccent'],
      ['type.heading', 'type.headingAccent'],
    ] as const) {
      expect(typography[accent].fontSize).toBe(typography[base].fontSize);
      expect(typography[accent].fontFamily).toBe(typography[base].fontFamily);
      expect(Number(typography[accent].fontWeight)).toBeGreaterThan(
        Number(typography[base].fontWeight),
      );
    }
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
    // La v1.0 gardait une section `color.role` réduite à une note. La v1.1 de
    // Design ne la porte plus du tout : la note a fini par ne plus être lue, et
    // une section vide finit toujours par se remplir. Ce qui est gardé est le
    // fait, pas le mémorial.
    expect(tokens.color).not.toHaveProperty('role');
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

describe('les surfaces de la v1.1', () => {
  it('l’échelle des rayons est par rôle, et `none` est réservé au bloc', () => {
    // **La raison de la v1.0 est remplacée, pas conservée à côté de son
    // contraire.** « Le bloc plein ne fonctionne que d'équerre » était vrai du
    // bloc et faux du reste ; elle avait été généralisée à tort. Le bloc orange
    // reste d'équerre — un aplat de marque arrondi devient un bouton — et tout
    // le reste s'arrondit.
    expect(tokens.radius).toMatchObject({
      none: 0, sm: 10, md: 14, lg: 18, xl: 24, photo: 16, pill: 999,
    });
    // La vignette photo passe de 2 à 16 : ce n'était pas un adoucissement, le 2
    // servait seulement à ne pas avoir l'air d'un accident.
    expect(tokens.radius.photo).toBeGreaterThan(tokens.radius.sm);
  });

  it('et `radius.none` n’est employé que par le bloc accentué', () => {
    // Le sens inverse. Sans lui, « none est réservé au bloc » serait une phrase
    // dans un fichier de jetons — la seule chose qui l'empêche d'être reprise
    // ailleurs par commodité est ce test.
    const fautifs: string[] = [];
    for (const chemin of sources(RACINE)) {
      const relatif = chemin.slice(chemin.indexOf('src/'));
      // **Trois exceptions, et chacune porte sa raison.** Le bloc accentué,
      // parce qu'un aplat de marque arrondi devient un bouton. Le thème,
      // parce qu'il déclare le jeton. Et les deux surfaces que
      // `components.md` §10 met **explicitement hors système** — la galerie et
      // la visionneuse : ce qu'on y regarde est la photo, et un cadre arrondi
      // par-dessus le travail d'un salon est une opinion de plus.
      const horsSysteme = ['GalerieDuCommerce', 'Visionneuses'];
      if (
        relatif.includes('TitreAccentue') ||
        relatif.includes('src/theme/') ||
        horsSysteme.some((nom) => relatif.includes(nom))
      ) {
        continue;
      }
      readFileSync(chemin, 'utf-8').split('\n').forEach((ligne, i) => {
        if (/radius\['radius\.none'\]|radius\.none/.test(ligne)) {
          fautifs.push(`${relatif}:${i + 1}`);
        }
      });
    }
    expect(fautifs).toEqual([]);
  });

  it('et le bloc accentué, lui, le porte vraiment', async () => {
    // **La direction qui manquait, et qui a coûté l'arrondi du bloc.** Les deux
    // tests au-dessus disent « none vaut 0 » et « personne d'autre ne s'en
    // sert » ; aucun ne dit que le bloc s'en sert. La bascule Ambre a arrondi
    // les 66 sites du produit, celui-ci compris, et les deux gardes sont
    // restées vertes — la première parce que le jeton existait toujours, la
    // seconde parce qu'elle ne sait qu'interdire. Une contrainte se teste dans
    // les deux sens : celle qui n'interdit que le mauvais côté laisse passer
    // l'oubli du bon.
    //
    // Sur le rendu et non sur le texte du fichier : une recherche de
    // `radius.none` dans `TitreAccentue.tsx` passerait sur le commentaire qui
    // en parle. C'est ce que le style calculé porte qui décide.
    const vue = await render(
      <ThemeProvider role="creator">
        <TitreAccentue texte="Talent by Bind" motAccentue="Bind" bloc />
      </ThemeProvider>,
    );
    const style = vue.getByTestId('bloc-accentue').props.style;
    expect(style.borderRadius).toBe(0);
    expect(style.backgroundColor).toBe(tokens.color.brand['500']);
  });

  it('`elevation.card` lit son jeton, et les valeurs sortent de la déclaration', () => {
    // La lecture, séparée de la pose. La valeur est relue ici depuis la
    // déclaration CSS et non empruntée à la fonction : comparer la fonction à
    // elle-même les laisserait se tromper ensemble.
    const attendue = elevationDeCarte() as Record<string, unknown>;
    const [, hauteur, flou, opacite] =
      /^0 (\d+)px (\d+)px rgba\([^)]*,\s*([\d.]+)\)$/.exec(tokens.elevation.card)!;

    if ('boxShadow' in attendue) {
      expect(attendue.boxShadow).toBe(tokens.elevation.card);
    } else {
      expect(attendue.shadowOffset).toEqual({ width: 0, height: Number(hauteur) });
      expect(attendue.shadowRadius).toBe(Number(flou));
      expect(attendue.shadowOpacity).toBe(Number(opacite));
    }
  });

  it('et les douze cartes du produit la portent, sans exception', () => {
    // **La règle vient avec les rayons, elle ne se décide pas par écran.** « Un
    // coin de 18 px sans ombre flotte au lieu de se poser » vaut des douze
    // surfaces qui portent ce rayon, pas d'une seule. Une carte, ici, c'est
    // trois choses ensemble : un fond de surface, un rayon de 18, un filet.
    //
    // **L'inventaire est exact, et c'est tout son emploi.** Une carte de plus
    // oblige à toucher cette liste, donc à se demander si elle se pose ou si
    // elle flotte. Sans lui, la règle s'effriterait surface par surface sans
    // qu'aucun test ne bouge — c'est exactement comment elle avait disparu la
    // première fois, quand le seul composant qui la portait a été retiré.
    const CARTES = [
      'src/components/EnTete.tsx',
      // La carte d'un plan souscriptible : elle se pose sur la page comme
      // une carte, donc elle porte l'ombre comme une carte.
      'src/screens/AbonnementScreen.tsx',
      'src/screens/AnnuaireScreen.tsx',
      // **Les deux surfaces de l'audience v3, et une contradiction tranchée
      // ici.** La planche oppose « une carte à ombre » pour un compte
      // connecté à « une ligne à filet » pour un compte à connecter, la forme
      // disant l'état avant le mot. Mais la ligne qu'elle dessine porte les
      // trois marques d'une carte — fond de surface, rayon de 18, filet — et
      // la règle des rayons ne souffre pas d'exception par écran : c'est
      // exactement ainsi qu'elle avait disparu la première fois. L'ombre est
      // donc posée sur les deux, et la distinction tient à ce qui reste et qui
      // suffit : la carte fait cinq blocs de haut et porte un chiffre de 32,
      // la ligne fait quarante-quatre points et porte un bouton.
      'src/screens/AudienceScreen.tsx',

      'src/screens/CarteDuCommerce.tsx',
      // Les deux portes de l'accueil : des surfaces pleines, sans filet. Elles
      // échappaient à l'inventaire tant qu'il exigeait le filet — et ce sont
      // les cartes les plus visibles du produit, puisque rien d'autre que leur
      // ombre ne les détache du fond.
      'src/screens/ChoixDeLaPorte.tsx',
      // Le panneau du jour sans place, arrivé avec le créneau v3. Il se pose
      // sur la page comme une carte, donc il porte l'ombre comme une carte.
      // Les trois entrées ci-dessous sont arrivées avec l'élargissement de la
      // garde aux styles fonction : leurs cartes sont pressables, donc elles
      // lui échappaient. Elles portaient l'ombre depuis toujours ; ce n'est pas
      // une correction de rendu, c'est une correction d'inventaire.
      'src/screens/CreneauxScreen.tsx',
      // La liste des favoris : chaque ligne se pose sur la page comme une
      // carte, donc elle porte l'ombre comme une carte.
      'src/screens/FavorisScreen.tsx',
      'src/screens/FiabiliteScreen.tsx',
      'src/screens/FicheScreen.tsx',
      'src/screens/HistoriqueScreen.tsx',
      // La carte de demande de la journée v3. La première section reprend le
      // relief que la campagne 2 avait retiré à toute la colonne : une demande
      // se soupèse, le planning se parcourt.
      'src/screens/JourneeScreen.tsx',
      // Les groupes du menu du commerce. La planche v6 les dessine en filet
      // seul ; ils portent les trois marques d'une carte et se posent sur la
      // page, donc ils portent l'ombre — même arbitrage que l'audience v3.
      'src/screens/MenuDuCommerce.tsx',
      // La relecture d'une carte importée : une ligne lue est une carte, et
      // elle l'est devenue en quittant les couleurs écrites à la main.
      'src/screens/MenuReviewScreen.tsx',
      'src/screens/PaliersScreen.tsx',
      'src/screens/PriseEnMainScreen.tsx',
      'src/screens/PublicationsScreen.tsx',
      'src/screens/RedemptionScreen.tsx',
      'src/screens/ReglesDesPaliers.tsx',
      'src/screens/TerrainScreen.tsx',
      // Le bloc d'engagement du créneau v3. La planche le dessine sans ombre ;
      // la règle des rayons est catégorique, et un écart par écran est
      // exactement ce que l'inventaire existe pour empêcher.
      'src/screens/creneau/Engagement.tsx',
      // Le bloc d'exception du jour : il se pose sur la journée comme une
      // carte, donc il porte l'ombre comme une carte.
      // La ligne de confirmation des sept premiers jours : une surface posée
      // sur la page, donc une carte.
      // **`BandeauDeMiseEnLigne` sort de l'inventaire**, et c'est le bandeau
      // « vous êtes en ligne » qui l'y tenait : lui seul portait une carte. Il
      // part à la quatrième reprise de la journée. Ce qui reste — ce qui manque
      // avant publication, la suspension — est un bloc d'encre pleine, qui n'est
      // pas une carte et n'a jamais porté d'ombre.
      'src/screens/journee/ExceptionDuJour.tsx',
      // Le panneau du contrat de la preuve v3 : ce que le commerce attend,
      // posé sur l'écran où l'on publie.
      'src/screens/preuve/ContratDeLaPreuve.tsx',
      // La liste des premiers pas, quand les rapports n'ont rien à rapporter :
      // l'écran change de nature, et sa liste est une carte.
      'src/screens/rapports/PremiersPas.tsx',
      // La feuille d'annulation. Elle sort par le bas et non de la page, mais
      // elle porte les trois marques d'une carte — et la règle des rayons ne
      // souffre pas d'exception par écran, c'est ainsi qu'elle avait disparu
      // la première fois. Au bord haut, l'ombre la détache du voile.
      'src/screens/reservations/AnnulerLaReservation.tsx',
    ];

    // **La fenêtre est à 900 et non à 600, et ce n'est pas un réglage.** Un
    // bloc de style porte des commentaires, des ternaires et des valeurs
    // conditionnelles ; deux des douze dépassaient six cents caractères et
    // sortaient de l'inventaire en silence — la liste rétrécissait toute seule,
    // ce qui est le contraire de ce qu'elle sert à faire. Le plus long des
    // douze en fait 780. Une garde qui ne voit qu'une partie de ce qu'elle
    // prétend couvrir est pire qu'aucune.
    // **Les deux formes d'un style, et la seconde manquait.** La garde ne
    // lisait que `style={{ … }}`. Or une carte pressable s'écrit
    // `style={({ pressed }) => ({ … })}` — c'est la forme canonique du retour
    // au toucher — et trois cartes du produit lui échappaient en silence : les
    // réservations, les paliers, et le contrôle des publications qui vient de
    // s'y ajouter. Une garde d'inventaire qui ne voit pas les cartes pressables
    // ne protège que les cartes inertes, c'est-à-dire les moins nombreuses.
    //
    // Élargir plutôt qu'inscrire l'exception : ajouter le fichier à la liste
    // aurait ajusté la règle à la première carte qu'elle rencontre, ce qui est
    // exactement l'érosion que l'inventaire existe pour empêcher.
    const blocsDe = blocsDeStyle;

    /**
     * **Une carte est une surface de 18 points, avec ou sans filet.**
     *
     * La définition exigeait les trois marques — rayon, fond, **filet** — et le
     * filet laissait passer tout ce qui est plein : les deux portes de
     * l'accueil, le panneau reconnu de la caisse. Une surface pleine est une
     * carte tout autant qu'une surface cerclée ; c'est même la plus visible des
     * deux, puisque rien d'autre ne la détache du fond que son ombre.
     *
     * **Le filet a été exigé pour une raison, et elle a une meilleure
     * réponse.** Une carte qui clippe s'écrit en deux nœuds — l'extérieur porte
     * l'ombre, l'intérieur découpe, parce que sur iOS une vue qui clippe coupe
     * sa propre ombre. Sans le filet dans la définition, les deux nœuds la
     * satisfaisaient et une carte comptait pour deux : le comptage d'égalité
     * devenait faux, et l'élargissement a été reculé deux fois pour ça.
     *
     * La bonne question n'était pas « lequel des deux est le parent » mais
     * **« lequel des deux porte l'ombre »**. La moitié intérieure est celle qui
     * clippe **sans** porter d'élévation : son ombre vit sur son enveloppe, et
     * elle n'a pas à en réclamer une. Un nœud unique qui clippe *et* porte son
     * ombre reste une carte — c'est le cas courant hors iOS, et il compte.
     */
    const estUneCarte = (b: string) =>
      b.includes('radius.lg') &&
      b.includes('bg.surface') &&
      !(b.includes("overflow: 'hidden'") && !b.includes('elevationDeCarte()'));

    const trouves = new Set<string>();
    for (const chemin of sources(RACINE)) {
      const relatif = chemin.slice(chemin.indexOf('src/'));
      const source = readFileSync(chemin, 'utf-8');
      if (blocsDe(source).some(estUneCarte)) trouves.add(relatif);
    }

    expect([...trouves].sort()).toEqual(CARTES);

    // **Et chacune la consomme, comptée et non cherchée.** La première version
    // demandait si le fichier *contenait* `elevationDeCarte` : la ligne
    // d'import suffisait à la satisfaire, et retirer l'ombre de la carte
    // laissait la garde verte. La mutation l'a dit, la relecture non.
    //
    // On compte donc les poses et les cartes, et on exige l'égalité. Une pose
    // qui disparaît fait un compte de moins ; une carte ajoutée sans ombre fait
    // un compte de plus. Les trois surfaces qui clippent posent leur ombre sur
    // une vue extérieure qui n'est pas une carte — un appel, une carte : le
    // compte tient aussi pour elles.
    for (const relatif of CARTES) {
      const source = readFileSync(join(RACINE, '..', relatif), 'utf-8');
      // **L'appel, et non l'étalement.** La première version cherchait
      // `...elevationDeCarte()` : la fiche pose son ombre dans un ternaire —
      // une prestation ouverte se pose, une fermée porte un filet — et l'appel
      // n'y est pas précédé de trois points. Il était compté zéro sur une carte
      // qui la porte. Chercher l'appel couvre les deux formes, et la ligne
      // d'import ne le mime pas : elle n'a pas de parenthèses.
      const poses = (source.match(/elevationDeCarte\(\)/g) ?? []).length;
      const cartes = blocsDe(source).filter(estUneCarte).length;
      expect({ relatif, poses, cartes }).toEqual({ relatif, poses: cartes, cartes });
    }
  });

  it('et celles qui clippent la portent sur la vue du dessus', async () => {
    // **La moitié que le texte du fichier ne peut pas dire.** Les trois
    // surfaces qui clippent — la carte de palier et les deux blocs des règles —
    // ne peuvent pas porter leur propre ombre : sur iOS, une vue qui clippe la
    // coupe au même bord. Le fichier contient bien `elevationDeCarte`, et le
    // test au-dessus est satisfait, y compris si l'ombre est posée sur le
    // mauvais nœud. C'est un rendu qui le dit.
    const vue = await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          {/* L'écran entier plutôt que le bloc : celui-ci n'est pas exporté,
              et l'exporter pour un test ouvrirait la bibliothèque sur un
              détail interne. La composition réelle est ce qu'on veut lire. */}
          <ReglesDesPaliers
            fiabilite={{ reliability_score: '82', completed_collabs_count: 4, composantes: [] }}
          />
        </ThemeProvider>
      </I18nProvider>,
    );

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    const carte = vue.getByTestId('bloc-fiabilite');
    const dehors = aplati(carte.parent?.props?.style);
    const dedans = aplati(carte.props.style);

    expect(dehors).toMatchObject(elevationDeCarte() as Record<string, unknown>);
    expect(dedans.overflow).toBe('hidden');
    expect(dedans.shadowOpacity ?? dedans.boxShadow).toBeUndefined();
  });

  it('aucun serrage négatif sous 22 points', () => {
    // **Un serrage tient un grand chiffre ensemble ; petit, il ferme des
    // contreformes déjà compactes.** Deux captures d'iPhone l'ont montré mieux
    // qu'aucune relecture. Il reste sur le display et les titres, où la taille
    // lui donne de quoi mordre — et 22 est la borne, `section` la garde.
    //
    // La règle est ici parce qu'elle s'efface autrement sans qu'on la voie :
    // une approche se repose pas à pas, échelon par échelon, et c'est ainsi que
    // les règles de ce système ont déjà disparu une fois.
    const jetons = JSON.parse(readFileSync(join(RACINE, 'theme', 'tokens.json'), 'utf-8'));
    const produit = JSON.parse(readFileSync(join(RACINE, 'theme', 'produit.json'), 'utf-8'));

    const fautifs: string[] = [];
    for (const [nom, pas] of Object.entries({ ...jetons.type, ...produit.type })) {
      const echelon = pas as { size?: number; tracking?: string };
      if (echelon.size === undefined || echelon.tracking === undefined) continue;
      const em = /^(-?[\d.]+)em$/.exec(echelon.tracking);
      if (em && Number(em[1]) < 0 && echelon.size < 22) {
        fautifs.push(`${nom} — ${echelon.size} px, ${echelon.tracking}`);
      }
    }
    expect(fautifs).toEqual([]);
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

  it('l’ombre de carte est revenue, et il y en a deux', () => {
    // **La suppression de la v1.0 est annulée, et sa raison avec.** « Une carte
    // se tient à son filet » était vrai à l'angle droit et faux à 18 px : un
    // coin arrondi sans ombre flotte au lieu de se poser. Une seule valeur, et
    // jamais cumulée avec un filet fort.
    expect(Object.keys(tokens.elevation).filter((cle) => !cle.startsWith('$'))).toEqual([
      'overlay',
      'card',
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

// --------------------------------------------------------------------------
// les trois réserves mesurées de la v1.1
// --------------------------------------------------------------------------

/**
 * Design en nomme trois, et une phrase dans un fichier de jetons ne protège
 * rien. Chacune devient ici une mesure, recalculée depuis les hexadécimaux :
 * si la rampe bouge, c'est le test qui le dit, pas la relecture.
 */
describe('les réserves de la v1.1', () => {
  const rapport = (devant: string, derriere: string) =>
    contraste(luminance(devant), luminance(derriere));

  it('`ink.mute` passe sur la page et la surface, et échoue sur le creux', () => {
    // **La seule paire de la table qui passe sur deux fonds et tombe sur le
    // troisième.** C'est ce qui la rend dangereuse : elle marche partout où on
    // l'essaie d'abord. Sur `bg.inset`, on descend à `ink.soft`.
    expect(rapport(couleurs['ink.mute'], couleurs['bg.page'])).toBeGreaterThanOrEqual(4.5);
    expect(rapport(couleurs['ink.mute'], couleurs['bg.surface'])).toBeGreaterThanOrEqual(4.5);
    expect(rapport(couleurs['ink.mute'], couleurs['bg.inset'])).toBeLessThan(4.5);

    // Et le repli tient, sans quoi la réserve n'aurait pas d'issue.
    expect(rapport(couleurs['ink.soft'], couleurs['bg.inset'])).toBeGreaterThanOrEqual(4.5);
  });

  it('`brand.700` passe de peu sur le creux, et pas assez pour 11 px', () => {
    // 4,56:1 — au-dessus du seuil, avec 1,3 % de marge. Admis en corps normal,
    // évité sous 13 px : c'est la réserve écrite, et elle vaut pour le badge de
    // palier comme pour l'étiquette.
    const surCreux = rapport(couleurs['brand.700'], couleurs['bg.inset']);
    expect(surCreux).toBeGreaterThanOrEqual(4.5);
    expect(surCreux).toBeLessThan(5);

    // Là où il a de la marge, il en a vraiment : la réserve est propre au creux.
    expect(rapport(couleurs['brand.700'], couleurs['bg.surface'])).toBeGreaterThan(5);
  });

  it('le point du logo est admis sur la page, et invisible sur l’orange', () => {
    // **Une règle de pose, pas de palette.** 2,89:1 sur la page est trois
    // centièmes sous le 3,00 d'un élément graphique : admis parce que le point
    // n'est jamais seul — les lettres portent 17:1 et donnent la forme. Sur un
    // aplat de marque, en revanche, il disparaît.
    const signature = tokens.logo.signature;
    expect(rapport(signature, couleurs['bg.page'])).toBeGreaterThan(2.8);
    expect(rapport(signature, couleurs['bg.surface'])).toBeGreaterThanOrEqual(3);
    expect(rapport(signature, couleurs['brand.500'])).toBeLessThan(1.5);
  });

  it('l’avertissement n’a pas de teinte : ce sont les neutres du système', () => {
    // **La règle survit au changement de palette, et le changement la rend plus
    // nécessaire.** Un ambre d'alerte dans un système ambre se lit comme une
    // mise en avant de marque, pas comme une alerte — c'est le seul des trois
    // niveaux dont la couleur habituelle est devenue la couleur de la marque.
    //
    // Le test ne mesure pas une saturation, il vérifie une **identité** : les
    // trois valeurs sont des jetons neutres du système, pas des teintes
    // proches. Une mesure de saturation laisserait passer un ambre désaturé,
    // qui est exactement la façon dont la teinte reviendrait.
    expect(tokens.color.status.warning).toEqual({
      surface: tokens.color.bg.inset,
      rule: tokens.color.ink.default,
      text: tokens.color.ink.default,
    });

    // Et les deux autres niveaux gardent la leur : « sans teinte » est une
    // règle de l'avertissement, pas du bloc de statut. Le vérifier ici empêche
    // de « corriger » les trois d'un coup.
    expect(tokens.color.status.danger.text).not.toBe(tokens.color.ink.default);
    expect(tokens.color.status.success.text).not.toBe(tokens.color.ink.default);
  });

  it('et le bouton porte l’encre, jamais le blanc, à toute taille', () => {
    // La mesure qui survit à la palette : les quatre oranges de ce projet se
    // comportent pareil. Un orange assez sombre pour porter du blanc n'est plus
    // un orange de marque.
    expect(rapport(couleurs['ink.onBrand'], couleurs['brand.500'])).toBeGreaterThanOrEqual(4.5);
    expect(rapport('#FFFFFF', couleurs['brand.500'])).toBeLessThan(3);

    // L'appui est lisible ET visible — c'est ce qui a fait retenir l'ambre.
    expect(rapport(couleurs['ink.onBrand'], couleurs['brand.600'])).toBeGreaterThanOrEqual(4.5);
    expect(rapport(couleurs['brand.500'], couleurs['brand.600'])).toBeGreaterThan(1.2);
  });
});

/**
 * `bg.onDark` est un fond **sombre**, et son nom dit le contraire.
 *
 * Il est le plus sombre de la palette, plus noir encore que `bg.inverse`. Le
 * fichier de jetons le
 * range dans le kit d'accommodation sombre, celui des deux écrans déclarés hors
 * système ; mais « sunken » se lit « renfoncement », et un renfoncement se pose
 * d'instinct sur une surface claire.
 *
 * **Huit surfaces s'y étaient trompées**, et aucune ne rougissait : le compteur
 * de places de la journée devenait une zone noire à deux signes illisibles, la
 * piste d'une barre de progression peignait le vide en noir et le
 * remplissage se lisait à l'envers, un champ désactivé virait au noir avec son
 * texte sombre dessus, les jours indisponibles du sélecteur de créneaux
 * passaient en noir — c'est-à-dire au plus appuyé de la grille, quand ils sont
 * ce qu'on ne peut pas prendre — et la ligne du salon courant, dans la barre
 * latérale, était un bandeau noir.
 *
 * Le renfoncement clair est `bg.inset` ; le fond d'un média est
 * `media.placeholder`, qui en porte la valeur sous le nom de son usage.
 *
 * **La garde nomme, elle n'interdit pas.** Un écran sombre a le droit d'exister
 * — la visionneuse en est un, et le jeton est fait pour elle. Ce qu'elle exige
 * est que ce soit écrit ici, donc décidé.
 */
describe('le creux qui n’en est pas un', () => {
  const AUTORISES = [
    // La visionneuse : c'est l'écran que le jeton sert, et le fichier de jetons
    // le nomme — « screen.gallery — bg.onDark, chrome minimal ».
    'src/screens/Visionneuses.tsx',
    // La table des couleurs elle-même, qui doit bien le déclarer.
    'src/theme/index.tsx',
  ];

  it('n’est peint que là où le fond est vraiment sombre', () => {
    const fautifs = sources(RACINE)
      // La prose qui documente le piège le cite forcément : voir
      // `sansCommentaires`, et pourquoi un filtre ligne à ligne ne suffit pas.
      .filter((chemin) => sansCommentaires(readFileSync(chemin, 'utf-8')).includes('bg.onDark'))
      .map((chemin) => chemin.slice(chemin.indexOf('src/')));

    expect(fautifs.sort()).toEqual([...AUTORISES].sort());
  });
});

/**
 * L'avertissement se distingue par son glyphe, jamais par sa teinte.
 *
 * **C'est une décision, pas une palette qui aurait cessé d'honorer un rôle.**
 * Un ambre dans un système ambre se lirait comme la marque : l'avertissement est
 * donc neutre en couleur — ses trois valeurs sont exactement celles du neutre —
 * et ce qui le distingue est un glyphe obligatoire.
 *
 * D'où le défaut particulier de ce jeton : **`status.warning` posé seul ne dit
 * rien.** Il rend les mêmes pixels que `ink.default` sur `bg.inset`, et l'auteur
 * croit avoir posé une alerte. Cinq endroits s'y étaient trompés — la pastille
 * du sélecteur de salon, un état « en pause » qui annonçait un défaut là où le
 * message dit « rien n'est perdu », deux motifs de refus dans des historiques,
 * et un libellé de tâche.
 *
 * Trois verrous, parce qu'aucun ne suffit seul : le mécanisme qui rend le
 * glyphe, la décision épinglée à ses valeurs, et l'inventaire de ce qui peint
 * l'avertissement de sa propre main.
 */
describe('l’avertissement, neutre et glyphé', () => {
  it('`StatusMessage` rend le glyphe de l’avertissement', async () => {
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <StatusMessage level="warning" body="attention" />
        </ThemeProvider>
      </I18nProvider>,
    );

    // `includeHiddenElements` : le glyphe est masqué au lecteur d'écran — le
    // niveau est déjà annoncé par le rôle `alert` — mais il est bien rendu, et
    // c'est ce qu'on éprouve.
    expect(screen.getByTestId('glyphe-warning', { includeHiddenElements: true })).toBeTruthy();
  });

  it('et le neutre n’en a pas', async () => {
    // **Le cas où les deux implémentations divergent.** Un glyphe rendu à tous
    // les niveaux passerait le test du dessus tout aussi bien, et ne
    // distinguerait plus rien — or c'est la seule distinction qui reste, la
    // couleur étant la même.
    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <StatusMessage level="neutral" body="rien" />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(
      screen.queryByTestId('glyphe-neutral', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('les trois valeurs sont celles du neutre, et c’est voulu', () => {
    // **La décision, épinglée.** Le jour où quelqu'un donne une teinte à
    // l'avertissement, ce test tombe — et c'est ce qu'on veut : la règle du
    // glyphe obligatoire ne se justifie que par l'absence de teinte, et la
    // changer sans revoir l'autre laisserait une règle sans sa raison.
    const couleurs = JSON.parse(readFileSync(join(RACINE, 'theme', 'tokens.json'), 'utf-8')).color;

    expect(couleurs.status.warning.surface).toBe(couleurs.bg.inset);
    expect(couleurs.status.warning.text).toBe(couleurs.ink.default);
    expect(couleurs.status.warning.rule).toBe(couleurs.line.solo);

    // Et les deux autres portent bien une teinte, sans quoi l'assertion du
    // dessus se lirait comme « les statuts n'ont pas de couleur ».
    expect(couleurs.status.success.text).not.toBe(couleurs.ink.default);
    expect(couleurs.status.danger.text).not.toBe(couleurs.ink.default);
  });

  it('rien ne le peint de sa propre main sans porter un glyphe', () => {
    // **L'inventaire.** `StatusMessage` garantit le glyphe par construction ;
    // ailleurs, la garantie tient à la structure du fichier, et chaque entrée
    // dit laquelle. Un fichier de plus oblige à répondre à la question, ce
    // qu'aucune règle écrite dans une passation ne fait faire.
    const GARANTS: Record<string, string> = {
      // Le composant lui-même : sa table de glyphes est éprouvée ci-dessus.
      'src/components/StatusMessage.tsx': 'sa table de niveaux',
      // `Bloc` prend `icone` en propriété **obligatoire**, typée sur deux
      // valeurs : on ne peut pas en poser un sans glyphe.
      'src/screens/ReglesDesPaliers.tsx': 'la propriété `icone` de `Bloc`',
      // Le type `Cas` porte `icone: NomIcone`, non optionnel.
      'src/screens/RaisonDuVide.tsx': 'le champ `icone` du type `Cas`',
      // Les deux rendent l'icône « alerte » à côté de la teinte.
      'src/screens/CarteDuCommerce.tsx': 'une `Icone` alerte rendue à côté',
      'src/screens/ArbitrageScreen.tsx': 'une `Icone` alerte rendue à côté',
    };

    const peintres = sources(RACINE)
      .filter((chemin) => !chemin.includes(join('src', 'theme')))
      .filter((chemin) => sansCommentaires(readFileSync(chemin, 'utf-8')).includes('status.warning'))
      .map((chemin) => chemin.slice(chemin.indexOf('src/')));

    expect(peintres.sort()).toEqual(Object.keys(GARANTS).sort());

    // **Et le garant se vérifie, il ne se déclare pas.** Sans cette moitié,
    // l'inventaire dirait seulement quels fichiers ont le droit — un
    // avertissement ajouté sans glyphe dans un fichier déjà listé passerait.
    for (const fichier of peintres) {
      const source = readFileSync(join(RACINE, '..', fichier), 'utf-8');
      expect([fichier, /icone|Icone|GLYPHE/.test(source)]).toEqual([fichier, true]);
    }
  });
});

/**
 * Deux couches, un seul espace de noms.
 *
 * L'échelle typographique est une table plate : le socle préfixé `type.`, et le
 * produit dont les clés portent déjà leur préfixe. Ce sont donc des **frères**,
 * pas deux niveaux — et `Object.fromEntries` garde le dernier.
 *
 * **Une clé du produit qui porterait le nom d'une clé du socle l'écraserait en
 * silence.** Même variante appelée, autre taille, autre graisse, et rien ne
 * tombe : le nom existe toujours, il ne désigne simplement plus la même chose.
 * C'est un défaut d'un genre particulier — il ne se voit sur aucun écran isolé,
 * il faut ouvrir les deux fichiers de jetons côte à côte, ce que personne ne
 * fait. Il survivra au lot qui l'a fait remarquer, d'où cette garde.
 */
describe('les deux couches de l’échelle', () => {
  it('ne se disputent aucun nom', () => {
    expect(collisionsDeCouches).toEqual([]);
  });

  it('et la table porte bien les deux, sans quoi la garde ne garderait rien', () => {
    // **Le sens inverse.** Une garde sur un tableau vide passe aussi quand les
    // deux couches sont vides, ou quand l'une n'est plus lue du tout : c'est
    // exactement l'implémentation qu'on redoute — un `variantes()` qui rendrait
    // `[]` sur le produit ferait taire la collision **et** perdrait quatre
    // variantes, sans un seul rouge.
    expect(typography['type.body']).toBeDefined();
    expect(typography['type.code']).toBeDefined();
  });
});

/**
 * L'échelle des chiffres est une échelle, pas un tas.
 *
 * **Deux jetons portaient la même taille sans que rien ne le dise.** Le socle
 * déclarait `monoDisplay` à 44 px, le produit `figure` à 44 px aussi, l'un en
 * poids 500 et l'autre en 600 — et le *même* score de fiabilité était rendu par
 * l'un sur son écran de détail, par l'autre dans les règles des paliers. Deux
 * écrans, un nombre, deux graisses.
 *
 * Rien ne pouvait le voir : chaque jeton était conforme, chaque écran cohérent
 * avec lui-même. Il fallait ouvrir les deux fichiers de jetons côte à côte, ou
 * les deux écrans, et personne ne fait ni l'un ni l'autre.
 *
 * D'où la règle, qui vaut pour cette famille et pas pour les autres : **dans le
 * monospacé, la taille désigne le rôle.** Le corps a `body` et `bodyStrong` à
 * 16 px, le titre a sa variante accentuée — ce sont des paires voulues, une
 * graisse distinguant deux emplois du même rang. Les chiffres n'ont pas de
 * paires : chaque cran est un usage, du code à six chiffres qu'on montre au
 * comptoir jusqu'à l'étiquette qui porte une date.
 */
describe('l’échelle des chiffres', () => {
  it('n’a qu’un jeton par taille', () => {
    const parTaille = new Map<number, string[]>();

    for (const [nom, echelle] of Object.entries(typography)) {
      if (echelle.fontFamily !== 'mono') continue;
      parTaille.set(echelle.fontSize, [...(parTaille.get(echelle.fontSize) ?? []), nom]);
    }

    const partages = [...parTaille.entries()]
      .filter(([, noms]) => noms.length > 1)
      .map(([taille, noms]) => `${taille} px : ${noms.sort().join(', ')}`);

    expect(partages).toEqual([]);
  });

  it('et elle est bien peuplée, sans quoi la règle ne dirait rien', () => {
    // **Le sens inverse.** « Aucune taille partagée » est vrai d'une famille
    // vide, et le serait aussi le jour où quelqu'un change la fonte du
    // monospacé sans changer les jetons : la garde passerait au vert en ayant
    // cessé de regarder quoi que ce soit.
    const chiffres = Object.entries(typography).filter(
      ([, echelle]) => echelle.fontFamily === 'mono',
    );

    expect(chiffres.length).toBeGreaterThanOrEqual(6);

    // **Et les deux couches y sont.** C'est cette moitié qui a payé : la
    // première version comparait à `familles.mono`, qui porte le nom de la
    // fonte et non le rôle — la famille ressortait vide, la règle du dessus
    // passait au vert sur zéro jeton. En la réparant, le vrai défaut est
    // apparu : `type.code` et `type.countdown` sortaient en sans, parce que la
    // passation épelle « IBM Plex Mono » là où le produit écrit « mono ».
    const noms = chiffres.map(([nom]) => nom);
    expect(noms).toContain('type.dataLabel'); // socle
    expect(noms).toContain('type.code'); // produit
  });
});
