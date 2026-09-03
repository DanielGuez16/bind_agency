/**
 * Ce que la tournée a rapporté, et par quelle voie.
 *
 * **Les trois autres écrans du mode terrain servent une visite ; celui-ci
 * répond à une autre question**, et c'est la seule qui se lit assise : est-ce
 * que la tournée valait le déplacement ?
 *
 * **Le chiffre décisif n'est pas le taux d'activation, c'est l'écart entre les
 * deux voies de remise.** Il ne dit pas d'abandonner le lien — un lien vaut
 * mieux qu'une visite perdue — il dit qu'un second passage pour attraper le
 * décideur rapporte plus qu'une relance. Un taux global ne le dirait pas : il
 * mélangerait justement les deux méthodes qu'on cherche à comparer.
 */
import type { FichePreparee } from '../../api';

export type VoieDeRemise = 'qr' | 'email';

export type TauxDUneVoie = {
  voie: VoieDeRemise;
  remises: number;
  activees: number;
  /** De zéro à un. Nul quand aucune fiche n'est partie par cette voie —
   * un taux sur zéro remise n'est pas zéro pour cent, il n'existe pas. */
  taux: number | null;
};

export type BilanDeTournee = {
  preparees: number;
  remises: number;
  activees: number;
  /**
   * Le délai médian entre la remise et l'activation, en heures.
   *
   * **Médiane et non moyenne** : un salon qui active au bout de trois semaines
   * tirerait une moyenne sur douze visites au point de la rendre inutilisable.
   * Nul tant qu'aucune fiche n'a été activée — jamais zéro, qui se lirait
   * « ils activent tout de suite ».
   */
  delaiMedianHeures: number | null;
  voies: TauxDUneVoie[];
};

/**
 * **Remise et non « émise ».** Une fiche revoquée a été remise puis retirée :
 * elle compte dans les remises, parce que la visite a bien eu lieu et que
 * l'oublier flatterait le taux d'activation.
 */
function aEteRemise(fiche: FichePreparee): boolean {
  return Boolean(fiche.issued_at);
}

export function bilanDeTournee(fiches: FichePreparee[] | null | undefined): BilanDeTournee {
  const liste = fiches ?? [];
  const remises = liste.filter(aEteRemise);
  const activees = remises.filter((fiche) => Boolean(fiche.used_at));

  const delais = activees
    .map((fiche) => heuresEntre(fiche.issued_at, fiche.used_at))
    .filter((heures): heures is number => heures !== null)
    .sort((a, b) => a - b);

  return {
    preparees: liste.length,
    remises: remises.length,
    activees: activees.length,
    delaiMedianHeures: mediane(delais),
    // Les deux voies dans un ordre fixe : deux colonnes qui changent de place
    // d'un chargement à l'autre se relisent à chaque fois.
    voies: (['qr', 'email'] as const).map((voie) => {
      const deLaVoie = remises.filter((fiche) => fiche.channel === voie);
      const abouties = deLaVoie.filter((fiche) => Boolean(fiche.used_at));
      return {
        voie,
        remises: deLaVoie.length,
        activees: abouties.length,
        // **Pas de taux sur zéro remise.** « 0 % » se lit comme un échec ;
        // l'absence de données n'en est pas un.
        taux: deLaVoie.length === 0 ? null : abouties.length / deLaVoie.length,
      };
    }),
  };
}

/** Les heures entre deux instants. Nul si l'un manque ou ne se lit pas. */
function heuresEntre(debut: string | null, fin: string | null): number | null {
  if (!debut || !fin) return null;
  const a = new Date(debut).getTime();
  const b = new Date(fin).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  // **Jamais négatif.** Une activation antérieure à la remise est une donnée
  // incohérente, pas un délai de moins zéro : elle sort du calcul.
  return b < a ? null : (b - a) / 3_600_000;
}

/** La médiane d'une liste **déjà triée**. Nulle sur une liste vide. */
function mediane(triee: number[]): number | null {
  if (triee.length === 0) return null;
  const milieu = Math.floor(triee.length / 2);
  return triee.length % 2 === 1 ? triee[milieu] : (triee[milieu - 1] + triee[milieu]) / 2;
}

/**
 * Ce que cette fiche-là a fait attendre, en heures.
 *
 * **Trois cas, et le troisième n'est pas zéro.** Une fiche activée a mis un
 * temps mesurable, et c'est lui qu'on lit. Une fiche remise et toujours
 * ouverte fait attendre **depuis** sa remise, et ce compteur court. Une fiche
 * jamais remise n'attend pas : elle n'est pas partie.
 *
 * Rendre zéro pour le dernier cas le classerait en tête d'un tri par délai,
 * c'est-à-dire parmi les plus rapides — exactement l'inverse de ce qu'il est.
 */
export function attenteDeLaFiche(
  fiche: FichePreparee,
  maintenant: string,
): { heures: number; encoreEnCours: boolean } | null {
  if (!fiche.issued_at) return null;
  const jusqua = fiche.used_at ?? maintenant;
  const heures = heuresEntre(fiche.issued_at, jusqua);
  if (heures === null) return null;
  return { heures, encoreEnCours: !fiche.used_at };
}

/**
 * La nature d'un état, pour son cartouche.
 *
 * **Trois natures pour cinq états**, parce que ce qui compte est la conduite
 * qu'ils appellent et non leur nuance : une fiche assumée vit, une fiche
 * préparée que personne n'a encore reçue dort, et les trois situations
 * intermédiaires attendent toutes un geste — revisiter, relancer, ou débloquer.
 */
export function natureDeLEtat(etat: FichePreparee['etat']): 'vivant' | 'attente' | 'dormant' {
  if (etat === 'claimed') return 'vivant';
  if (etat === 'prepared') return 'dormant';
  return 'attente';
}
