/**
 * Une paire sous 4,5:1 se démontre, elle ne se discute pas.
 *
 * **Le motif que cette garde ferme.** `luminance()` et `contraste()` existent
 * depuis longtemps dans le thème, ils sont justes, et ils ne servaient qu'à
 * **une seule chose** : calculer l'opacité minimale d'un voile de photo. La
 * capacité était là ; personne ne l'appelait sur les couleurs du produit. Design
 * a reproduit cinq fois la même erreur — une encre trop claire sur un fond qui a
 * changé — et l'a corrigée cinq fois parce qu'on mesurait à la main.
 *
 * Le jeton lui-même porte le compte : « trois erreurs de contraste sur quatre,
 * dans l'historique de ce projet, viennent d'un `ink.faint` employé comme
 * couleur de texte ». La quatrième a été trouvée en écrivant ce fichier.
 *
 * ## Ce que cette garde fait
 *
 * Elle mesure les paires **déclarées** de la palette, chacune avec son seuil et
 * sa raison, et elle exige que chaque encre du système figure dans la table :
 * une couleur ajoutée sans être confrontée à un fond fait tomber le test.
 *
 * Les seuils sont ceux du standard, et ils ne sont pas tous à 4,5 : un texte
 * ordinaire demande 4,5:1, un grand texte et une bordure qui délimite un
 * contrôle demandent 3:1, un élément **inactif** n'est soumis à rien — son
 * illisibilité est le message.
 *
 * ## Ce qu'elle ne fait pas, et il faut le lire
 *
 * **Elle mesure la palette, pas les écrans.** Savoir qu'un texte donné est posé
 * sur un fond donné demanderait de calculer la mise en page ; ce n'est pas à sa
 * portée. Une encre juste posée sur un fond qu'elle n'a pas le droit de toucher
 * lui échappe — c'est exactement le défaut de `BasDuMur`, et il a été trouvé à
 * la main, pas par cette garde.
 *
 * Ce qu'elle rattrape à la place est la forme du défaut : `ink.faint` est un
 * **état**, jamais une couleur. Écrit sans condition, c'est qu'on l'a pris pour
 * une nuance de gris — les quatre occurrences de l'historique ont cette forme.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { contraste, couleurs, luminance } from '../src/theme';

/** Le rapport entre deux jetons, par leur nom. */
function rapport(encre: string, fond: string): number {
  const a = couleurs[encre as keyof typeof couleurs];
  const b = couleurs[fond as keyof typeof couleurs];
  if (!a || !b) throw new Error(`jeton inconnu : ${!a ? encre : fond}`);
  return contraste(luminance(a), luminance(b));
}

/**
 * Les seuils du standard, nommés plutôt que chiffrés sur place.
 *
 * `INACTIF` n'est pas zéro par commodité : un composant désactivé est
 * explicitement hors du critère, et lui imposer un rapport reviendrait à
 * demander qu'un bouton éteint se lise aussi bien qu'un bouton vivant — ce qui
 * effacerait la seule chose que sa couleur dit.
 */
const TEXTE = 4.5;
const GRAND_TEXTE = 3;
const CONTOUR = 3;
const INACTIF = 0;

type Paire = { encre: string; fond: string; seuil: number; raison: string };

/**
 * Les encres mesurées ailleurs, et **où**.
 *
 * Les deux encres de voile ne se posent sur aucune couleur : elles se posent
 * sur une photographie, dont on ne maîtrise rien. Le seul raisonnement qui
 * vaille est celui du cas le plus défavorable — une photo blanche — et il
 * demande de calculer l'opacité minimale du voile plutôt qu'un rapport entre
 * deux jetons. `opaciteMinimaleDuVoile` fait exactement cela, et deux fichiers
 * l'exercent déjà. Les recopier ici ferait deux vérités du même calcul.
 */
const AILLEURS: Record<string, { fichier: string; raison: string }> = {
  'ink.onScrim': {
    fichier: 'theme.test.tsx',
    raison: 'posée sur une photo : mesurée par `opaciteMinimaleDuVoile`, au cas blanc',
  },
  'ink.onScrimMuted': {
    fichier: 'composants.test.tsx',
    raison: "l'opacité réelle du voile des cartes est confrontée au minimum requis",
  },
};

/**
 * Les paires que le produit rend, chacune avec son seuil et sa raison.
 *
 * **Déclarées et non calculées en produit croisé.** Toutes les combinaisons
 * possibles feraient tomber des paires que personne ne pose — une encre claire
 * sur une surface claire — et une garde qui crie au loup apprend à ignorer le
 * rouge. Ce qui est ici est ce qui existe à l'écran.
 */
