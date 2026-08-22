/**
 * Tout écran empilé offre une issue.
 *
 * **Sur le web il n'y a ni geste de balayage ni bouton système.** Un écran
 * ouvert depuis un autre s'y quitte par le contrôle qu'il affiche, ou ne s'y
 * quitte pas du tout — on change alors d'onglet, ce qui perd la pile et ramène
 * à un endroit qu'on n'avait pas demandé. Trois écrans étaient dans ce cas, et
 * le code de retrait était le pire : plein écran, noir, sans une seule sortie.
 *
 * La vérification se fait sur `Navigation.tsx` et non écran par écran, parce
 * que c'est là que la question se pose : un écran ne sait pas s'il est empilé
 * ou monté comme onglet, seul le navigateur le sait. C'est aussi le fichier
 * qu'on modifie en ajoutant un écran, donc celui où le manque doit crier.
 *
 * **Les racines de pile sont nommées, avec leur raison.** Une racine n'a rien
 * derrière elle : lui demander un retour dessinerait un bouton qui ne mène
 * nulle part. La liste est fermée — un écran ajouté sans y figurer doit offrir
 * une issue, et c'est le bon défaut.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const NAVIGATION = join(__dirname, '..', 'src', 'shell', 'Navigation.tsx');

/**
 * Les premiers écrans de chaque pile. Rien derrière eux.
 *
 * `Fil`, `Historique`, `Journee`, `Paliers` et `Configuration` sont les points
 * d'entrée de leurs onglets respectifs ; `Caisse` est le second onglet du
 * commerce, pas un empilement. `Paliers` a gagné une pile en v0.7 : les règles
 * s'y empilent en compact, mais l'échelle reste la racine de l'onglet.
 */
const RACINES = [
  'Fil',
  'Historique',
  'Journee',
  'Caisse',
  'Configuration',
  'Paliers',
  // `Annuaire` a gagné une pile : l'abonnement s'y empile depuis son refus.
  'Annuaire',
  // `Audience` a gagné une pile avec la v3 : le score s'y empile, mais
  // l'audience reste la racine de son onglet.
  'Audience',
];

/** Les écrans déclarés dans une pile, et le bloc JSX qui les monte. */
function ecransEmpiles(source: string): { nom: string; bloc: string }[] {
  const ouvertures = [...source.matchAll(/<Pile\w+\.Screen\s+name="(\w+)"/g)];

  return ouvertures.map((ouverture, index) => {
    const debut = ouverture.index ?? 0;
    const suivante = ouvertures[index + 1]?.index ?? source.length;
    return { nom: ouverture[1], bloc: source.slice(debut, suivante) };
  });
}

describe('issue des écrans empilés', () => {
  const source = readFileSync(NAVIGATION, { encoding: 'utf-8' });
  const ecrans = ecransEmpiles(source);

  it('il y a bien des écrans à inspecter', () => {
    // Sans cette assertion, un renommage de `Pile*.Screen` rendrait la garde
    // verte en n'inspectant plus rien.
    expect(ecrans.length).toBeGreaterThan(5);
  });

  it('repère un écran empilé sans issue', () => {
    // La garde éprouvée dans les deux sens : celle qui ne sait rien signaler
    // passerait le cas nominal sans rien garantir.
    const sansIssue = ecransEmpiles(
      '<PileX.Screen name="Detail">{() => <DetailScreen id={1} />}</PileX.Screen>',
    );
    expect(sansIssue).toHaveLength(1);
    expect(sansIssue[0].bloc).not.toContain('onRetour');

    const avecIssue = ecransEmpiles(
      '<PileX.Screen name="Detail">{() => <DetailScreen onRetour={r} />}</PileX.Screen>',
    );
    expect(avecIssue[0].bloc).toContain('onRetour');
  });

  it.each(ecrans.filter(({ nom }) => !RACINES.includes(nom)).map(({ nom, bloc }) => [nom, bloc]))(
    '%s offre un retour',
    (_nom, bloc) => {
      expect(bloc).toContain('onRetour');
    },
  );

  it('chaque racine déclarée existe vraiment', () => {
    // Une racine retirée du produit et laissée ici dispenserait un jour un
    // écran homonyme qui, lui, en aurait besoin.
    const noms = ecrans.map(({ nom }) => nom);
    for (const racine of RACINES) {
      expect(noms).toContain(racine);
    }
  });
});
