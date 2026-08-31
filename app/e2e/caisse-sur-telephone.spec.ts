/**
 * La caisse s'ouvre-t-elle sur un téléphone.
 *
 * **Ce test existe parce qu'aucun autre ne pouvait le voir.** L'onglet
 * « Register » se rendait vide sur mobile : l'en-tête et les onglets
 * s'affichaient, et rien en dessous — ni champ de code, ni scanner, ni pavé.
 * Aucune erreur en console, parce qu'il n'y avait pas d'erreur : un `flex: 1`
 * dans une colonne à l'intérieur d'un `ScrollView` vaut une hauteur, et une
 * hauteur en `flex` sans hauteur à distribuer vaut zéro. La mise en page
 * faisait exactement ce qu'on lui demandait.
 *
 * **Les tests unitaires ne pouvaient pas le dire** : ils inspectent l'arbre, où
 * les composants étaient bien présents. Il n'y a pas de moteur de mise en page
 * dans `test-renderer`. Et l'e2e ne le voyait pas non plus, faute d'une largeur
 * de téléphone — le seul projet configuré est un écran de bureau, où la
 * `flexDirection` est `row` et où `flex: 1` vaut une largeur, donc marche.
 *
 * Deuxième fois en deux jours qu'un défaut ne se voit que dans un navigateur :
 * l'état d'un cœur qui n'arrivait pas au DOM, et maintenant une hauteur nulle.
 * Voir `DECISIONS.md`.
 */
import { expect, test } from '@playwright/test';

import { LARGEURS, seConnecter } from './socle';

test('la caisse porte son champ de code sur un téléphone', async ({ page }) => {
  // **On se connecte large, puis on rétrécit.** `seConnecter` attend
  // « Settings » pour savoir que la navigation est montée ; en largeur de
  // téléphone ce libellé passe dans le menu « More » et l'attente expire. Ce
  // qu'on éprouve ici est la caisse à l'étroit, pas la connexion : la réduire
  // après coup donne exactement le même rendu de l'écran visé.
  await seConnecter(page, 'ocean@bind.example');
  await page.setViewportSize(LARGEURS.telephone);

  await page.getByText('Register', { exact: true }).first().click();

  const caisse = page.getByTestId('ecran-caisse');
  await expect(caisse.getByTestId('entete-caisse')).toBeVisible();

  // **Ce que l'en-tête ne prouve pas.** Il se rendait, lui : il est au-dessus
  // du bloc effondré. C'est ce qui suit qui manquait, et c'est ce qui sert.
  await expect(caisse.getByTestId('onglets-caisse')).toBeVisible();
  await expect(caisse.getByTestId('champ-code')).toBeVisible();
  await expect(caisse.getByTestId('valider-code')).toBeVisible();

  // Et le bloc a une hauteur réelle : « visible » au sens de Playwright exige
  // déjà une boîte non vide, mais le dire ici nomme ce qui était faux.
  const boite = await caisse.getByTestId('champ-code').boundingBox();
  expect(boite?.height ?? 0).toBeGreaterThan(0);
});
