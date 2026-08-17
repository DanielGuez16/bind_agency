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
  // `salon-` et non `commerce-` : la carte du fil n'existe plus, le mur pose
  // des photos. Le parcours, lui, est le même — c'est ce que ce test éprouve.
  const salon = page.locator('[data-testid^="salon-"]').first();
  await expect(salon, 'le fil est vide : aucun salon à réserver').toBeVisible();
  await salon.click();

  // La fiche, et la première offre ouverte.
  await expect(page.getByTestId('ecran-fiche')).toBeVisible();
  await page.getByRole('button', { name: 'Book' }).first().click();

  // Les créneaux. On prend le premier libre, quel que soit le groupe.
  await expect(page.getByTestId('ecran-creneaux')).toBeVisible();
  const creneau = page
    .locator('[data-testid="matin"], [data-testid="apres-midi"]')
    .getByRole('button')
    .first();
  await expect(creneau, 'aucun créneau libre dans l’horizon').toBeVisible();
  await creneau.click();

  await page.getByTestId('confirmer').click();

  // **On atterrit sur la liste, pas sur le code.** La prestation est dans
  // plusieurs jours, et la validation par le salon est le comportement par
  // défaut : le code n'existe pas encore.
  await expect(page.getByTestId('ecran-historique')).toBeVisible();
  await expect(page.getByTestId('ecran-code')).toHaveCount(0);

  // La réservation qu'on vient de prendre est dans la liste.
  await expect(page.locator('[data-testid^="rangee-"]').first()).toBeVisible();
});

test('une réservation confirmée mène à son code', async ({ page }) => {
  // Le jeu de données en pose une déjà confirmée : c'est le seul moyen de
  // descendre jusqu'au code sans qu'un salon accepte entre-temps.
  await page.setViewportSize(LARGEURS.telephone);
  await seConnecter(page, CREATRICE);

  await page.getByText('Bookings', { exact: true }).first().click();
  await expect(page.getByTestId('ecran-historique')).toBeVisible();

  const ouvrable = page.getByText('Show code ›', { exact: true }).first();
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
  await expect(page.getByTestId('qr')).toBeVisible();
  await expect(page.getByTestId('secours')).toBeVisible();
  await expect(page.getByTestId('compte-a-rebours')).toBeVisible();
});
