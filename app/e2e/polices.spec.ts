/**
 * Les polices sont réellement déclarées, servies et chargées.
 *
 * **Le défaut d'origine.** Les trois familles étaient nommées dans les jetons,
 * demandées par `Texte`, et **aucune n'était chargée** : ni `expo-font`, ni un
 * fichier de fonte dans le dépôt. Tout le produit rendait en police système,
 * sans erreur, sans test rouge, sans rien qui le signale.
 *
 * **Ce que ces tests éprouvent, et ce qu'ils n'éprouvent pas.** Ils vérifient
 * que les fontes sont déclarées sous les noms que le thème demande, servies par
 * le serveur, et réellement chargées par le navigateur. Ils ne vérifient pas
 * encore qu'un texte les *emploie* : cette assertion échoue aujourd'hui, et la
 * cause est ouverte — voir `TASKS.md`. Écrire ici un test vert sur une
 * propriété fausse serait pire que de ne rien écrire.
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
 * `nomDeFonte` rend « Familjen Grotesk 600 » et non « Familjen Grotesk » : sur
 * iOS et Android, `fontWeight` ne choisit pas un fichier, et une graisse
 * absente est synthétisée par le moteur. Chaque graisse est donc enregistrée
 * sous son propre nom, et c'est ce nom-là qu'il faut chercher.
 */
const FACES_ATTENDUES = ['Familjen Grotesk', 'IBM Plex Sans', 'IBM Plex Mono'];

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
