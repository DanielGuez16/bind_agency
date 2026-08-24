/**
 * Toute clé appelée existe, dans les deux langues.
 *
 * **La garde de parité ne suffisait pas, et c'est une garde partielle
 * classique.** Elle compare les deux catalogues **l'un à l'autre** : elle
 * attrape une clé traduite d'un seul côté, et laisse passer une clé qui manque
 * des deux. Elle n'a jamais regardé les **appels**.
 *
 * Le défaut s'est produit deux fois dans la même journée. Six clés du cadre 11c
 * ont atterri dans le domaine `parcours` quand l'écran les lisait sous `tiers` :
 * parité intacte, catalogues d'accord, et l'écran affichait
 * `[missing "en.tiers.prestationsOuvertes" translation]` — en clair, à la place
 * du titre. Rien ne l'a signalé ; c'est une assertion de texte dans un test
 * d'écran qui l'a trouvé, par accident.
 *
 * **La clé se résout par son chemin entier, jamais par sa feuille.** Chercher
 * `prestationsOuvertes` quelque part dans le catalogue aurait trouvé celle de
 * `parcours` et déclaré la garde satisfaite — c'est-à-dire reproduit exactement
 * le défaut qu'elle prétend interdire. Les catalogues sont donc importés et
 * parcourus, pas lus au motif.
 *
 * **Les clés composées sont hors de portée**, et elles sont dénombrées plutôt
 * que passées sous silence : `t(`quartiers.${q}`)` ne se résout pas sans
 * exécuter le code. Leurs domaines sont couverts ailleurs — les quartiers et
 * les catégories ont leur propre garde, qui recopie la liste à la main depuis
 * l'union TypeScript pour en faire un oracle.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';

const SRC = join(__dirname, '..', 'src');

/** Toutes les sources, la coquille et les écrans compris. */
function sources(): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (/\.tsx?$/.test(entree)) trouves.push(readFileSync(chemin, 'utf-8'));
    }
  };
  parcourir(SRC);
  return trouves;
}