const PAIRES: Paire[] = [
  // --- les trois encres qui portent du texte, sur les trois surfaces claires
  { encre: 'ink.default', fond: 'bg.page', seuil: TEXTE, raison: 'le corps de texte' },
  { encre: 'ink.default', fond: 'bg.surface', seuil: TEXTE, raison: 'le corps sur une carte' },
  { encre: 'ink.default', fond: 'bg.inset', seuil: TEXTE, raison: 'le corps sur un encart' },
  { encre: 'ink.soft', fond: 'bg.page', seuil: TEXTE, raison: 'la seconde ligne' },
  { encre: 'ink.soft', fond: 'bg.surface', seuil: TEXTE, raison: 'la seconde ligne sur une carte' },
  { encre: 'ink.soft', fond: 'bg.inset', seuil: TEXTE, raison: 'la seconde ligne sur un encart' },
  { encre: 'ink.mute', fond: 'bg.page', seuil: TEXTE, raison: 'la légende, et le minimum du 11 px' },
  { encre: 'ink.mute', fond: 'bg.surface', seuil: TEXTE, raison: 'la légende sur une carte' },
  {
    encre: 'ink.mute',
    fond: 'bg.inset',
    // **4,36 mesuré, et c'est sous le seuil du texte ordinaire.** La paire
    // existe — un encart gris porte des légendes — et elle ne passe qu'au titre
    // du grand texte. Écrit ici plutôt que corrigé seul : changer une valeur de
    // la palette est une décision de dessin, et le nombre est maintenant sous
    // les yeux de qui la prendra.
    seuil: GRAND_TEXTE,
    raison: '4,36 mesuré : tient en grand texte, pas en légende de 11 px',
  },

  // --- l'encre des états, sur sa propre surface et sur la carte
  ...(['success', 'warning', 'danger'] as const).flatMap((etat) => [
    {
      encre: `status.${etat}.text`,
      fond: `status.${etat}.surface`,
      seuil: TEXTE,
      raison: `le message ${etat} sur son aplat`,
    },
    {
      encre: `status.${etat}.text`,
      fond: 'bg.surface',
      seuil: TEXTE,
      raison: `le message ${etat} posé sur une carte`,
    },
  ]),

  // --- ce qui se pose sur du sombre
  { encre: 'ink.onDark', fond: 'bg.inverse', seuil: TEXTE, raison: 'le texte des surfaces sombres' },
  { encre: 'ink.onDark', fond: 'bg.onDark', seuil: TEXTE, raison: 'le texte du fond le plus sombre' },
  {
    encre: 'ink.faint',
    fond: 'bg.inverse',
    seuil: TEXTE,
    // Le seul emploi de `ink.faint` qui porte un texte lisible, et il tient :
    // le jour choisi de la bande de créneaux est un fond sombre.
    raison: 'la ligne sourde du jour choisi, sur le fond inversé',
  },

  // --- la marque
  {
    encre: 'brand.700',
    fond: 'bg.surface',
    seuil: TEXTE,
    raison: "l'encre de marque, seule nuance de la famille qui porte du texte",
  },
  { encre: 'brand.700', fond: 'bg.page', seuil: TEXTE, raison: "l'encre de marque sur la page" },
  {
    encre: 'ink.onBrand',
    fond: 'brand.500',
    seuil: TEXTE,
    raison: "le libellé du bouton principal, qui porte l'encre et jamais le blanc",
  },

  // --- ce qui délimite sans porter de texte
  { encre: 'line.solo', fond: 'bg.surface', seuil: CONTOUR, raison: 'le contour qui engage' },
  {
    encre: 'line.default',
    fond: 'bg.surface',
    // 1,29 : un filet de séparation n'est pas un contrôle, et le critère ne
    // s'applique qu'à ce qui délimite quelque chose d'actionnable. Le contour
    // qui engage est `line.solo`, mesuré juste au-dessus.
    seuil: INACTIF,
    raison: 'filet de séparation, décoratif : rien ne se lit ni ne se presse dessus',
  },
  {
    encre: 'line.strong',
    fond: 'bg.surface',
    seuil: INACTIF,
    raison: 'filet appuyé, même nature : il sépare, il ne délimite pas un contrôle',
  },
  {
    encre: 'line.onDark',
    fond: 'bg.inverse',
    seuil: INACTIF,
    raison: 'le même filet, côté sombre',
  },

  // --- l'encre des états éteints
  {
    encre: 'ink.faint',
    fond: 'bg.page',
    seuil: INACTIF,
    raison: "état inactif : son illisibilité est le message, et le standard l'exempte",
  },
  {
    encre: 'ink.faint',
    fond: 'bg.surface',
    seuil: INACTIF,
    raison: 'le même, sur une carte',
  },
];

