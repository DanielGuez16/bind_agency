/**
 * Les polices sont réellement déclarées, servies et chargées.
 *
 * **Le défaut d'origine.** Les trois familles étaient nommées dans les jetons,
 * demandées par `Texte`, et **aucune n'était chargée** : ni `expo-font`, ni un
 * fichier de fonte dans le dépôt. Tout le produit rendait en police système,
 * sans erreur, sans test rouge, sans rien qui le signale.
 *
 * **La cause, trouvée depuis.** Déclarées, servies, chargées — et pas une ligne
 * de texte ne les employait. `react-native-web` écrit `fontFamily` **verbatim**,
 * sans guillemets : le nom arrivait tel quel dans `font-family:`. Or un nom de
 * famille non guillemeté est une suite d'identifiants CSS, et un identifiant ne
 * peut pas commencer par un chiffre — « IBM Plex Sans 600 » invalidait donc la
 * déclaration **entière**, que le navigateur jetait en silence. Les noms sont
 * désormais d'un seul tenant : « IBMPlexSans_600 ».
 *
 * Le dernier test est celui qui manquait, et le seul qui aurait attrapé le
 * défaut : il lit la police **effectivement employée** par un élément rendu.
 *
 * **Attention au piège de `document.fonts.check`.** Avec un nom de famille nu,
 * il répond vrai même quand la famille n'existe pas : le navigateur considère
 * que le texte peut être rendu, en repli. La première version de ce fichier
 * s'en servait et passait sans rien prouver. On lit donc les faces
 * enregistrées, une à une, sous leur nom exact.
 */
import { expect, test } from '@playwright/test';

/**
 * Les noms **avec graisse**, tels que le thème les demande.
 *
 * `nomDeFonte` rend « PlusJakartaSans_600 » et non « Plus Jakarta Sans » : sur
 * iOS et Android,
 * `fontWeight` ne choisit pas un fichier, et une graisse absente est
 * synthétisée par le moteur. Chaque graisse est donc enregistrée sous son
 * propre nom, et c'est ce nom-là qu'il faut chercher.
 *
 * **Deux familles au lieu de trois depuis la v1.1** : `display` et `sans`
 * nomment la même fonte, l'accent étant devenu une graisse et non une voix.
 */
const FACES_ATTENDUES = ['PlusJakartaSans_', 'IBMPlexMono_'];

/**
 * Les familles retirées, v1.0 et v1.1 confondues.
 *
 * Elles sont vérifiées **absentes** et pas seulement remplacées : un
 * `@font-face` orphelin qui survivrait au changement ne casserait rien de
 * visible, continuerait de peser au démarrage, et laisserait croire que la
 * bascule est faite là où elle ne l'est qu'à moitié.
 *
 * La liste ne se vide pas d'une direction à l'autre, elle s'allonge : le Didone
 * et le géométrique de la v1.0 rejoignent les deux de la v0.7. C'est la seule
 * façon qu'une famille abandonnée deux directions plus tôt ne revienne pas par
 * une dépendance transitive.
 */
const FACES_RETIREES = [
  'FamiljenGrotesk_',
  'IBMPlexSans_',
  'BodoniModa_',
  'Outfit_',
];

test('les trois familles sont déclarées sous les noms que le thème demande', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('ecran-accueil')).toBeVisible();

  // `forEach` et non l'itérateur : `FontFaceSet` n'est itérable que si la
  // configuration TypeScript charge `DOM.Iterable`, que l'app — écrite pour
  // React Native — n'a aucune raison de charger.
  const faces = await page.evaluate(() => {
    const noms: string[] = [];
    document.fonts.forEach((face) => noms.push(face.family));
    return noms;
  });

  expect(faces.length, 'aucune face enregistrée : expo-font n’a rien posé').toBeGreaterThan(0);
  for (const famille of FACES_ATTENDUES) {
    expect(
      faces.some((nom) => nom.startsWith(famille)),
      `aucune face « ${famille} » : les jetons la nomment et rien ne la charge`,
    ).toBe(true);
  }
  for (const retiree of FACES_RETIREES) {
    expect(
      faces.filter((nom) => nom.startsWith(retiree)),
      `« ${retiree} » est retirée par la v1.0 et pèse encore au démarrage`,
    ).toEqual([]);
  }
});

test('les fichiers de fonte sont réellement servis et chargés', async ({ page }) => {
  // Déclarée ne veut pas dire servie : une `@font-face` qui pointe vers un
  // fichier absent s'enregistre parfaitement et ne rend jamais un glyphe.
  const servies: number[] = [];
  page.on('response', (reponse) => {
    if (/\.(ttf|otf|woff2?)(\?|$)/.test(reponse.url())) servies.push(reponse.status());
  });

  await page.goto('/');
  await expect(page.getByTestId('ecran-accueil')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          let chargees = 0;
          document.fonts.forEach((face) => {
            if (face.status === 'loaded') chargees += 1;
          });
          return chargees;
        }),
      { message: 'aucune face n’atteint l’état « loaded »', timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  expect(servies.length, 'aucun fichier de fonte demandé au serveur').toBeGreaterThan(0);
  expect(servies.filter((code) => code >= 400), 'un fichier de fonte répond en erreur').toEqual([]);
});

test('le texte rendu emploie réellement la fonte, et non la pile système', async ({ page }) => {
  // **Le test qui manquait.** Les trois précédents passaient pendant que cent
  // pour cent du texte rendait en police système : une face enregistrée et
  // chargée ne prouve pas qu'un élément la demande, ni que sa demande est
  // valide. Celui-ci lit ce que le navigateur applique vraiment.
  await page.goto('/');
  await expect(page.getByTestId('ecran-accueil')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // **Le mot accentué, et non le titre entier.** Depuis la v1.0, un titre à
  // bloc est une pile de vues dont un seul nœud porte du texte ; lire le
  // conteneur rendait la pile système parce qu'aucune famille n'y est
  // déclarée — et le test tombait sur la structure, pas sur la fonte.
  const employee = await page
    .getByTestId('promesse-accueil-mot')
    .evaluate((noeud) => getComputedStyle(noeud).fontFamily);

  // La pile système de `react-native-web` commence par `-apple-system` : la
  // retrouver ici signifie que la déclaration de l'app a été jetée.
  expect(employee, 'le texte est rendu dans la pile système').not.toContain('-apple-system');
  expect(employee).toMatch(/PlusJakartaSans_/);
});

test('aucune graisse n’est synthétisée par-dessus une face déjà dessinée', async ({ page }) => {
  // Chaque fichier est enregistré sans descripteur de graisse : pour le
  // navigateur, la face est normale. Demander 600 par-dessus la ferait grossir
  // une seconde fois, et le trait s'épaissirait salement.
  await page.goto('/');
  await expect(page.getByTestId('ecran-accueil')).toBeVisible();

  const graisse = await page
    .getByTestId('promesse-accueil-mot')
    .evaluate((noeud) => getComputedStyle(noeud).fontWeight);

  expect(graisse, 'une graisse demandée en plus du nom fait doubler le gras').toBe('400');
});
