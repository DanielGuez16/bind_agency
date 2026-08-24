/**
 * Le palier que la plateforme propose pour une prestation, et ce qu'on risque
 * à s'en écarter.
 *
 * **Le commerce garde la main.** La proposition n'est pas une contrainte et ne
 * bascule rien : elle dit ce que la plateforme aurait fait, et laisse choisir.
 * C'est la différence entre un conseil et une décision prise à la place de
 * quelqu'un, et elle se joue entièrement dans le fait de ne rien écrire.
 *
 * **Rien en base, calcul à l'affichage.** Trois raisons, et chacune suffirait :
 * la proposition dépend du **catalogue entier**, donc une valeur stockée
 * serait périmée dès qu'un prix bouge ailleurs ; recalculer coûte un tri sur
 * quelques dizaines de lignes déjà chargées ; et une proposition sans trace ne
 * peut pas se faire passer pour le choix du commerce, ce qu'une colonne à côté
 * de `tier_id` finirait par faire.
 *
 * **La position, pas le prix seul.** Un soin à 90 dollars est haut de gamme
 * chez un barbier et courant dans un spa. Ce qui situe une prestation, c'est
 * son rang parmi les prix de **son** catalogue — la même somme ne dit pas la
 * même chose d'une maison à l'autre.
 *
 * **Sous trois prestations, aucune proposition.** Il n'y a pas de distribution
 * à lire dans un ou deux prix, et proposer quand même reviendrait à inventer.
 * L'écran se tait alors, plutôt que de conseiller au hasard.
 */
import type { ContentFormat } from '../api';
import { tierTokens } from '../theme';

/** L'ordre des formats, du moins au plus exigeant. Celui des jetons. */
const ECHELLE: ContentFormat[] = ['story', 'post', 'reel'];

/**
 * Le nombre de durées distinctes en dessous duquel on ne propose rien.
 *
 * Trois : c'est le minimum pour qu'un tiers inférieur, un milieu et un tiers
 * supérieur existent réellement. À deux, la « moitié la plus longue » est un
 * seul article et la proposition ne dit rien du catalogue.
 *
 * **La durée a remplacé le prix le 2026-08-24.** Le produit ne montre jamais de
 * montant et un commerce n'a aucune raison d'en saisir un ; la durée ordonne
 * aussi bien — trente minutes contre quatre-vingt-dix dit ce que quarante
 * dollars contre cent vingt disait — et elle est **obligatoire**, donc la
 * suggestion ne dépend plus d'un champ qu'on peut laisser vide. Sa limite est
 * connue : une prestation longue n'est pas toujours haut de gamme. Un prix ne
 * l'était pas non plus.
 */
export const DUREES_MINIMUM_POUR_PROPOSER = 3;

export type PrestationMesuree = { id: string; duration_minutes: number | null };

/**
 * Le palier proposé pour chaque prestation, par identifiant.
 *
 * **Deux prix égaux reçoivent le même palier.** Sans cette précaution, deux
 * manucures à 45 dollars pourraient tomber de part et d'autre d'une frontière
 * de tiers, uniquement selon leur ordre d'arrivée en base. Le commerce verrait
 * deux conseils contradictoires sur deux lignes identiques, et aurait raison de
 * ne plus croire aucun des deux.
 */
export function propositionsDuCatalogue(
  prestations: PrestationMesuree[],
): Map<string, ContentFormat> {
  const proposees = new Map<string, ContentFormat>();
  // **Sans durée, pas de rang.** Le champ est obligatoire à la création, mais un
  // catalogue ancien peut en porter sans : les écarter vaut mieux que les poser
  // à zéro, ce qui les ferait toutes tomber dans le tiers bas.
  const mesurees = prestations.filter(
    (p): p is { id: string; duration_minutes: number } => p.duration_minutes != null,
  );
  if (mesurees.length < DUREES_MINIMUM_POUR_PROPOSER) return proposees;

  const durees = [...new Set(mesurees.map((p) => p.duration_minutes))].sort((a, b) => a - b);
  // Moins de trois durées **distinctes** : un catalogue à durée unique n'a pas
  // de haut ni de bas, quel que soit le nombre de lignes.
  if (durees.length < DUREES_MINIMUM_POUR_PROPOSER) return proposees;

  for (const prestation of mesurees) {
    // Le rang de la **durée**, pas celui de la ligne : c'est ce qui fait que
    // deux prestations de même durée reçoivent la même proposition.
    const rang = durees.indexOf(prestation.duration_minutes);
    const tiers = Math.min(ECHELLE.length - 1, Math.floor((rang * ECHELLE.length) / durees.length));
    proposees.set(prestation.id, ECHELLE[tiers]);
  }
  return proposees;
}

/** Ce que l'écran a à dire d'un palier retenu, face à celui qui était proposé. */
export type EcartAuConseil =
  | { forme: 'conforme' }
  | { forme: 'plus-exigeant'; propose: ContentFormat; retenu: ContentFormat }
  | { forme: 'moins-exigeant'; propose: ContentFormat; retenu: ContentFormat }
  | { forme: 'sans-avis' };

/**
 * L'écart entre ce qui est proposé et ce qui est retenu.
 *
 * Séparé du rendu pour être éprouvé sans écran : c'est le sens du message, pas
 * sa mise en page. Et les deux écarts ne disent pas la même chose — l'un coûte
 * des créatrices, l'autre donne de la valeur contre peu d'engagement.
 */
export function ecartAuConseil(
  propose: ContentFormat | undefined,
  retenu: ContentFormat | undefined,
): EcartAuConseil {
  if (propose === undefined || retenu === undefined) return { forme: 'sans-avis' };
  if (propose === retenu) return { forme: 'conforme' };

  return ECHELLE.indexOf(retenu) > ECHELLE.indexOf(propose)
    ? { forme: 'plus-exigeant', propose, retenu }
    : { forme: 'moins-exigeant', propose, retenu };
}

/**
 * Le palier le plus exigeant parmi ceux qu'une prestation a reçus.
 *
 * Une prestation peut être offerte à plusieurs paliers — c'est permis, et
 * courant. C'est alors le plus exigeant qui décide de ce qu'on compare : c'est
 * lui qui fixe la barre d'entrée, et donc le nombre de créatrices concernées.
 */
export function palierRetenu(formats: ContentFormat[]): ContentFormat | undefined {
  return formats.length === 0
    ? undefined
    : formats.reduce((haut, format) =>
        ECHELLE.indexOf(format) > ECHELLE.indexOf(haut) ? format : haut,
      );
}

/**
 * Le mot du palier, tel que le badge l'écrit.
 *
 * Repris des jetons et non d'une clé de traduction : `STORY` et `HISTORIA` sont
 * déjà là, et une seconde table finirait par dire autre chose que le badge posé
 * juste à côté. Le mot n'est jamais abrégé — c'est la règle du `TierBadge`, et
 * elle vaut partout où le palier se nomme.
 */
export function motDuPalier(format: ContentFormat, locale: string): string {
  // `tierTokens` porte aussi la liste `order` et les `rules` : la clé d'un
  // format n'en fait pas partie, mais TypeScript lit l'objet entier.
  const config = tierTokens[format] as { label: Record<string, string> };
  return config.label[locale] ?? config.label.en;
}
