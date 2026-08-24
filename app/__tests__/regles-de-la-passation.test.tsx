/**
 * Les règles de la passation que rien n'exécutait.
 *
 * **Deux défauts en deux jours étaient des règles écrites, vraies, exactes, et
 * qu'aucune garde ne tenait** — l'avertissement sans son glyphe, le code du
 * comptoir rendu en sans. L'audit qui a suivi en a nommé une douzaine d'autres,
 * toutes mécaniquement vérifiables. Celles-ci sont les leurs.
 *
 * Le critère de tri n'est pas l'importance mais la **vérifiabilité** : une règle
 * qui demande un jugement — « le seuil se mesure sur la largeur du conteneur »,
 * « l'ordre de lecture est titre, statut, contenu, actions » — n'a pas sa place
 * ici, parce qu'une garde qui se trompe est pire qu'une garde absente.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { AccessibilityInfo } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { SkeletonBox } from '../src/components/Skeleton';
import { motion } from '../src/theme';
import { en } from '../src/i18n/en';
import { messageDObstacle } from '../src/screens/obstacle';

const RACINE = join(__dirname, '..', 'src');

function sources(dossier: string, trouves: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) sources(chemin, trouves);
    else if (/\.tsx?$/.test(entree)) trouves.push(chemin);
  }
  return trouves;
}

/** La source, commentaires retirés : la prose d'une règle cite forcément ce qu'elle interdit. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((ligne) => ligne.replace(/\/\/.*$/, ''))
    .join('\n');
}

/**
 * §4 — « Propriétés animables : opacity et transform uniquement. »
 *
 * **La règle est déjà tenue par un mécanisme, et c'est lui qu'on garde.** Le
 * pilote natif de React Native n'accepte que ces deux propriétés : une
 * animation déclarée `useNativeDriver: true` ne *peut pas* animer une hauteur,
 * une couleur ou une position. Vérifier le pilote vaut donc mieux que vérifier
 * les propriétés une à une — c'est la même règle, prise là où elle est
 * indéformable.
 *
 * `LayoutAnimation` est l'autre porte : elle anime le layout entier sans passer
 * par `Animated`, donc sans pilote natif à déclarer.
 */
describe('les animations ne touchent que l’opacité et la transformation', () => {
  const fichiers = sources(RACINE);

  it('aucune n’échappe au pilote natif', () => {
    const fautifs = fichiers
      .filter((chemin) => sansCommentaires(readFileSync(chemin, 'utf-8')).includes('useNativeDriver: false'))
      .map((chemin) => chemin.slice(chemin.indexOf('src/')));

    expect(fautifs).toEqual([]);
  });

  it('et il y en a, sans quoi la règle ne dirait rien', () => {
    // **Le sens inverse.** « Aucun pilote désactivé » est vrai d'un produit qui
    // n'anime rien, et le resterait le jour où quelqu'un remplace `Animated` par
    // autre chose : la garde passerait au vert en ayant cessé de regarder.
    const declarations = fichiers.filter((chemin) =>
      readFileSync(chemin, 'utf-8').includes('useNativeDriver: true'),
    );

    expect(declarations.length).toBeGreaterThanOrEqual(5);
  });

  it('et personne n’anime le layout par la porte de derrière', () => {
    const fautifs = fichiers
      .filter((chemin) => sansCommentaires(readFileSync(chemin, 'utf-8')).includes('LayoutAnimation'))
      .map((chemin) => chemin.slice(chemin.indexOf('src/')));

    expect(fautifs).toEqual([]);
  });
});

/**
 * §3 — « Aucune troncature sur une action ni sur un statut. L'ellipse est
 * réservée aux noms propres. »
 *
 * La règle est encodée dans une propriété plutôt que dans une consigne :
 * `Texte` n'accepte `numberOfLines` que sous le nom `ellipseSurNomPropre`, ce
 * qui oblige à nommer la raison en le posant. Reste que rien n'empêchait de
 * poser `numberOfLines` ailleurs, sur un `Text` brut — et c'est ce que la règle
 * interdit vraiment.
 */
describe('l’ellipse est réservée aux noms propres', () => {
  it('personne ne tronque hors des deux endroits qui le peuvent', () => {
    // `Texte` porte la règle ; `TextField` compte des lignes de saisie, ce qui
    // n'est pas une troncature.
    const AUTORISES = ['src/components/Texte.tsx', 'src/components/TextField.tsx'];

    const fautifs = sources(RACINE)
      .filter((chemin) => sansCommentaires(readFileSync(chemin, 'utf-8')).includes('numberOfLines'))
      .map((chemin) => chemin.slice(chemin.indexOf('src/')));

    expect(fautifs.sort()).toEqual([...AUTORISES].sort());
  });
});

/**
 * §6 — « Un code inconnu s'affiche en “détail indisponible”, jamais en texte
 * improvisé. »
 *
 * Le catalogue des obstacles est fermé côté serveur, et le client les consomme
 * tels quels. Ce qui se garde ici est le cas que personne ne compose : le code
 * que le serveur ajoutera un jour et que cette version ne connaît pas. La règle
 * vit dans une fonction pure, et c'est là qu'elle s'éprouve — la faire passer
 * par un écran ferait dépendre le verdict d'un montage.
 */