/** Les clés littérales appelées, et le compte de celles qui se composent. */
function appels(): { litterales: string[]; composees: number } {
  const litterales = new Set<string>();
  let composees = 0;
  for (const source of sources()) {
    for (const [, cle] of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) litterales.add(cle);
    composees += [...source.matchAll(/\bt\(\s*`/g)].length;
  }
  return { litterales: [...litterales].sort(), composees };
}

/** La valeur au bout du chemin, ou `undefined`. Jamais la feuille seule. */
function resoudre(catalogue: unknown, cle: string): unknown {
  return cle
    .split('.')
    .reduce<unknown>(
      (noeud, part) => (noeud as Record<string, unknown> | undefined)?.[part],
      catalogue,
    );
}

describe('les clés de traduction', () => {
  const { litterales, composees } = appels();

  it('la garde regarde bien quelque chose', async () => {
    // L'assertion de volume : le jour où la forme des appels change, la lecture
    // rendrait une liste vide et le test passerait sans rien inspecter.
    expect(litterales.length).toBeGreaterThan(400);
  });

  it('chaque clé appelée existe en anglais', async () => {
    const absentes = litterales.filter((cle) => typeof resoudre(en, cle) !== 'string');
    expect(absentes).toEqual([]);
  });

  it('et en espagnol', async () => {
    // Le sens inverse de la parité : une clé peut exister d'un seul côté, et
    // c'est la langue qu'on ne relit pas qui en souffre.
    const absentes = litterales.filter((cle) => typeof resoudre(es, cle) !== 'string');
    expect(absentes).toEqual([]);
  });

  it('et les clés composées restent comptées, pas oubliées', async () => {
    // Elles ne se résolvent pas sans exécuter le code. Les dénombrer force à
    // constater leur nombre plutôt qu'à ignorer leur existence : si elles se
    // multipliaient, la garde couvrirait de moins en moins sans le dire.
    // Passé à 42 le 2026-08-24 : la ligne des favoris compose le nom du
    // palier requis, deux fois — avec le chiffre et sans lui.
    expect(composees).toBeLessThan(42);
  });
});

/**
 * Le produit ne genre personne.
 *
 * **Trois fois le même défaut en une journée**, tous côté anglais : un onglet
 * qui disait « Awaiting her post », une explication de retard qui disait
 * « she came and found you closed », une aide de carte qui disait « she needs
 * to read your menu ». L'espagnol était neutre à chaque fois — `su`, `la
 * creadora` — donc rien ne se voyait en comparant les deux langues.
 *
 * Ce n'est pas une question de style. Ces phrases parlent de créatrices à des
 * salons qui ne les ont pas choisies, et affirment leur genre à leur place ;
 * et elles vieillissent mal le jour où un créateur lit son propre écran. La
 * deuxième personne — « you » — couvre presque tout le produit, et là où il
 * faut une troisième, « they » ne coûte rien.
 *
 * **La garde cherche les quatre formes, pas seulement celle qui a motivé la
 * règle.** Trouvée par relecture d'un libellé, elle en a dénoncé deux autres
 * que personne n'avait vues — c'est exactement ce qu'une garde partielle,
 * calée sur « her », aurait raté.
 */
describe('les libellés ne genrent personne', () => {
  it('aucun pronom de troisième personne genré dans les chaînes anglaises', () => {
    // **L'objet, pas le fichier**, et c'est une correction. La première
    // version appariait les apostrophes du source : les commentaires français
    // en contiennent — « l'écran », « qu'on » — et l'appariement se
    // désynchronisait sur tout le reste du fichier. La garde lisait alors des
    // fragments qui ne sont les chaînes de personne, et la mutation qui
    // remettait « her » dans un libellé passait au vert. Lire les valeurs
    // rendues supprime la question du parsing.
    const fautifs: string[] = [];
    const parcourir = (noeud: unknown, chemin: string) => {
      if (typeof noeud === 'string') {
        if (/\b(she|he|her|his|hers|him|himself|herself)\b/i.test(noeud)) fautifs.push(`${chemin} — ${noeud}`);
        return;
      }
      if (noeud && typeof noeud === 'object') {
        for (const [cle, valeur] of Object.entries(noeud)) parcourir(valeur, `${chemin}.${cle}`);
      }
    };
    parcourir(en, 'en');

    // La garde regarde bien quelque chose : sans ce compte, un `en` vide ou
    // mal importé rendrait zéro fautif et zéro chaîne, donc un vert vide.
    let combien = 0;
    const compter = (noeud: unknown) => {
      if (typeof noeud === 'string') combien += 1;
      else if (noeud && typeof noeud === 'object') Object.values(noeud).forEach(compter);
    };
    compter(en);
    expect(combien).toBeGreaterThan(500);

    expect(fautifs).toEqual([]);
  });

  it('et la garde attrape bien les quatre formes qu’elle vise', () => {
    // Une garde qui ne cherche que le mot qui l'a motivée fait croire que la
    // question est réglée. On l'éprouve donc sur les autres façons d'écrire la
    // même faute, y compris capitalisée et en fin de phrase.
    const attrape = (phrase: string) => /\b(she|he|her|his|hers|him|himself|herself)\b/i.test(phrase);

    expect(attrape('Awaiting her post')).toBe(true);
    expect(attrape('She came and found you closed')).toBe(true);
    expect(attrape('Read his profile')).toBe(true);
    expect(attrape('The booking is hers')).toBe(true);
    // **« himself » échappait à la garde**, et c'est une restauration qui l'a
    // révélé : `\bhim\b` ne mord pas sur « himself », dont les lettres
    // suivantes suppriment la frontière de mot. La forme réfléchie est la
    // quatrième façon d'écrire la même faute, et la garde ne cherchait que les
    // trois premières.
    expect(attrape('Handed to the manager himself')).toBe(true);
    expect(attrape('She did it herself')).toBe(true);

    // Et elle ne se déclenche pas sur les mots qui les contiennent : « the »,
    // « share », « other », « chez » n'ont rien à voir. Sans ce contre-exemple,
    // la garde refuserait la moitié du catalogue et se ferait désactiver.
    expect(attrape('Share the other booking')).toBe(false);
    expect(attrape('Here is where they check in')).toBe(false);
  });
});
