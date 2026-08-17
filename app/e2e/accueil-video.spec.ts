/**
 * La vidéo d'accueil joue.
 *
 * **Le défaut qu'on répare ici a existé, et plusieurs fois.** Le lecteur était
 * construit avant que l'élément soit attaché au document, si bien que la
 * promesse de lecture se perdait sans bruit ; puis la vidéo s'arrêtait sur sa
 * dernière image, `loop` ayant été posé trop tôt ; puis elle ne reprenait pas
 * au retour d'onglet. Chaque fois, un écran fixe, aucune erreur, aucun test
 * rouge — parce qu'aucun test ne lisait jamais un vrai lecteur.
 *
 * On éprouve ici ce qu'un double ne peut pas donner : **l'état réel de
 * l'élément vidéo**, tel que le navigateur le tient.
 */
import { expect, test } from '@playwright/test';

test('la vidéo de fond démarre et avance', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByTestId('ecran-accueil')).toBeVisible();

  const video = page.locator('video').first();
  await expect(video, "aucun élément vidéo : le fond n'est pas monté").toBeAttached();

  // Les trois attributs sans lesquels Safari refuse la lecture automatique et
  // bascule en plein écran. Ils ont chacun été oubliés une fois.
  await expect(video).toHaveJSProperty('muted', true);
  await expect(video).toHaveJSProperty('loop', true);
  expect(await video.getAttribute('playsinline')).not.toBeNull();

  // **Le fichier existe, avant de demander s'il se lit.** Un lecteur qui ne
  // démarre pas rapporte `MEDIA_ELEMENT_ERROR: Format error` aussi bien quand
  // le codec manque que quand la source répond 404 — le premier diagnostic a
  // porté sur le codec pendant deux exécutions alors que le dépôt objet était
  // vide. Le distinguer ici coûte une requête et rend l'échec lisible.
  const source = await video.evaluate((noeud: HTMLVideoElement) => noeud.currentSrc);
  const reponse = await request.get(source);
  expect(reponse.status(), `la source de la vidéo répond ${reponse.status()} : ${source}`).toBe(200);

  // **Elle joue vraiment**, et ce n'est pas la même chose que « on a demandé à
  // ce qu'elle joue » : c'est exactement la distinction que les trois défauts
  // ont exploitée.
  //
  // Le message d'échec porte l'état du lecteur. Sans lui, « reste en pause »
  // ne dit pas si le fichier n'a pas été trouvé, pas décodé, ou refusé par la
  // politique de lecture automatique — et l'écart entre une machine de
  // développement et un runner se diagnostique alors à l'aveugle, une
  // exécution de quatre minutes à la fois.
  const etat = async () =>
    video.evaluate((noeud: HTMLVideoElement) => ({
      paused: noeud.paused,
      readyState: noeud.readyState,
      networkState: noeud.networkState,
      erreur: noeud.error ? `${noeud.error.code}: ${noeud.error.message}` : null,
      source: noeud.currentSrc.slice(-60),
    }));

  await expect
    .poll(async () => JSON.stringify(await etat()), {
      message: 'la vidéo est montée mais ne joue pas',
      timeout: 20_000,
    })
    .toContain('"paused":false');

  // Et le temps avance. Une vidéo « non en pause » figée sur sa première image
  // passerait l'assertion précédente.
  const debut = await video.evaluate((noeud: HTMLVideoElement) => noeud.currentTime);
  await expect
    .poll(
      async () => video.evaluate((noeud: HTMLVideoElement) => noeud.currentTime),
      { message: 'la vidéo ne progresse pas', timeout: 20_000 },
    )
    .toBeGreaterThan(debut);
});

test("l'accueil reste utilisable quand aucun fond ne charge", async ({ page }) => {
  // Le pendant, et il compte : c'est la première chose qu'on voit du produit.
  // On coupe les médias de la plateforme et on vérifie que les portes restent.
  await page.route('**/platform-media', (route) =>
    route.fulfill({ status: 500, body: '{}', contentType: 'application/json' }),
  );

  await page.goto('/');

  const accueil = page.getByTestId('ecran-accueil');
  await expect(accueil.getByTestId('porte-createur')).toBeVisible();
  await expect(accueil.getByTestId('porte-commerce')).toBeVisible();
});
