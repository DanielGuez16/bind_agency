/**
 * Le cœur enregistre, et la liste lit ce qui est enregistré.
 *
 * **Ce parcours n'existait pas, et c'est ce qui a laissé passer le doute.**
 * Les favoris étaient éprouvés des deux côtés séparément — la route par pytest,
 * l'écran par des doubles Jest — et par personne bout à bout. Un signalement
 * « les favoris ne marchent pas » ne pouvait alors se vérifier qu'à la main :
 * rien ne disait si l'appui partait, s'il était accepté, ni si la liste
 * relisait la même chose.
 *
 * Ce que ce fichier ajoute et qu'aucun test unitaire ne peut donner : un vrai
 * navigateur, un vrai bundle, une vraie API sur une vraie base. Les trois
 * jonctions — le chemin de la route, la forme du corps envoyé, et la relecture
 * — sont exactement celles que des doubles rendent invisibles, parce qu'un
 * double répond ce qu'on lui fait dire.
 */
import { expect, test } from '@playwright/test';

import { CREATRICE, seConnecter } from './socle';

test('le cœur enregistre, et la liste le relit', async ({ page }) => {
  await seConnecter(page, CREATRICE);

  const fil = page.getByTestId('ecran-fil');
  await expect(fil.getByTestId('le-mur')).toBeVisible();

  // **La porte ne porte aucun compte au départ.** Sans ce constat, le « 1 »
  // du dessous serait vrai d'une pastille affichée en permanence.
  const porte = fil.getByTestId('voir-mes-favoris');
  await expect(fil.getByTestId('compte-des-favoris')).toHaveCount(0);

  const coeurs = fil.locator('[data-testid$="-coeur"]');
  await expect(coeurs.first()).toBeVisible();
  await coeurs.first().click();

  // Le compte paraît au premier favori — c'est le seul signe, sur le fil, que
  // l'appui a été enregistré.
  await expect(fil.getByTestId('compte-des-favoris')).toHaveText('1');
  // Et rien n'a échoué en silence : la bande le dirait.
  await expect(fil.getByTestId('favori-non-enregistre')).toHaveCount(0);

  await porte.click();

  // **La liste relit ce que le serveur a gardé**, et non ce que l'écran
  // précédent tenait en mémoire : c'est une autre route, appelée à froid.
  const favoris = page.getByTestId('ecran-favoris');
  await expect(favoris).toBeVisible();
  await expect(favoris.getByTestId('favoris-vide')).toHaveCount(0);
  await expect(favoris.locator('[data-testid^="favori-"]').first()).toBeVisible();
});
