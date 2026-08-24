/**
 * Un `fetch` de décor qui ne répond jamais **et** n'écoute pas son annulation.
 *
 * **Le décor qui ne se résout jamais est légitime, et souvent le seul juste.**
 * « Remplir puis appeler » et « appeler puis remplir » rendent le même écran
 * contre un double qui répond tout de suite ; un écran gardé en chargement ne
 * montre son squelette que si la réponse tarde. Ces tests-là ne peuvent pas
 * s'en passer, et cette garde ne les vise pas.
 *
 * **Ce qu'elle vise est `new Promise<Response>(() => {})`** : une promesse qui
 * ne se règle jamais *et* qui ignore le signal qu'on lui passe. Ce n'est pas un
 * réseau lent, c'est un `fetch` que personne n'écrit — le vrai rejette quand on
 * l'annule. La conséquence était mesurable : le client éteint son échéance dans
 * un `finally`, qui n'était donc jamais atteint, et aucun test n'a jamais
 * emprunté le chemin d'annulation.
 *
 * `test-support/reponseQuiNArrivePas` fait la même chose en écoutant `abort`.
 *
 * ## Ce que la garde attrape, et ce qu'elle laisse passer
 *
 * Elle lit du texte, sur la forme **vide** de l'exécuteur et sur le type
 * `Response`. Un décor qui atteindrait le même résultat autrement — une
 * promesse gardée dans une variable et jamais réglée, un `await` sur un objet
 * inerte — lui échappe. Faux négatifs, aucun faux positif : c'est le bon sens
 * de l'erreur pour une vérification requise, et c'est écrit ici plutôt que
 * laissé croire.
 *
 * Elle ne regarde pas non plus les doubles qui ne rendent pas une `Response` :
 * `relever.mockReturnValue(new Promise(() => {}))` modélise une plateforme de
 * localisation qui ne rappelle jamais, ce qui **arrive** — c'est même le
 * blocage relevé en ligne, et `position.test.tsx` existe pour ça.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RACINES = [join(__dirname), join(__dirname, '..', 'test-support')];

/** Les formes vides, une fois les espaces retirés. */
const FORMES = [
  'newPromise<Response>(()=>{})',
  'newPromise<Response>(function(){})',
  'newPromise(()=>{})asunknownasResponse',
  'newPromise(()=>{})asResponse',
];

function sources(): { chemin: string; texte: string }[] {
  const trouves: { chemin: string; texte: string }[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (/\.tsx?$/.test(entree)) {
        trouves.push({ chemin, texte: readFileSync(chemin, 'utf-8') });
      }
    }
  };
  for (const racine of RACINES) parcourir(racine);
  return trouves;
}

const sansEspaces = (texte: string) => texte.replace(/\s+/g, '');

describe('un double de fetch écoute son annulation', () => {
  const fichiers = sources();

  it('la garde regarde bien quelque chose', () => {
    expect(fichiers.length).toBeGreaterThan(50);
  });

  it('aucun décor ne rend une Response qui ne se règle jamais', () => {
    const fautifs = fichiers
      // Sa propre documentation cite les formes qu'elle interdit.
      .filter(({ chemin }) => !chemin.endsWith('le-double-qui-ignore-son-signal.test.ts'))
      .filter(({ texte }) => FORMES.some((forme) => sansEspaces(texte).includes(forme)))
      .map(({ chemin }) => chemin.slice(chemin.indexOf('app/')));

    expect(fautifs).toEqual([]);
  });

  it('elle attrape les quatre façons d’écrire la même faute', () => {
    // **La forme qui a coûté, puis les autres façons de l'écrire.** Une garde
    // qui ne cherche que l'exemple qu'on avait en tête laisse passer la
    // variante du jour ; celle des rendus asynchrones ne cherchait l'appel
    // qu'en début de ligne et a rendu la CI illisible pendant des semaines.
    const attrape = (texte: string) => FORMES.some((f) => sansEspaces(texte).includes(f));

    expect(attrape('fetchImpl: () => new Promise<Response>(() => {}),')).toBe(true);
    expect(attrape('return new Promise<Response>(() => { });')).toBe(true);
    expect(attrape('const jamais = new Promise<Response>(function () {});')).toBe(true);
    expect(attrape('await monter([], () => new Promise(() => {}) as unknown as Response);')).toBe(
      true,
    );
  });

  it('et laisse passer ce qui écoute, ou ce qui n’est pas une réponse', () => {
    const attrape = (texte: string) => FORMES.some((f) => sansEspaces(texte).includes(f));

    // Le double honnête : il ne répond pas davantage, il écoute `abort`.
    expect(attrape('fetchImpl: (_url, init) => reponseQuiNArrivePas(init),')).toBe(false);
    expect(
      attrape('new Promise<Response>((_resoudre, rejeter) => { init?.signal?.addEventListener }'),
    ).toBe(false);
    // Une plateforme de localisation qui ne rappelle jamais : ça arrive, et
    // c'est le blocage relevé en ligne.
    expect(attrape('relever.mockReturnValue(new Promise(() => {}));')).toBe(false);
    // Une promesse réglée tout de suite n'a rien à écouter.
    expect(attrape('new Promise<Response>((resoudre) => resoudre(reponse));')).toBe(false);
  });
});