describe('le contraste des paires que le produit rend', () => {
  it.each(PAIRES)('$encre sur $fond — $raison', ({ encre, fond, seuil }) => {
    expect(rapport(encre, fond)).toBeGreaterThanOrEqual(seuil);
  });

  it('la garde regarde bien quelque chose', () => {
    // Sans cette ligne, une table vidée par erreur passerait tous les tests
    // ci-dessus en n'en exécutant aucun.
    expect(PAIRES.length).toBeGreaterThan(20);
    // Et les rapports sont réellement calculés : une fonction qui rendrait une
    // constante passerait tout, y compris les seuils à zéro.
    expect(rapport('ink.default', 'bg.page')).toBeGreaterThan(15);
    expect(rapport('ink.faint', 'bg.page')).toBeLessThan(3);
  });

  it('chaque encre du système est confrontée à un fond', () => {
    // **Le sens qui vieillit bien.** Une encre ajoutée à la palette et jamais
    // inscrite ici ne serait mesurée nulle part, et c'est exactement ainsi
    // qu'une couleur trop claire entre : par une valeur neuve que personne ne
    // pense à confronter.
    const encres = Object.keys(couleurs).filter((nom) => nom.startsWith('ink.'));
    const mesurees = new Set([...PAIRES.map((paire) => paire.encre), ...Object.keys(AILLEURS)]);
    expect(encres.filter((nom) => !mesurees.has(nom))).toEqual([]);
  });

  it('et ce qui est mesuré ailleurs l’est réellement', () => {
    // **La table des renvois ne doit pas devenir un tapis.** Une encre qu'on y
    // range en disant « c'est vérifié là-bas » sans que ce soit vrai serait
    // pire qu'une encre oubliée : elle porterait une raison rassurante.
    for (const [encre, ou] of Object.entries(AILLEURS)) {
      const fichier = readFileSync(join(__dirname, ou.fichier), 'utf-8');
      expect(fichier).toContain(encre);
    }
  });
});

/**
 * `ink.faint` est un état, jamais une couleur.
 *
 * **La forme du défaut, à défaut de pouvoir mesurer les écrans.** Savoir sur
 * quel fond un texte est posé demanderait de calculer la mise en page. Ce qui
 * se voit dans le source, en revanche, c'est qu'une encre d'état écrite **sans
 * condition** a été prise pour une nuance de gris — et les quatre erreurs de
 * l'historique ont toutes cette forme.
 *
 * La quatrième était `BasDuMur` : un libellé pressable — « repartir du haut » —
 * en `ink.faint` sur la page, à 2,46:1. Trouvé en écrivant ce fichier, corrigé
 * dans le même commit.
 */
describe('l’encre des états éteints ne s’écrit jamais seule', () => {
  const SRC = join(__dirname, '..', 'src');

  function sources(): { chemin: string; texte: string }[] {
    const trouves: { chemin: string; texte: string }[] = [];
    const parcourir = (dossier: string) => {
      for (const entree of readdirSync(dossier)) {
        const chemin = join(dossier, entree);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.tsx?$/.test(entree)) {
          trouves.push({ chemin, texte: readFileSync(chemin, 'utf-8') });
        }
      }
    };
    parcourir(SRC);
    return trouves;
  }

  it('elle n’apparaît que dans une expression d’état', () => {
    const fautifs: string[] = [];
    for (const { chemin, texte } of sources()) {
      if (chemin.endsWith(join('theme', 'index.tsx'))) continue;
      // **Les blocs de commentaire se suivent d'une ligne à l'autre.** Retirer
      // `//` et `/* … */` sur chaque ligne prise seule laisse passer la queue
      // d'un bloc ouvert plus haut — et c'est là qu'on parle du jeton sans le
      // poser. La garde criait au loup sur une phrase qui disait précisément de
      // ne pas s'en servir.
      let dansUnBloc = false;
      texte.split('\n').forEach((ligne, rang) => {
        const ouvre = ligne.includes('/*');
        const ferme = ligne.includes('*/');
        const commentee = dansUnBloc;
        if (ouvre && !ferme) dansUnBloc = true;
        if (ferme) dansUnBloc = false;
        if (commentee) return;

        const nue = ligne.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (!nue.includes('ink.faint')) return;
        // Une condition sur la ligne, ou la ligne juste avant : `couleur={x ?
        // 'ink.faint' : y}` tient sur une ligne, `c[disabled ? …]` aussi, et
        // une ternaire longue peut passer à la ligne avant le jeton.
        const contexte = nue + (texte.split('\n')[rang - 1] ?? '');
        if (!contexte.includes('?')) {
          fautifs.push(`${chemin.slice(SRC.length + 1)}:${rang + 1} — ${nue.trim()}`);
        }
      });
    }
    expect(fautifs).toEqual([]);
  });

  it('et la garde attrape bien la forme qu’elle cherche', () => {
    // **Éprouvée sur la faute, comme le reste.** Une garde qui ne trouve rien
    // ne prouve pas que le produit est sain, elle prouve qu'elle s'exécute.
    const fautif = "      style={{ color: c['ink.faint'] }}";
    const juste = "      couleur={disabled ? 'ink.faint' : 'ink.default'}";
    const sansCondition = (ligne: string) =>
      ligne.includes('ink.faint') && !ligne.replace(/\/\/.*$/, '').includes('?');
    expect(sansCondition(fautif)).toBe(true);
    expect(sansCondition(juste)).toBe(false);
  });
});