describe('un obstacle inconnu se dit sans s’inventer', () => {
  const t = (cle: string) => (cle === 'etats.detailIndisponible' ? en.etats.detailIndisponible : cle);
  const CONNUS = new Set(['no_metrics']);

  it('rend le repli, et non le code brut', () => {
    const message = messageDObstacle(
      t,
      { raison: 'un_code_que_cette_version_ne_connait_pas' } as never,
      CONNUS,
    );

    expect(message).toBe(en.etats.detailIndisponible);
    // **Et surtout pas le code lui-même.** C'est la faute qu'on redoute : une
    // chaîne technique servie telle quelle se lit comme un oubli de traduction,
    // parce que c'en est un.
    expect(message).not.toMatch(/un_code_que_cette_version/);
  });

  it('et un code connu garde son texte', () => {
    // **Le cas où les deux implémentations divergent.** Rendre le repli pour
    // tout le monde passerait le test du dessus tout aussi bien, et ferait
    // disparaître les neuf obstacles que le produit sait nommer.
    const message = messageDObstacle(t, { raison: 'no_metrics' } as never, CONNUS);

    expect(message).not.toBe(en.etats.detailIndisponible);
  });
});

/**
 * §4 — « `useReducedMotion` respecté : les boucles d'opacité passent à un état
 * fixe à 0,7. »
 *
 * **Le chiffre compte, et c'est pour cela qu'il se garde.** Un squelette figé à
 * 1 disparaît dans la surface et ne se lit plus comme une attente ; figé à 0,45
 * — le bas de sa boucle — il se lit comme un élément désactivé. 0,7 est le point
 * où il dit « ça arrive » sans bouger, et c'est la seule valeur que le réglage
 * système laisse au produit pour le dire.
 *
 * La règle était tenue et éprouvée nulle part : la boucle lit un réglage
 * asynchrone, ce qu'aucun test de rendu ne rencontre par hasard.
 */
describe('mouvement réduit : le squelette se pose à 0,7', () => {
  function opaciteDe(vue: Awaited<ReturnType<typeof render>>): unknown {
    const style = vue.getByTestId('squelette', { includeHiddenElements: true }).props.style;
    const plat = Array.isArray(style) ? Object.assign({}, ...style) : style;
    // La valeur animée porte son état courant ; c'est lui qu'on lit, pas la
    // consigne qu'on vient de donner.
    return (plat.opacity as { __getValue?: () => number })?.__getValue?.() ?? plat.opacity;
  }

  it('quand le système le demande', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const vue = await render(<SkeletonBox height={12} testID="squelette" />);
    await waitFor(() => expect(opaciteDe(vue)).toBe(0.7));
  });

  it('et il continue de battre quand il ne le demande pas', async () => {
    // **Le cas où les deux implémentations divergent.** Se poser à 0,7 en toutes
    // circonstances passerait le test du dessus tout aussi bien, et retirerait
    // du produit la seule chose qui distingue une attente d'un élément éteint.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    const vue = await render(<SkeletonBox height={12} testID="squelette" />);
    await waitFor(() => expect(opaciteDe(vue)).not.toBe(0.7));
  });
});

/**
 * §4 — « Durées : 120 ms, 200 ms, 320 ms. »
 *
 * **Cinq durées étaient écrites en dur**, dont trois hors du vocabulaire
 * déclaré : 90 et 1000 dans l'écran de chargement, 4000 deux fois sur le halo du
 * code, et 800 sur l'anneau du bouton. Cette dernière est le cas exemplaire —
 * elle est **déclarée dans la passation** (« anneau de 15 px en rotation
 * continue 800 ms ») et le composant la recopiait : une valeur décidée par le
 * système, réécrite à la main là où elle sert.
 *
 * Ce n'était pas une décision de composition mais une règle déjà tranchée qu'on
 * n'appliquait pas.
 *
 * **La garde n'impose pas une liste de valeurs**, ce qui figerait une boucle de
 * respiration au même rythme qu'une transition d'écran. Elle impose qu'une durée
 * porte un **nom** — jeton du système, ou constante nommée dans son fichier. Un
 * nom oblige à dire ce qu'on chronomètre, et c'est là que se voit la valeur qui
 * n'aurait pas dû être choisie ici.
 */
describe('aucune durée d’animation n’est écrite en dur', () => {
  it('elles portent toutes un nom', () => {
    const fautives = sources(RACINE)
      .flatMap((chemin) =>
        sansCommentaires(readFileSync(chemin, 'utf-8'))
          .split('\n')
          .map((ligne, rang) => ({ chemin, rang: rang + 1, ligne }))
          .filter(({ ligne }) => /duration:\s*\d/.test(ligne)),
      )
      .map(({ chemin, rang, ligne }) => `${chemin.slice(chemin.indexOf('src/'))}:${rang} → ${ligne.trim()}`);

    expect(fautives).toEqual([]);
  });

  it('et il y en a, sans quoi la garde ne garderait rien', () => {
    // **Le sens inverse.** « Aucune durée littérale » est vrai d'un produit qui
    // n'anime rien. Ce qu'on veut est qu'il en déclare, et qu'aucune ne soit
    // anonyme.
    const nommees = sources(RACINE).flatMap((chemin) =>
      sansCommentaires(readFileSync(chemin, 'utf-8'))
        .split('\n')
        .filter((ligne) => /duration:\s*[A-Za-z_]/.test(ligne)),
    );

    expect(nommees.length).toBeGreaterThanOrEqual(10);
  });

  it('et la valeur que la passation déclare vient du jeton', () => {
    // L'anneau du bouton : 800 ms est écrit dans la passation, donc il vit dans
    // les jetons et nulle part ailleurs.
    expect(motion.anneau).toBe(800);
    expect(readFileSync(join(RACINE, 'components', 'Button.tsx'), 'utf-8')).toContain(
      'duration: motion.anneau',
    );
  });
});
