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
 * Le nombre de prix en dessous duquel on ne propose rien.
 *
 * Trois : c'est le minimum pour qu'un tiers inférieur, un milieu et un tiers
 * supérieur existent réellement. À deux, la « moitié la plus chère » est un
 * seul article et la proposition ne dit rien du catalogue.
 */
export const PRIX_MINIMUM_POUR_PROPOSER = 3;

export type PrestationChiffree = { id: string; price_cents: number };

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
  prestations: PrestationChiffree[],
): Map<string, ContentFormat> {
  const proposees = new Map<string, ContentFormat>();
  if (prestations.length < PRIX_MINIMUM_POUR_PROPOSER) return proposees;

  const prix = [...new Set(prestations.map((p) => p.price_cents))].sort((a, b) => a - b);
  // Moins de trois prix **distincts** : un catalogue à prix unique n'a pas de
  // haut ni de bas, quel que soit le nombre de lignes.
  if (prix.length < PRIX_MINIMUM_POUR_PROPOSER) return proposees;

  for (const prestation of prestations) {
    // Le rang du **prix**, pas celui de la ligne : c'est ce qui fait que deux
    // prestations au même tarif reçoivent la même proposition.
    const rang = prix.indexOf(prestation.price_cents);
    const tiers = Math.min(ECHELLE.length - 1, Math.floor((rang * ECHELLE.length) / prix.length));
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
