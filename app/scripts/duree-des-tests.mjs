/**
 * Un test qui met plusieurs secondes attend quelque chose qui ne vient pas.
 *
 * **Trouvé sur un cas réel, et le coût était invisible.** `entete-du-mur`
 * mettait 17,4 secondes quand ses voisins en prenaient 1,7. Rien n'échouait :
 * la suite passait, la CI restait verte, et les dix-sept secondes retombaient
 * dans chaque boucle de mutation. La cause était un test qui laissait une
 * requête pendante pour observer l'état de chargement. Relâcher la requête à la
 * fin du test : 2,5 s.
 *
 * ---
 *
 * ## Le test, et non le fichier
 *
 * La première version de ce garde-fou mesurait les **fichiers**, à dix fois la
 * médiane. Elle a échoué en intégration continue sur trois fichiers parfaitement
 * sains : `ecrans-commerce` met huit secondes parce qu'il porte **cent
 * vingt-quatre tests à soixante-cinq millisecondes**. Un fichier n'est pas lent
 * parce qu'il contient un défaut, il est long parce qu'il contient beaucoup.
 *
 * Confondre les deux produit des faux positifs, et un faux positif sur une
 * vérification requise est la manière dont un garde-fou finit par être
 * désactivé. L'unité est donc le test.
 *
 * ## Un plafond, et pas un rapport à la médiane
 *
 * Le rapport a été essayé puis retiré : la médiane d'un test est de quatorze
 * millisecondes, donc dix fois la médiane vaut cent quarante — des dizaines de
 * tests honnêtes la dépassent, et le plancher domine toujours. Un rapport qui ne
 * décide jamais rien est une décoration qui donne l'air d'un seuil réfléchi.
 *
 * **Le plafond est mesuré.** Le test légitime le plus lourd de la suite met
 * 1,5 s — il fait tourner un code de retrait sur des minuteries. Cinq secondes
 * laissent trois fois cette marge, et les deux formes de défaut fabriquées pour
 * éprouver ce fichier mettaient onze secondes.
 *
 * ## Ce qu'il attrape, et ce qu'il ne peut pas attraper
 *
 * Il attrape, et aucune des deux ne fait échouer quoi que ce soit : une attente
 * réelle plutôt que simulée, du genre `setTimeout` qu'on regarde passer ; et un
 * `waitFor` sur une condition qui n'arrive jamais et qui va au bout de son délai
 * avant qu'une autre assertion ne sauve le test. Les deux ont été fabriquées et
 * vérifiées.
 *
 * **Le cas qui l'a motivé lui échappe, et il faut le dire ici plutôt que de
 * laisser croire que la question est réglée.** Les dix-sept secondes étaient du
 * **démontage**, et Jest ne les compte ni dans la durée du test ni dans celle du
 * fichier. Vérifié en rejouant le défaut : le fichier fautif ne ressort même pas
 * parmi les cinq plus lents d'une exécution complète, où le parallélisme absorbe
 * l'attente. Il ne se voyait qu'en lançant le fichier seul.
 *
 * L'outil de cette classe-là est `jest --detectOpenHandles`, qui nomme le
 * fichier **et** le handle. On ne peut pas encore l'exiger : la suite force la
 * sortie d'un worker à chaque exécution sur l'arbre propre, avant comme après
 * cette correction. La fuite est ailleurs, elle n'est pas identifiée, et c'est
 * une tâche à part dans `TASKS.md`.
 *
 * Il se lit sur le rapport que Jest écrit lui-même : mesurer depuis un
 * rapporteur maison reviendrait à chronométrer notre propre chronomètre.
 */
import { readFileSync } from 'node:fs';

/**
 * Au-dessus, un test attend quelque chose.
 *
 * Cinq secondes, mesurées et non choisies : le test légitime le plus lourd de
 * la suite met 1,5 s, et les défauts fabriqués pour éprouver ce fichier en
 * mettaient onze. La marge est de trois fois dans un sens et de deux dans
 * l'autre.
 */
const PLAFOND_MS = 5_000;

/** Ce qu'on affiche toujours, pour que la dérive se voie avant le seuil. */
const A_MONTRER = 3;

const chemin = process.argv[2];
if (!chemin) {
  console.error('usage : node scripts/duree-des-tests.mjs <rapport-jest.json>');
  process.exit(2);
}

const rapport = JSON.parse(readFileSync(chemin, 'utf-8'));
const tests = (rapport.testResults ?? [])
  .flatMap((fichier) =>
    (fichier.assertionResults ?? []).map((test) => ({
      fichier: (fichier.name ?? '?').split('/').pop(),
      nom: test.fullName ?? test.title ?? '?',
      ms: test.duration ?? 0,
    })),
  )
  .sort((a, b) => b.ms - a.ms);

if (tests.length === 0) {
  console.error('::error::aucun test dans le rapport — le rapport est-il le bon fichier ?');
  process.exit(2);
}

const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(`durée des tests : ${tests.length} tests, plafond ${s(PLAFOND_MS)}. Les plus lents :`);
for (const test of tests.slice(0, A_MONTRER)) {
  console.log(`  ${s(test.ms).padStart(7)}  ${test.fichier} › ${test.nom}`);
}

const lents = tests.filter((test) => test.ms > PLAFOND_MS);
if (lents.length === 0) process.exit(0);

for (const test of lents) {
  console.log(
    `::error file=app/__tests__/${test.fichier}::« ${test.nom} » met ${s(test.ms)}. ` +
      'Un test ne devient pas lent, il attend : cherchez une attente réelle plutôt ' +
      "que simulée, ou un `waitFor` sur une condition qui n'arrive jamais et qui va " +
      'au bout de son délai.',
  );
}
process.exit(1);
