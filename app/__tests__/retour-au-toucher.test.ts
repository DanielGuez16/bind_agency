/**
 * Tout ce qui se presse doit le montrer.
 *
 * **Ce que ça répare.** Sur vingt-huit `Pressable` écrits à la main dans les
 * écrans, **un seul** réagissait à l'appui. Le bouton retour de chaque écran,
 * toute la navigation en grand écran, le choix d'un créneau — le geste central
 * du produit — ne renvoyaient rien : le doigt appuyait, l'écran ne bougeait pas,
 * et la seule confirmation arrivait avec le rendu suivant, parfois une seconde
 * plus tard sur un réseau de salon. On appuie alors deux fois.
 *
 * **Pourquoi une garde et pas des tests d'écran.** Le défaut n'est pas dans un
 * écran, il est dans une habitude : écrire `<Pressable>` avec un `style` objet.
 * Un test par site aurait couvert les vingt-huit d'aujourd'hui et rien du
 * vingt-neuvième. Ici, un `Pressable` neuf sans retour fait tomber la suite.
 *
 * **La garde cherche les quatre formes qui comptent**, pas seulement celle
 * qu'on avait en tête :
 *
 * 1. `style={({ pressed }) => …}` — la forme canonique ;
 * 2. `useEnfoncement()` — le ressort partagé, appelé sur place ;
 * 3. `android_ripple` — le retour natif d'Android ;
 * 4. `{...enfoncement}` — l'étalement de la paire rendue par le hook ;
 * 5. `onPressIn={enfoncement.onPressIn}` — la paire câblée à la main.
 *
 * **La cinquième a été ajoutée après coup, et c'est la démonstration.** La
 * première version en connaissait quatre et accusait à tort la carte du fil —
 * le composant le plus pressé du produit, qui avait un ressort depuis toujours,
 * câblé sous la cinquième forme. Une garde qui accuse à tort se fait désactiver.
 * (Cette carte a depuis été retirée ; l'exemple vaut pour la forme, pas pour
 * le composant.)
 *
 * C'est la leçon du garde-fou des rendus asynchrones, qui ne cherchait l'appel
 * qu'en début de ligne et a laissé passer `const vue = render(…)` pendant des
 * semaines : une garde partielle fait croire que la question est réglée.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const RACINE = join(__dirname, '..', 'src');

/**
 * Ce qui vaut retour à l'appui, dans l'ordre où on les rencontre.
 *
 * `pressed` couvre le `style` fonction comme le rendu enfant fonction — les
 * deux passent l'état à l'appelant, et un composant qui le nomme s'en sert.
 */
/**
 * `pressed` **employé**, et non seulement déclaré.
 *
 * La forme canonique déstructure le paramètre — `({ pressed }) => …` — donc le
 * mot apparaît une fois sans que rien ne s'en serve. Un style qui reçoit
 * `pressed` et l'ignore satisfaisait la garde tout en ne bougeant pas d'un
 * pixel ; c'est arrivé sur les vignettes de la visionneuse de carte, où
 * l'opacité de l'appui était écrasée par celle du rang deux lignes plus bas.
 *
 * Deux occurrences suffisent à distinguer les deux cas — le paramètre, puis son
 * emploi — et l'accès par propriété couvre la forme non déstructurée
 * `(etat) => etat.pressed`, qui n'en a qu'une et qui est juste.
 */
const pressedEmploye = (balise: string) =>
  /\.pressed\b/.test(balise) || (balise.match(/\bpressed\b/g) ?? []).length >= 2;

const RETOURS: (RegExp | ((b: string) => boolean))[] = [
  pressedEmploye,
  /useEnfoncement/,
  /android_ripple/,
  /\benfoncement\./,
  /\.\.\.enfoncement/,
];

/** La question posée à une balise, et le seul point où la liste se lit. */
const repond = (balise: string) =>
  RETOURS.some((forme) => (typeof forme === 'function' ? forme(balise) : forme.test(balise)));

/**
 * Les `Pressable` qui n'ont légitimement rien à montrer.
 *
 * **Chaque entrée est une décision, pas une dispense.** Un voile de fermeture
 * est transparent par nature : lui donner un retour visuel afficherait un
 * rectangle gris au milieu de l'écran. Une garde sans échappatoire se contourne
 * en désactivant la garde.
 */
const EXEMPTS: { fichier: string; testID: string; raison: string }[] = [
  {
    fichier: 'screens/FicheScreen.tsx',
    testID: 'voile-de-la-feuille',
    raison: 'un voile de fermeture est invisible par construction',
  },
];

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((entree) => {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return /\.tsx$/.test(entree) ? [chemin] : [];
  });
}

/**
 * Découpe le fichier en balises `<Pressable …>`, attributs compris.
 *
 * On s'arrête au `>` qui ferme la balise ouvrante, jamais au premier `>`
 * rencontré : `style={{ width: x > 2 }}` en contient un, et couper là ferait
 * lire une balise tronquée — donc déclarer sans retour un élément qui en a un.
 * On suit donc l'imbrication des accolades.
 */
