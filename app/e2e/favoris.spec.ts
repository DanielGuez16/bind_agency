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
 *
 * **Le parcours a changé d'écran en v4, pas de nature.** Le fil rend une carte
 * par salon : le cœur y désignerait un contenant de plusieurs prestations, donc
 * il vit sur la fiche, ligne par ligne. Ce qui reste sur le fil est la porte,
 * qui porte le compte — et le compte est justement ce qui traverse les deux
 * écrans et la base.
 */
import { expect, test } from '@playwright/test';

import { CREATRICE, seConnecter } from './socle';

test('le cœur enregistre, et la liste le relit', async ({ page }) => {
  await seConnecter(page, CREATRICE);

  const fil = page.getByTestId('ecran-fil');
  await expect(fil.getByTestId('le-mur')).toBeVisible();

  // **Le compte de départ est relevé, pas supposé nul.** Il l'était : le jeu de
  // démonstration ne posait aucun favori, et le test lisait « 0 » puis « 1 ».
  // Le jeu en pose maintenant — la liste des favoris montrait son état vide là
  // où elle doit montrer ses quatre états, dont celui qui n'est plus à portée.
  //
  // Un écart vaut mieux qu'une valeur absolue de toute façon : il éprouve la
  // même chose — la pastille a bougé de un — sans dépendre de ce que le jeu
  // contient. Le `+1` du dessous reste donc faux d'une pastille affichée en
  // permanence, qui est ce que ce constat protège.
  const porte = fil.getByTestId('compte-des-favoris');
  const depart = (await porte.count()) ? Number(await porte.textContent()) : 0;

  // Et aucune carte de salon ne porte de cœur : il a quitté le fil.
  await expect(fil.locator('[data-testid$="-coeur"]')).toHaveCount(0);

  // On ouvre un salon, et c'est là que le cœur se pose.
  await fil.locator('[data-testid*="-apercu-"]').first().click();

  const fiche = page.getByTestId('ecran-fiche');
  await expect(fiche).toBeVisible();
  // **Un cœur qui n'est pas déjà posé**, et c'est ce qui rend le test stable.
  // Le jeu de démonstration garde des prestations pour cette créatrice ; en
  // prenant le premier cœur venu, on tombait sur l'un d'eux et l'appui le
  // **retirait** — la pastille descendait de un là où le test en attendait un
  // de plus. Le cœur porte son état : `accessibilityState.selected` devient
  // `aria-checked` sur le web, et c'est lui qui départage.
  const coeur = fiche
    .locator('[data-testid$="-coeur"]:not([aria-checked="true"]):not([aria-selected="true"])')
    .first();
  await expect(coeur).toBeVisible();
  await coeur.click();

  // Rien n'a échoué en silence : la bande le dirait.
  await expect(fiche.getByTestId('favori-non-enregistre')).toHaveCount(0);

  // **On revient par le contrôle de l'écran, pas par l'historique du
  // navigateur.** `page.goBack()` sort de l'application : la pile a été
  // atteinte par une navigation interne, il n'y a pas d'entrée d'historique
  // derrière elle, et le navigateur remonte à la page d'avant — mesuré, il
  // atterrit sur `about:blank`. Ce n'est pas le geste qu'un lecteur fait.
  await fiche.getByTestId('retour').click();

  // **Le compte du fil s'est mis à jour**, et il vient du serveur : la pile
  // garde le fil monté dessous, donc sans le signal il resterait celui du
  // dernier chargement.
  await expect(porte).toHaveText(String(depart + 1));

  await fil.getByTestId('voir-mes-favoris').click();

  // **La liste relit ce que le serveur a gardé**, et non ce que l'écran
  // précédent tenait en mémoire : c'est une autre route, appelée à froid.
  const favoris = page.getByTestId('ecran-favoris');
  await expect(favoris).toBeVisible();
  await expect(favoris.getByTestId('favoris-vide')).toHaveCount(0);
  await expect(favoris.locator('[data-testid^="favori-"]').first()).toBeVisible();
});
