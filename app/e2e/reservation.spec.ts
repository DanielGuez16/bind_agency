/**
 * Le parcours complet : du fil jusqu'au code de retrait.
 *
 * **C'est le seul test du dépôt qui traverse tout le produit d'un bout à
 * l'autre**, sur une vraie base, avec un vrai serveur, dans un vrai navigateur.
 * Les tests unitaires éprouvent chaque maillon ; celui-ci éprouve qu'ils sont
 * accrochés les uns aux autres — ce qu'aucun d'eux ne peut dire.
 *
 * Il descend jusqu'au code parce que c'est là que la boucle se referme : une
 * réservation qu'on ne peut pas présenter au comptoir ne vaut rien.
 */
import { expect, test } from '@playwright/test';

import { accorderLaPosition, CREATRICE, LARGEURS, seConnecter } from './socle';

test('réserver un créneau, puis retrouver son code', async ({ page }) => {
  await page.setViewportSize(LARGEURS.telephone);
  await seConnecter(page, CREATRICE);

  // Le fil, une fois la position accordée par un geste — comme dans le
  // produit, qui ne demande rien au démarrage.
  await expect(page.getByTestId('ecran-fil')).toBeVisible();
  await accorderLaPosition(page);
  // Le préfixe a changé cinq fois — `commerce-`, `salon-`, `apercu-`,
  // `salon-`, et maintenant `<rangée>-apercu-<article>` : le fil v5 rend une
  // carte par prestation, en rangées de catégorie. Le parcours qu'il ouvre,
  // lui, n'a jamais bougé, et c'est ce que ce test éprouve.
  //
  // **La première rangée est « le plus près de toi »**, qui ne filtre rien :
  // la première carte visible en vient, ce qui est exactement ce qu'une
  // créatrice appuierait.
  const carte = page.getByTestId('ecran-fil').locator('[data-testid*="-apercu-"]').first();
  await expect(carte, 'le fil est vide : aucune carte à ouvrir').toBeVisible();
  await carte.click();

  // La fiche, et la première offre ouverte.
  await expect(page.getByTestId('ecran-fiche')).toBeVisible();
  await page.getByRole('button', { name: 'Book' }).first().click();

  // Les créneaux. On prend le premier libre, quel que soit le groupe.
  await expect(page.getByTestId('ecran-creneaux')).toBeVisible();
  const creneau = page
    .getByTestId('ecran-creneaux')
    .locator('[data-testid="matin"], [data-testid="apres-midi"]')
    .getByRole('button')
    .first();
  await expect(creneau, 'aucun créneau libre dans l’horizon').toBeVisible();
  await creneau.click();

  // **Le consentement est un geste, et il est obligatoire depuis C3.** Sans lui
  // le bouton reste verrouillé : le test attendait deux minutes sur un bouton
  // mort, et c'est le seul endroit du parcours de bout en bout qui l'aurait dit.
  await page.getByTestId('ecran-creneaux').getByTestId('bascule-engagement').click();
  await page.getByTestId('ecran-creneaux').getByTestId('confirmer').click();

  // **On atterrit sur la liste, pas sur le code.** La prestation est dans
  // plusieurs jours, et la validation par le salon est le comportement par
  // défaut : le code n'existe pas encore.
  await expect(page.getByTestId('ecran-historique')).toBeVisible();
  await expect(page.getByTestId('ecran-code')).toHaveCount(0);

  // La réservation qu'on vient de prendre est dans la liste.
  //
  // **Cette assertion visait `rangee-`, et ne prouvait rien.** L'historique
  // nomme ses lignes `reservation-<id>` ; `rangee-` était la grille du fil, dans
  // l'autre onglet — resté monté dans le document, donc trouvé par `.first()`.
  // Le test passait en regardant un écran qu'il ne visitait pas. Il ne l'a dit
  // qu'en tombant, le jour où la grille a disparu.
  await expect(
    page.getByTestId('ecran-historique').locator('[data-testid^="reservation-"]').first(),
  ).toBeVisible();
});

test('une réservation confirmée mène à son code', async ({ page }) => {
  // Le jeu de données en pose une déjà confirmée : c'est le seul moyen de
  // descendre jusqu'au code sans qu'un salon accepte entre-temps.
  await page.setViewportSize(LARGEURS.telephone);
  await seConnecter(page, CREATRICE);

  await page.getByText('Bookings', { exact: true }).first().click();
  await expect(page.getByTestId('ecran-historique')).toBeVisible();

  // **Le sélecteur porte sur l'action, pas sur son libellé.** Il visait
  // « Show code › », un texte : le jour où la ligne a porté un vrai bouton, ce
  // test est tombé sur un écran parfaitement fonctionnel. Un libellé est une
  // décision de composition et il changera encore ; l'action, elle, est ce que
  // le parcours éprouve. Et il part de l'écran plutôt que de la page, comme le
  // reste de cette suite depuis #137.
  // **L'onglet d'abord, depuis la v7.** Les onglets suivent l'ordre de ce qu'on
  // doit faire : celui qui s'ouvre porte les contreparties à envoyer, dont le
  // geste mène à l'écran de preuve. Une réservation confirmée vit sous
  // « Booked », et prendre le premier geste de l'écran ouvrait donc le bon
  // bouton d'un autre parcours — un test vert qui aurait éprouvé autre chose.
  // Par le rôle et non par le texte : l'onglet affiche « Booked · 3 », son
  // compte compris, et un libellé exact n'y trouvait rien.
  // **« Booked » et non « Upcoming » depuis le quatrième onglet** : la cellule
  // est passée de 103,3 à 73,5 points et `Upcoming` en rendait 74,0 — il
  // débordait. La garde de largeur l'acceptait pourtant, sa formule se trompant
  // de 11 % dans le sens dangereux.
  await page.getByRole('tab', { name: /Booked/ }).click();

  const ouvrable = page
    .getByTestId('ecran-historique')
    .locator('[data-testid^="agir-"]')
    .first();
  await expect(ouvrable, 'aucune réservation confirmée dans le jeu de données').toBeVisible();
  await ouvrable.click();

  // **Le code existe et se présente.** C'est le dernier maillon : une
  // réservation qu'on ne peut pas présenter au comptoir ne vaut rien. La
  // rotation a son test unitaire ; ce qu'on éprouve ici est que l'écran
  // s'ouvre et que le serveur rend un code, ce que ni l'un ni l'autre ne
  // prouve seul.
  //
  // **Le QR et non plus les six chiffres.** Ils ne s'affichent plus : ils ne se
  // saisissent pas, ne désignent rien seuls, et se confondaient avec le code de
  // secours qu'on dicte. Ce qui prouve qu'un code est arrivé est ce que la
  // caisse scanne — et le code de secours, qui est le seul qu'on lise à voix
  // haute.
  const code = page.getByTestId('ecran-code');
  await expect(code.getByTestId('qr')).toBeVisible();
  await expect(code.getByTestId('secours')).toBeVisible();
  // **Et rien d'autre : le décompte est parti avec le reste du chrome.** Le
  // code tourne côté serveur, donc l'écran n'a rien à promettre sur sa durée.
  // L'assertion négative est ce qui rend le retrait tenable de bout en bout —
  // sans elle, remettre le décompte ne ferait rougir personne.
  await expect(code.getByTestId('compte-a-rebours')).toHaveCount(0);
  await expect(code.getByTestId('ou-aller')).toHaveCount(0);
});