function balisesPressable(source: string): string[] {
  const balises: string[] = [];
  let depuis = source.indexOf('<Pressable');

  while (depuis !== -1) {
    let accolades = 0;
    let i = depuis;
    for (; i < source.length; i += 1) {
      const car = source[i];
      if (car === '{') accolades += 1;
      else if (car === '}') accolades -= 1;
      else if (car === '>' && accolades === 0) break;
    }
    balises.push(source.slice(depuis, i + 1));
    depuis = source.indexOf('<Pressable', i + 1);
  }
  return balises;
}

describe('le retour au toucher', () => {
  const sansRetour: string[] = [];

  for (const chemin of fichiers(RACINE)) {
    const relatif = chemin.slice(RACINE.length + 1);

    const source = readFileSync(chemin, 'utf8');
    for (const balise of balisesPressable(source)) {
      // **L'exemption nomme un élément, plus un fichier.** Elle était posée par
      // fichier, et elle a coûté cher : écrite pour le voile de fermeture de
      // `FicheScreen`, elle couvrait aussi la porte de la galerie et la ligne
      // de la carte — les deux seuls chemins vers ce que la fiche contient, et
      // ni l'une ni l'autre ne répondait au doigt. Même chose sur les
      // visionneuses, où elle couvrait le bouton de fermeture et les vignettes
      // de page, tandis que le fond qui l'avait motivée n'existe plus.
      //
      // Une dispense large finit toujours par couvrir ce qu'elle ne visait
      // pas ; celle-ci ne dispense que le nœud qu'elle nomme.
      const id = /testID="([^"]+)"/.exec(balise)?.[1];
      if (EXEMPTS.some((e) => e.fichier === relatif && e.testID === id)) continue;
      // `disabled` sans condition : l'élément ne se presse jamais.
      if (/disabled=\{true\}/.test(balise)) continue;
      if (repond(balise)) continue;
      const ligne = source.slice(0, source.indexOf(balise)).split('\n').length;
      sansRetour.push(`${relatif}:${ligne}`);
    }
  }

  it('chaque Pressable réagit à l’appui', () => {
    expect(sansRetour).toEqual([]);
  });

  it('la garde attrape bien les quatre formes qu’elle vise', () => {
    // **On éprouve la garde elle-même**, pas seulement le dépôt. Une garde qui
    // ne reconnaîtrait qu'une forme laisserait passer les trois autres en
    // affichant un dépôt vert.
    const avec = [
      '<Pressable style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>',
      '<Pressable {...useEnfoncement()}>',
      '<Pressable android_ripple={{ color: "#000" }}>',
      '<Pressable {...enfoncement}>',
      '<Pressable onPressIn={enfoncement.onPressIn} onPressOut={enfoncement.onPressOut}>',
    ];
    for (const balise of avec) {
      expect(repond(balise)).toBe(true);
    }

    // **Et `pressed` reçu puis ignoré ne compte pas.** C'est la forme qui a
    // survécu à la mutation : un style qui déstructure l'état et ne s'en sert
    // pas satisfaisait la garde sans bouger d'un pixel.
    expect(repond('<Pressable style={({ pressed }) => ({ opacity: 0.5 })}>')).toBe(false);
    // La forme non déstructurée n'a qu'une occurrence, et elle est juste.
    expect(repond('<Pressable style={(etat) => ({ opacity: etat.pressed ? 0.7 : 1 })}>')).toBe(
      true,
    );

    // Et elle refuse ce qu'elle doit refuser.
    expect(repond('<Pressable style={{ padding: 12 }}>')).toBe(false);
  });

  it('découpe la balise jusqu’au bon chevron', () => {
    // Un `>` à l'intérieur d'une accolade ne ferme pas la balise. Couper là
    // ferait déclarer sans retour un élément qui en a un, plus loin dans ses
    // attributs — un faux positif que personne ne saurait corriger.
    const source = '<Pressable style={{ marginTop: taille > 2 ? 4 : 0 }} android_ripple={{}}>';

    const [balise] = balisesPressable(source);

    expect(balise).toBe(source);
    expect(repond(balise)).toBe(true);
  });
});

/**
 * Une dispense doit désigner quelque chose qui existe.
 *
 * Une exemption qui nomme un nœud disparu ne dispense plus rien, mais elle
 * continue de faire croire que la question a été tranchée — et c'est ainsi
 * qu'elle survit à ce qui la justifiait. Celle des visionneuses était dans ce
 * cas : elle parlait d'un fond qui se ferme au toucher, retiré depuis, et elle
 * couvrait entre-temps le bouton de fermeture et les vignettes de page.
 */
describe('les dispenses de retour au toucher', () => {
  it('chacune nomme un élément encore présent dans son fichier', () => {
    expect(EXEMPTS.length).toBeGreaterThan(0);

    for (const { fichier, testID, raison } of EXEMPTS) {
      const source = readFileSync(join(RACINE, fichier), 'utf8');
      expect({ fichier, testID, present: source.includes(`testID="${testID}"`) }).toEqual({
        fichier,
        testID,
        present: true,
      });
      // Une raison trop courte est un « parce que » : elle ne se relit pas.
      expect(raison.length).toBeGreaterThan(30);
    }
  });
});
