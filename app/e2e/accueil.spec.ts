/**
 * Le premier écran du produit, au navigateur.
 *
 * **Ce fichier éprouvait une vidéo, et la vidéo est partie.** Il lisait l'état
 * réel du lecteur — ce qu'aucun double ne donne — parce que le fond avait cassé
 * trois fois sans qu'aucun test ne rougisse : lecteur construit avant que
 * l'élément existe, `loop` posé trop tôt, pas de reprise au retour d'onglet. La
 * planche v3 retire le fond, et ces trois défauts avec.
 *
 * **Ce qui reste est le pendant de ces trois-là, et il compte davantage** :
 * c'est la première chose qu'on voit du produit, et son seul travail est de
 * faire choisir un rôle. Les deux portes doivent être là, et rien ne doit se
 * mettre derrière elles — un élément vidéo qui reviendrait ramènerait les six
 * mécanismes qu'on vient de retirer.
 */
import { expect, test } from '@playwright/test';

test('les deux portes sont là, et rien ne joue derrière', async ({ page }) => {
  await page.goto('/');

  const accueil = page.getByTestId('ecran-accueil');
  await expect(accueil.getByTestId('porte-createur')).toBeVisible();
  await expect(accueil.getByTestId('porte-commerce')).toBeVisible();

  // **Sur le document, pas sur un `testID`.** Un élément vidéo remis sans son
  // identifiant échapperait à une garde qui ne chercherait que le nom ; ce
  // qu'on refuse est le lecteur lui-même, quel que soit son nom.
  await expect(page.locator('video')).toHaveCount(0);
});

test("l'écran tient sans défiler sur un téléphone", async ({ page }) => {
  // **La contrainte qui dessine tout, vérifiée là où elle se vérifie.** Sur
  // 390 × 844, deux cartes empilées dépassaient ; côte à côte, elles tiennent.
  // Un écran qui redeviendrait défilant ramènerait le lien de connexion sous la
  // ligne de flottaison — le défaut qui a coûté à un créateur déjà inscrit tout
  // chemin vers son compte depuis son téléphone.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  // Depuis l'écran et non depuis la page : sur le web, les autres écrans
  // restent montés dans le document, et un sélecteur global finit par trouver
  // le bon nom sur le mauvais écran.
  const accueil = page.getByTestId('ecran-accueil');
  await expect(accueil).toBeVisible();
  await expect(accueil.getByTestId('vers-connexion')).toBeVisible();

  const deborde = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 1,
  );
  expect(deborde, "l'accueil déborde de la hauteur de l'écran").toBe(false);
});
