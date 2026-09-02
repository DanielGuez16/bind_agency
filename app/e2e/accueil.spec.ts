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

test("les promesses ne passent pas sous les boutons, sur un téléphone", async ({ page }) => {
  /**
   * **Le défaut que le test voisin ne pouvait pas voir.** Il mesure le
   * défilement du document, et le document ne défile pas : le texte des puces
   * déborde *à l'intérieur* de la carte et se dessine par-dessus le bouton.
   * Une garde qui mesure la page entière ne dit rien de ce qui se chevauche
   * dedans — et celle-ci est restée verte pendant que l'écran était cassé en
   * campagne.
   *
   * **Les deux langues, et l'espagnol décide.** Il est plus long : un écran qui
   * tient en anglais et déborde en espagnol est un écran qui déborde. La
   * bascule n'est pas atteignable depuis l'accueil, mais elle n'a pas à
   * l'être — `expo-localization` lit la langue du navigateur sur le web, et
   * Playwright la pose. Le second cas est le même test sous `es-ES`.
   */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const accueil = page.getByTestId('ecran-accueil');
  await expect(accueil).toBeVisible();

  const portes = [
    { role: 'creator', carte: 'porte-createur' },
    { role: 'business_member', carte: 'porte-commerce' },
  ] as const;

  for (const { role, carte: repere } of portes) {
    const carte = accueil.getByTestId(repere);
    const bouton = accueil.getByTestId(`choisir-${role}`);

    const cadreDuBouton = await bouton.boundingBox();
    expect(cadreDuBouton, `le bouton ${role} n'a pas de cadre`).not.toBeNull();

    // **La promesse, comparée au haut du bouton.** C'est le dernier texte de
    // la carte, donc celui qui déborderait le premier — les trois phrases
    // qu'elle remplace ont été retirées, et viser le rôle ne mesurait plus
    // rien : il est en haut, il ne peut pas passer sous le bouton. Un
    // chevauchement d'un seul point est déjà le défaut.
    const role_ = carte.getByTestId(`${repere}-promesse`);
    const cadre = await role_.boundingBox();
    expect(cadre, `l'intitulé de ${role} n'a pas de cadre`).not.toBeNull();
    expect(
      cadre!.y + cadre!.height,
      `l'intitulé de ${role} descend sous le haut du bouton`,
    ).toBeLessThanOrEqual(cadreDuBouton!.y + 1);
  }
});

test('le champ découpe ce qu’il contient, et le navigateur ne le repeint pas', async ({
  page,
}) => {
  /**
   * **Trois symptômes, un seul défaut.** « Carré, il sort des bords, fond
   * jaune » : l'`input` est un enfant carré qui porte son propre fond, le
   * conteneur arrondi ne le découpait pas, et l'autoremplissage lui peignait un
   * aplat que le champ n'a jamais demandé.
   *
   * Les deux moitiés se vérifient séparément — le découpage tient sur toutes
   * les plateformes, la neutralisation n'existe que sur le web.
   */
  await page.goto('/');

  // Depuis l'écran et non depuis la page : sur le web, les autres écrans
  // restent montés dans le document, et un sélecteur global finit par trouver
  // le bon nom sur le mauvais écran.
  const accueil = page.getByTestId('ecran-accueil');
  await accueil.getByTestId('choisir-creator').click();

  const auth = page.getByTestId('ecran-auth');
  const champ = auth.getByTestId('champ-email');
  await expect(champ).toBeVisible();

  // Le conteneur découpe : sans cela, aucun enfant n'est tenu par le rayon.
  const decoupe = await champ.evaluate((noeud) => {
    const parent = noeud.parentElement!;
    const style = getComputedStyle(parent);
    return { overflow: style.overflow, rayon: style.borderRadius };
  });
  expect(decoupe.overflow, 'le champ ne découpe pas ce qu’il contient').toBe('hidden');
  expect(decoupe.rayon, 'le champ n’est plus arrondi').not.toBe('0px');

  // Et la règle qui empêche le jaune est bien dans le document.
  const neutralise = await page.evaluate(() =>
    Array.from(document.styleSheets).some((feuille) => {
      try {
        return Array.from(feuille.cssRules).some((regle) =>
          regle.cssText.includes('-webkit-autofill'),
        );
      } catch {
        // Une feuille d'une autre origine refuse ses règles : ce n'est pas la
        // nôtre, et la lire n'apprendrait rien.
        return false;
      }
    }),
  );
  expect(neutralise, 'rien ne neutralise le fond de l’autoremplissage').toBe(true);
});

test.describe('en espagnol, qui est plus long', () => {
  test.use({ locale: 'es-ES' });

  test('les promesses ne passent pas non plus sous les boutons', async ({ page }) => {
    /**
     * **C'est l'espagnol qui décide de la hauteur réelle.** L'anglais tenait
     * déjà ; ce test existe parce que la traduction la plus longue est celle
     * qui déborde, et qu'on ne la regarde pas en développant.
     *
     * La langue vient du contexte du navigateur, pas d'un réglage de
     * l'application : `expo-localization` lit `navigator.language` sur le web,
     * et c'est ce que `test.use({ locale })` pose.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const accueil = page.getByTestId('ecran-accueil');
    await expect(accueil).toBeVisible();

    // La garde regarde bien de l'espagnol : sans cela, une bascule de langue
    // qui cesserait de fonctionner rendrait ce test identique au précédent.
    // La garde regarde bien de l'espagnol : l'intitulé du rôle est le texte qui
    // reste sur la carte, et « A creator » n'y a plus sa place.
    // La garde regarde bien de l'espagnol : la promesse est le texte de la
    // carte, et sa version anglaise n'y a plus sa place.
    await expect(accueil.getByTestId('porte-createur-promesse')).not.toHaveText(
      /Book the salon/i,
    );

    const portes = [
      { role: 'creator', carte: 'porte-createur' },
      { role: 'business_member', carte: 'porte-commerce' },
    ] as const;

    for (const { role, carte: repere } of portes) {
      const carte = accueil.getByTestId(repere);
      const cadreDuBouton = await accueil.getByTestId(`choisir-${role}`).boundingBox();
      expect(cadreDuBouton, `le bouton ${role} n'a pas de cadre`).not.toBeNull();

      const cadre = await carte.getByTestId(`${repere}-promesse`).boundingBox();
      expect(cadre, `l'intitulé de ${role} n'a pas de cadre`).not.toBeNull();
      expect(
        cadre!.y + cadre!.height,
        `l'intitulé de ${role} descend sous le haut du bouton`,
      ).toBeLessThanOrEqual(cadreDuBouton!.y + 1);
    }
  });
});
