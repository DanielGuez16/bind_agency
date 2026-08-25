/**
 * L'installation sur un écran d'accueil, éprouvée sur le site réellement servi.
 *
 * **Pourquoi ici et pas seulement en test unitaire.** Les fichiers de `public/`
 * ne sont pas livrés parce qu'ils existent : ils le sont parce qu'`expo export`
 * les recopie à la racine. C'est une propriété du build, pas du dépôt, et elle
 * s'est déjà cassée dans l'autre sens — un favicon généré masquant celui qu'on
 * avait dessiné. Un manifeste présent dans le dépôt et absent du site donne
 * exactement ce qu'on cherche à éviter : une page qui ne propose pas de
 * s'installer, sans rien dire.
 *
 * **Ce que ces tests ne prouvent pas.** Qu'iOS accepte l'installation, et que
 * la barre de Safari reste absente une fois l'application ouverte depuis
 * l'écran d'accueil. Aucun navigateur pilotable n'a de mode autonome ; cela se
 * regarde sur un téléphone. Ce qui est éprouvable ici est **tout ce dont ce
 * comportement dépend** — les déclarations sont servies, les icônes existent
 * aux tailles annoncées, et rien dans le parcours ne sort de la portée.
 */
import { expect, test } from '@playwright/test';

test('le manifeste est servi, et il demande le plein écran', async ({ request }) => {
  // **Par requête et non par navigation.** Le type d'un manifeste est
  // `application/manifest+json` : selon le navigateur, l'ouvrir le télécharge
  // au lieu de l'afficher, et le test mesurerait alors ce comportement-là.
  const reponse = await request.get('/manifest.webmanifest');
  expect(reponse.status()).toBe(200);

  const manifeste = JSON.parse(await reponse.text());
  expect(manifeste.display).toBe('standalone');
  expect(manifeste.scope).toBe('/');
  expect(manifeste.start_url).toBe('/');
  expect(manifeste.name).toBe('BIND');
});

test('la page annonce le manifeste et ce qu’iOS demande', async ({ page }) => {
  await page.goto('/');

  // **Sur le document servi, pas sur le fichier du dépôt.** C'est la seule
  // façon de savoir qu'Expo a bien pris le gabarit comme modèle plutôt que de
  // le recopier à côté du sien.
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'BIND',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#F9F8F7');
});

test('le gabarit n’a pas mangé le bundle', async ({ page }) => {
  // **Le mode d'échec qu'on redoute le plus, et il est silencieux.** Si
  // `public/index.html` était recopié tel quel au lieu de servir de modèle, la
  // page s'afficherait — vide, sans script, sans application. Vérifié une fois
  // à la main avant d'écrire le fichier ; vérifié à chaque build par cette
  // ligne, parce qu'une version d'Expo peut changer d'avis.
  await page.goto('/');
  await expect(page.locator('script[src^="/_expo/static/js"]')).toHaveCount(1);
  await expect(page.getByTestId('ecran-accueil')).toBeVisible();
});

test('les trois icônes du manifeste sont servies, aux tailles annoncées', async ({ request }) => {
  const manifeste = JSON.parse(await (await request.get('/manifest.webmanifest')).text());
  const icones: { src: string; sizes: string }[] = manifeste.icons;

  expect(icones.length).toBe(3);
  for (const icone of icones) {
    const reponse = await request.get(icone.src);
    expect(reponse.status(), `${icone.src} doit être servie`).toBe(200);

    // Les dimensions réelles, lues dans l'en-tête PNG. Une icône servie mais
    // deux fois trop petite s'installe quand même, en flou.
    const octets = await reponse.body();
    const cote = Number(icone.sizes.split('x')[0]);
    expect(
      { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) },
      `${icone.src} annonce ${icone.sizes}`,
    ).toEqual({ largeur: cote, hauteur: cote });
  }
});

test('l’icône que Safari demande par convention est là', async ({ request }) => {
  // Elle n'est déclarée par aucune balise : Safari va la chercher tout seul.
  const reponse = await request.get('/apple-touch-icon.png');
  expect(reponse.status()).toBe(200);
});

test('l’écran de chargement de la marque est ce qu’on voit en attendant', async ({ page }) => {
  // **La première chose qu'on voit du produit, et elle n'avait aucun test.**
  //
  // **Ce test retient les polices, et ce n'est pas un artifice.** L'application
  // montre la marque pendant qu'elle attend deux choses : ses polices, puis le
  // trousseau. Sur cette machine les deux répondent en une frame, si bien
  // qu'attendre l'écran « au lancement » revenait à courir après un élément qui
  // paraît et disparaît entre deux mesures — un test qui passe ou non selon la
  // charge, c'est-à-dire pire que pas de test.
  //
  // Sur un téléphone qui ouvre l'application depuis son écran d'accueil, les
  // polices mettent bien ce temps-là. Le retard rend donc observable la
  // condition réelle, il ne la fabrique pas : ce qui est éprouvé est qu'en
  // attendant, c'est la marque qu'on voit — pas une roue, pas un blanc.
  await page.route('**/*.ttf', async (route) => {
    await new Promise((suite) => setTimeout(suite, 1_500));
    await route.continue();
  });

  await page.goto('/');
  const chargement = page.getByTestId('ecran-retablissement');
  await expect(chargement).toBeVisible();
  // Les lettres et le point sont deux tracés distincts : le point arrive en
  // dernier, et c'est lui la signature.
  await expect(chargement.getByTestId('ecran-retablissement-lettres')).toBeVisible();

  // Puis il s'efface de lui-même, sans laisser l'application derrière lui.
  await expect(page.getByTestId('ecran-accueil')).toBeVisible({ timeout: 20_000 });
});

test('le fond du document est à l’encre, pour qu’aucun blanc ne passe avant', async ({ page }) => {
  // **Ce qu'on voit avant le premier rendu.** Entre l'ouverture depuis l'écran
  // d'accueil et le premier écran, il y a le temps d'analyser un bundle d'un
  // mégaoctet et demi ; pendant ce temps le document est nu. Blanc par défaut,
  // cela fait un éclair blanc juste avant un écran de chargement à l'encre.
  await page.goto('/');
  const fond = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(fond).toBe('rgb(23, 20, 15)');
});

test('rien du premier parcours ne sort de la portée du manifeste', async ({ page }) => {
  // **Ce qui ramène la barre de Safari.** Une application autonome garde sa
  // fenêtre tant que la navigation reste dans `scope` ; une adresse hors
  // portée rouvre le navigateur par-dessus. Le produit est une application
  // d'une seule page — la navigation se fait en mémoire — et ce test le tient :
  // il refuse qu'un écran du premier parcours déclenche un chargement de
  // document vers autre chose que la racine.
  const sorties: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) sorties.push(frame.url());
  });

  await page.goto('/');
  await page.getByTestId('ecran-accueil').getByTestId('vers-connexion').click();
  await expect(page.getByTestId('ecran-auth')).toBeVisible();

  const origine = new URL(page.url()).origin;
  for (const url of sorties) {
    expect(url.startsWith(origine), `${url} sort de la portée`).toBe(true);
  }
});
