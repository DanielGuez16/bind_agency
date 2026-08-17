/**
 * Un fichier de test qui coûte dix fois ses voisins porte un défaut.
 *
 * **Trouvé sur un cas réel, et le coût était invisible.** `entete-du-mur`
 * mettait 17,4 secondes quand ses voisins en prenaient 1,7. Rien n'échouait :
 * la suite passait, la CI était verte, et les dix-sept secondes tombaient dans
 * chaque boucle de mutation. La cause était un test qui laissait une promesse
 * pendante pour observer l'état de chargement — Jest attendait le handle ouvert
 * jusqu'à sa temporisation. Relâcher la requête à la fin du test : 2,5 s.
 *
 * Ce qu'il attrape, et aucun de ces deux-là ne fait échouer quoi que ce soit :
 *
 * — une attente réelle plutôt que simulée, du genre `setTimeout` qu'on regarde
 *   passer ;
 * — un `waitFor` sur une condition qui n'arrive jamais et qui va au bout de son
 *   délai avant qu'une autre assertion ne sauve le test.
 *
 * **Ce qu'il n'attrape pas, et il faut le dire ici plutôt que de laisser croire
 * que la question est réglée.** Le cas qui l'a motivé — la promesse pendante —
 * lui échappe : les dix-sept secondes étaient du **démontage**, et Jest ne les
 * compte pas dans la durée du fichier. Vérifié en rejouant le défaut : le
 * fichier fautif ne ressort même pas parmi les cinq plus lents d'une exécution
 * complète, où le parallélisme absorbe l'attente. Il ne se voyait qu'en lançant
 * le fichier seul.
 *
 * L'outil pour cette classe-là est `jest --detectOpenHandles`, qui nomme le
 * fichier **et** le handle. On ne peut pas encore l'exiger : il signale déjà
 * quelque chose sur l'arbre propre — la suite force la sortie d'un worker à
 * chaque exécution, avant comme après cette correction. La fuite est ailleurs,
 * elle n'est pas identifiée, et c'est une tâche à part dans `TASKS.md`.
 *
 * **Le seuil est relatif, et il porte un plancher.** Relatif, parce qu'une
 * durée absolue dit surtout à quel point le runner était chargé ; dix fois la
 * médiane des fichiers reste vrai sur une machine deux fois plus lente. Et un
 * plancher, parce que sur des fichiers à cent millisecondes, dix fois la
 * médiane est du bruit de mesure et non un défaut.
 *
 * Il se lit sur le rapport que Jest écrit lui-même : mesurer depuis un
 * rapporteur maison reviendrait à chronométrer notre propre chronomètre.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

/** Dix fois la médiane. C'est l'ordre de grandeur du cas qui l'a motivé. */
const FACTEUR = 10;

/**
 * En dessous, on ne dit rien.
 *
 * Cinq secondes : au-dessus de tout ce que la suite contient aujourd'hui hors
 * le cas trouvé — le plus lourd des fichiers sains tourne autour de trois — et
 * assez bas pour que le prochain se signale. Un fichier qui les dépasse a fait
 * quelque chose de plus que rendre des composants.
 */
const PLANCHER_MS = 5_000;

const chemin = process.argv[2];
if (!chemin) {
  console.error('usage : node scripts/duree-des-tests.mjs <rapport-jest.json>');
  process.exit(2);
}

const rapport = JSON.parse(readFileSync(chemin, 'utf-8'));
const fichiers = (rapport.testResults ?? [])
  .map((resultat) => ({
    nom: relative(process.cwd(), resultat.name ?? resultat.testFilePath ?? '?'),
    ms: (resultat.endTime ?? 0) - (resultat.startTime ?? 0),
  }))
  .filter((fichier) => fichier.ms > 0);

if (fichiers.length < 4) {
  // Une médiane sur trois fichiers ne dit rien. Se taire vaut mieux
  // qu'accuser au hasard — et ce cas n'arrive que sur une exécution ciblée,
  // où la question ne se pose pas.
  console.log(`durée des tests : ${fichiers.length} fichiers, trop peu pour une médiane`);
  process.exit(0);
}

const triees = fichiers.map((f) => f.ms).sort((a, b) => a - b);
const mediane = triees[Math.floor(triees.length / 2)];
const seuil = Math.max(mediane * FACTEUR, PLANCHER_MS);

const lents = fichiers
  .filter((fichier) => fichier.ms > seuil)
  .sort((a, b) => b.ms - a.ms);

const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(
  `durée des tests : ${fichiers.length} fichiers, médiane ${s(mediane)}, seuil ${s(seuil)}`,
);

if (lents.length === 0) process.exit(0);

for (const fichier of lents) {
  const fois = (fichier.ms / mediane).toFixed(0);
  console.log(
    `::error file=${fichier.nom}::${fichier.nom} met ${s(fichier.ms)}, ` +
      `soit ${fois} fois la médiane (${s(mediane)}). ` +
      "Cherchez une promesse jamais résolue, une minuterie non annulée, ou un " +
      "`waitFor` qui va au bout de son délai — un fichier n'est pas lent, il " +
      'attend quelque chose qui ne vient pas.',
  );
}
process.exit(1);
