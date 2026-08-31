/**
 * Une navigation existe à toute largeur.
 *
 * **Le défaut qu'on répare ici a existé.** `tabBar` avait été rangé dans
 * `screenOptions` au lieu d'être passé au navigateur : la barre latérale
 * n'était jamais montée, et comme la barre du bas était masquée au-delà du
 * seuil, il ne restait **aucune** navigation. Un test unitaire ne l'a pas vu —
 * il ne mesure aucune fenêtre — et personne ne l'a vu non plus tant qu'on n'a
 * pas ouvert l'app sur un grand écran.
 *
 * On n'éprouve donc pas « la barre latérale est là » : on éprouve qu'**un
 * chemin existe**, quelle que soit la barre qui le porte. C'est la propriété
 * dont l'absence rend le produit inutilisable, et elle ne dépend pas de la
 * forme retenue.
 */
import { expect, test } from '@playwright/test';

import { CREATRICE, LARGEURS, ongletsVisibles, seConnecter } from './socle';

for (const [nom, taille] of Object.entries(LARGEURS)) {
  test(`la navigation existe en ${nom}`, async ({ page }) => {
    await page.setViewportSize(taille);
    await seConnecter(page, CREATRICE);

    const onglets = await ongletsVisibles(page);

    expect(onglets.length, `aucune navigation visible en ${nom}`).toBeGreaterThan(2);
    // Et elle mène quelque part : un libellé affiché sans cible serait un
    // décor. On presse, et l'écran change.
    // **Deux appuis depuis la fusion, et le second est le vrai sujet.**
    // Les réglages ne sont plus un onglet : le profil les porte derrière un
    // engrenage. Un test qui s'arrêterait au profil ne dirait plus si
    // l'engrenage mène quelque part, et c'est précisément le chemin neuf.
    await page.getByText('Profile', { exact: true }).first().click();
    await page.getByTestId('ecran-profil').getByTestId('ouvrir-les-reglages').click();
    await expect(page.getByTestId('ecran-reglages')).toBeVisible();
  });
}

test('la bascule de largeur ne fait pas disparaître la navigation', async ({ page }) => {
  // Le cas exact du défaut : on traverse le seuil. Une barre qui n'existe que
  // dans un sens se voit ici et nulle part ailleurs.
  await page.setViewportSize(LARGEURS.telephone);
  await seConnecter(page, CREATRICE);
  expect(await ongletsVisibles(page)).not.toHaveLength(0);

  await page.setViewportSize(LARGEURS.bureau);
  await expect
    .poll(async () => (await ongletsVisibles(page)).length, {
      message: 'la navigation a disparu en passant en grand écran',
    })
    .toBeGreaterThan(2);

  await page.setViewportSize(LARGEURS.telephone);
  await expect
    .poll(async () => (await ongletsVisibles(page)).length, {
      message: 'la navigation a disparu en revenant en petit écran',
    })
    .toBeGreaterThan(2);
});
