/**
 * Un sélecteur de bout en bout se porte depuis l'écran qu'il éprouve.
 *
 * **Ce que ça répare.** Le parcours de réservation vérifiait que la réservation
 * prise apparaît dans l'historique avec `page.locator('[data-testid^="rangee-"]')`.
 * `rangee-` n'a jamais été l'historique — celui-ci nomme ses lignes
 * `reservation-<id>` — c'était la grille du **fil**, l'autre onglet, resté monté
 * dans le document par la navigation web et donc trouvé par `.first()`.
 *
 * Le test passait en regardant un écran qu'il ne visitait pas, et il ne l'a dit
 * qu'en tombant, le jour où la grille a disparu avec le mur. C'est le défaut le
 * plus coûteux de la famille : non pas un test qui ne vérifie rien, mais un test
 * qui vérifie **la mauvaise chose** et rassure sur la bonne.
 *
 * **Une suite de bout en bout y est plus exposée qu'une suite unitaire**, parce
 * que tout l'arbre est là : un sélecteur trop large trouve toujours quelque
 * chose. D'où cette garde, qui exige `page.getByTestId('ecran-x').locator(…)`
 * plutôt qu'un `page.locator(…)` global.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DOSSIER = join(__dirname, '..', 'e2e');

/**
 * Ce qui a le droit de partir de `page` sans écran devant.
 *
 * **Chaque entrée est une décision, pas une dispense.** Un écran se cherche
 * bien dans la page entière — c'est lui la portée. Une balise `video` est
 * unique au document. `getByText` et `getByRole` ne sont pas visés : ils ne
 * sont pas des sélecteurs par identifiant, et les borner demanderait une autre
 * règle que celle-ci.
 */
const AUTORISES = [
  // L'écran lui-même : c'est la portée, elle ne peut pas être portée.
  /^page\.getByTestId\('ecran-[\w-]+'\)/,
  // Un écran reçu en paramètre : une aide partagée entre parcours ne peut pas
  // nommer l'écran en dur, et le lui passer est la façon de la porter.
  /^page\.getByTestId\(ecran\)/,
  // La navigation et les gestes de la page, qui n'appartiennent à aucun écran.
  /^page\.goto\(/,
  /^page\.locator\('video'\)/,
  // **L'en-tête du document et le script du bundle.** Ils n'appartiennent à
  // aucun écran — ils existent avant que le premier soit monté, et c'est
  // justement ce qu'on éprouve d'eux : que le manifeste soit annoncé, que ce
  // qu'iOS demande y soit, et que le gabarit n'ait pas mangé le bundle. Les
  // porter par un écran serait faux au sens propre.
  //
  // La forme est étroite exprès : trois noms de balise, et un attribut. Un
  // `[data-testid=…]` ne passe pas par là, donc la règle qui compte — un
  // identifiant se cherche dans son écran — reste entière.
  /^page\.locator\('(link|meta|script)\[/,
];

/** Les appels à `page.` qui commencent une chaîne de sélection. */
function selecteurs(source: string): { ligne: number; texte: string }[] {
  const trouves: { ligne: number; texte: string }[] = [];
  source.split('\n').forEach((ligne, index) => {
    // On ignore les commentaires : ils citent les défauts qu'on a corrigés.
    if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
    for (const m of ligne.matchAll(/page\.(getByTestId|locator)\([^)]*\)/g)) {
      trouves.push({ ligne: index + 1, texte: m[0] });
    }
  });
  return trouves;
}

describe('les sélecteurs de bout en bout', () => {
  const nus: string[] = [];

  for (const fichier of readdirSync(DOSSIER).filter((f) => /\.ts$/.test(f))) {
    const source = readFileSync(join(DOSSIER, fichier), 'utf8');
    for (const { ligne, texte } of selecteurs(source)) {
      if (AUTORISES.some((forme) => forme.test(texte))) continue;
      nus.push(`${fichier}:${ligne} — ${texte}`);
    }
  }

  it('partent tous de l’écran qu’ils éprouvent', () => {
    expect(nus).toEqual([]);
  });

  it('la garde attrape bien ce qu’elle vise', () => {
    // **On éprouve la garde elle-même.** Celle qui ne reconnaîtrait que la
    // forme `locator` laisserait passer `getByTestId`, et inversement.
    const attrapes = [
      "page.locator('[data-testid^=\"rangee-\"]')",
      "page.getByTestId('confirmer')",
      "page.locator('[data-testid=\"matin\"]')",
    ];
    for (const texte of attrapes) {
      expect(AUTORISES.some((f) => f.test(texte))).toBe(false);
    }

    // Et elle laisse passer ce qui est légitime.
    for (const texte of [
      "page.getByTestId('ecran-fil')",
      'page.getByTestId(ecran)',
      "page.goto('/')",
    ]) {
      expect(AUTORISES.some((f) => f.test(texte))).toBe(true);
    }
  });

  it('ne lit pas les sélecteurs cités en commentaire', () => {
    // Les commentaires du dépôt citent les défauts corrigés — dont le
    // `rangee-` d'origine. Les compter ferait échouer la garde sur sa propre
    // explication, et le premier réflexe serait d'effacer l'explication.
    expect(selecteurs("  // visait page.locator('[data-testid^=\"rangee-\"]')")).toEqual([]);
    expect(selecteurs("  await page.getByTestId('confirmer').click();")).toHaveLength(1);
  });
});
