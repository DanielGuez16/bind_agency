/**
 * Une méthode d'API que personne n'appelle.
 *
 * **Le pendant exact de la garde des champs, et il manquait.** Celle-là attrape
 * « le serveur rend, l'écran ignore ». Celle-ci attrape « le client sait
 * demander, et personne ne demande » — une méthode d'API sans appelant est du
 * code mort **qui a l'air d'une fonctionnalité**, et qui vieillit sans qu'aucun
 * test ne la touche.
 *
 * **Trouvée en me trompant.** J'ai écrit qu'il n'existait aucune route de
 * signalement d'absence, et conclu qu'il fallait « l'entrée de route, la
 * méthode, et l'action ». `marquerAbsent` existait depuis seize PR, documentée,
 * appelant le bon chemin : seul l'appelant manquait. Ma recherche cherchait
 * `no_show` et `absent` quand le dépôt écrit `marquerAbsent` sur le chemin
 * `no-show` — deux motifs faux d'un caractère chacun. **Une recherche textuelle
 * qui rate ne rend pas « rien », elle rend un silence rassurant.**
 *
 * ## Ce que la garde fait
 *
 * Chaque méthode publique d'`ApiClient` est soit appelée quelque part hors de
 * la couche d'API, soit inscrite ici avec sa raison. Une méthode ajoutée sans
 * écran fait tomber ce test, et la table tient dans les deux sens : une ligne
 * dont la méthode est désormais appelée le fait tomber aussi.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle lit du texte : une méthode appelée par un nom calculé lui échappe. Faux
 * négatifs, aucun faux positif — le bon sens de l'erreur pour une vérification
 * requise, et c'est écrit ici plutôt que laissé croire.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const CLIENT = join(SRC, 'api', 'index.tsx');

/**
 * Les méthodes sans appelant, chacune avec sa raison.
 *
 * **Toutes sous `a-instruire`, et c'est le constat honnête.** Ce ne sont pas
 * des exemptions : ce sont treize capacités que le produit sait demander au
 * serveur et qu'aucun écran n'offre. Plusieurs appartiennent à des tâches
 * cochées — la reprise de compte, l'abonnement, les repères du voisinage, la
 * modification du catalogue. Les ranger sous « contrat » sans les instruire
 * ferait de cette table le tapis qu'elle existe pour retirer.
 */
const SANS_APPELANT: Record<string, string> = {
  // **La fermeture côté administration n'a pas d'écran, et c'est voulu.** Le
  // salon referme depuis chez lui, en un appui, et c'est le seul geste qui
  // compte. L'administration se retire en quittant : la reprise s'éteint à son
  // plafond. Un bouton « je m'en vais » du côté de celui qui est entré ne
  // protège personne, et donnerait à croire que la porte reste ouverte tant
  // qu'on ne l'a pas pressé.
  fermerLaReprise: 'a-instruire',
  // **Le catalogue se compose et ne se corrige pas**, et ça ne tient pas.
  // Les trois restent : ce qui manque est un écran, pas une raison. La
  // suppression attend une réponse de Design — ce qu'elle doit faire quand des
  // réservations passées citent la prestation — et c'est une question de
  // produit, pas de code mort.
  activerUneOffre: 'a-instruire',
};

const RAISONS = new Set(['contrat', 'technique', 'a-instruire']);

/** Les méthodes publiques du client. */
function methodes(): string[] {
  const source = readFileSync(CLIENT, 'utf-8');
  return [...source.matchAll(/^ {2}(\w+)\(/gm)]
    .map(([, nom]) => nom)
    .filter((nom) => nom !== 'constructor');
}

/** Tout ce qui pourrait appeler, la couche d'API exceptée. */
function lesAppelants(): string {
  const morceaux: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (/\.tsx?$/.test(entree) && chemin !== CLIENT) {
        morceaux.push(readFileSync(chemin, 'utf-8'));
      }
    }
  };
  parcourir(SRC);
  parcourir(join(__dirname));
  return morceaux.join('\n');
}

const estAppelee = (nom: string, blob: string) => new RegExp(`\\.${nom}\\(`).test(blob);

describe('une méthode d’API a un appelant, ou sa raison est écrite', () => {
  const publiques = methodes();
  const appelants = lesAppelants();

  it('la garde regarde bien quelque chose', async () => {
    expect(publiques.length).toBeGreaterThan(60);
  });

  it('aucune méthode n’existe sans appelant ni justification', async () => {
    const orphelines = publiques
      .filter((nom) => !estAppelee(nom, appelants))
      .filter((nom) => !(nom in SANS_APPELANT));

    expect(orphelines).toEqual([]);
  });

  it('et la table ne garde pas de ligne devenue fausse', async () => {
    // Le sens inverse : une méthode branchée depuis doit sortir de la table,
    // sans quoi celle-ci se remplit de lignes fausses et cesse de dire quoi
    // que ce soit.
    const perimees = Object.keys(SANS_APPELANT).filter(
      (nom) => !publiques.includes(nom) || estAppelee(nom, appelants),
    );

    expect(perimees).toEqual([]);
  });

  it('chaque raison est l’une des trois', async () => {
    for (const raison of Object.values(SANS_APPELANT)) expect(RAISONS.has(raison)).toBe(true);
  });
});
