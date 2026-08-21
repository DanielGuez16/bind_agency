/**
 * Un champ servi par l'API et rendu nulle part.
 *
 * **Trois fois dans une seule session, et aucune n'a échoué.** Le paramètre
 * `categorie` que le fil acceptait et que personne n'envoyait ; `constate` et
 * `requis` sur les signaux de vérification, si bien qu'« ancienneté :
 * insuffisante » ne disait ni de combien ni depuis quand ; `deadline_at` et
 * `attempts_count` sur la contrepartie, quand l'échéance est la seule chose qui
 * décide s'il faut agir ce soir ou la semaine prochaine.
 *
 * Trois fois n'est plus une série de distractions, c'est un défaut de méthode.
 * Et c'est le même que celui de l'audit des planches : **ce qui existe mais que
 * personne ne branche**. Rien ne tombe, l'écran paraît complet, les jetons sont
 * les bons — et l'information qui décide du geste suivant n'est pas à l'écran.
 *
 * ## Ce que la garde fait
 *
 * Chaque champ déclaré dans `types.ts` est soit **lu quelque part** dans `src/`,
 * soit **inscrit ici avec sa raison**. Un champ ajouté au contrat sans être
 * branché ni justifié fait tomber ce test.
 *
 * **La table tient dans les deux sens.** Un champ inscrit ici qui se met à être
 * lu fait tomber le test aussi : sans quoi la table vieillit, se remplit de
 * lignes fausses, et cesse de dire quoi que ce soit — c'est exactement ce qui
 * est arrivé à `$meta.unconfirmed`, gardé après que le manque a été comblé.
 *
 * ## Ce qu'elle ne fait pas
 *
 * Elle lit du texte, pas un arbre syntaxique. Un champ dont le nom est commun —
 * `status`, `name`, `id` — sera trouvé quelque part même s'il n'est jamais lu
 * *sur ce type-là* : la garde a donc des faux négatifs, et aucun faux positif.
 * C'est le bon sens de l'erreur pour une vérification requise, et c'est écrit
 * ici plutôt que laissé croire.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const TYPES = join(SRC, 'api', 'types.ts');

/**
 * Les champs qu'on sert et qu'on ne rend pas, chacun avec sa raison.
 *
 * Trois raisons seulement, et la troisième est une dette nommée :
 *
 * — `contrat` : le serveur le rend parce qu'une autre façade en a besoin, ou
 *   parce qu'il complète une paire dont l'app ne lit qu'une moitié. L'app n'en
 *   a pas d'usage et n'en aura pas.
 * — `technique` : consommé par le client d'API lui-même, pas par un écran.
 * — `a-instruire` : **rien ne dit que c'est délibéré.** Ces lignes sont la dette
 *   que cette garde a trouvée en étant écrite, et elles sont reprises une par
 *   une dans `TASKS.md`. Les laisser ici sans les nommer aurait fait de la
 *   table un tapis.
 */
const NON_RENDUS: Record<string, string> = {
  // --- a-instruire : servi, et l'écran refuse délibérément de le lire ---
  //
  // **Le nom civil des créatrices, servi à tout salon abonné.** L'annuaire v3
  // titre chaque fiche du pseudonyme : c'est ce qu'un salon reconnaît, et c'est
  // ce qui suffit pour aller voir son travail. L'identité d'état civil de cent
  // vingt-huit personnes n'a rien à faire sur l'écran de quelqu'un qui ne les a
  // jamais rencontrées — elle arrive à la réservation, quand une créatrice a
  // choisi ce salon. L'écran a cessé de les lire ; **la donnée part toujours
  // sur le réseau**, et c'est là qu'il faut la retirer. Instruit dans TASKS.md.

  // --- contrat : servis pour une autre façade, ou moitié d'une paire ---
  'PalierAccessible.min_completed_collabs': 'contrat',
  'PalierAccessible.min_reliability_score': 'contrat',
  'PalierAccessible.value_ratio_hint': 'contrat',
  'PalierAccessible.display_order': 'contrat',
  'PalierOffrable.min_completed_collabs': 'contrat',
  'PalierOffrable.min_reliability_score': 'contrat',
  'PalierOffrable.value_ratio_hint': 'contrat',
  'PalierOffrable.display_order': 'contrat',
  'ItemDuFil.value_ratio': 'contrat',
  'OffreDeLaFiche.value_ratio': 'contrat',
  'ItemDuCatalogue.created_at': 'contrat',
  'ItemDuCatalogue.updated_at': 'contrat',
  'OffreDePalier.created_at': 'contrat',
  'Booking.ends_at': 'contrat',
  'Booking.hold_expires_at': 'contrat',
  'Creneau.ends_at': 'contrat',
  'ReservationDuCreateur.ends_at': 'contrat',
  'ReservationDuCommerce.ends_at': 'contrat',
  'ReservationDuCreateur.created_at': 'contrat',
  'Verification.item_photo_key': 'contrat',
  'VerificationDuCompte.reviewed_at': 'contrat',
  'Collaboration.approved_at': 'contrat',
  'DroitDeLecture.created_at': 'contrat',
  'RepriseDuCompte.admin_user_id': 'contrat',
  'RepriseDuCompte.ended_at': 'contrat',
  'AutorisationDemarree.last_seen_at': 'contrat',
  'Preuve.content_hash': 'contrat',
  'PlanAdministrateur.features': 'contrat',
  'PlanSouscriptible.features': 'contrat',
  'Abonnement.current_period_end': 'contrat',
  'Abonnement.checkout_url': 'contrat',
  'Fourchette.prestations_publiees': 'contrat',
  'Fourchette.places_par_jour': 'contrat',
  'Fourchette.palier_le_plus_offert': 'contrat',
  'LigneDePalier.valeur_offerte_cents': 'contrat',
  'LigneDItem.valeur_offerte_cents': 'contrat',
  'Reporting.valeur_offerte_cents': 'contrat',

  // --- technique : lu par le client d'API, jamais par un écran ---
  'Jetons.token_type': 'technique',

  // --- tranché : rendu inutile, avec sa raison ---
  //
  // Les six premiers sont du contrat pur. Les deux suivants sont des choix de
  // composition, tranchés par Daniel plutôt que subis.
  'ReservationDuCreateur.business_category': 'contrat',
  'ReservationDuCreateur.item_photo_key': 'contrat',
  'AudienceDuCompte.following_count': 'contrat',
  // Le cadre 01c ne montre que les abonnés, l'engagement et les vues : un
  // nombre de publications ne dit rien à une créatrice sur ce qu'elle peut
  // réserver.
  'AudienceDuCompte.media_count': 'contrat',
  // La date en bloc mono tient le rôle de repère sur la ligne ; une vignette de
  // salon par ligne alourdirait une liste qu'on parcourt.
  'ReservationDuCreateur.business_cover_photo_key': 'contrat',

  // --- à instruire : trois, ouvertes par le fil v3 ---
  //
  // La section était vide et se remplit de nouveau, ce qui est son emploi. Les
  // trois ci-dessous étaient **rendues hier** : elles ne sont pas du contrat,
  // elles sont la trace d'un écran qui a changé et d'un serveur qui ne le sait
  // pas encore. Les glisser en `contrat` fermerait la question au lieu de la
  // poser, et c'est exactement ce que cette section refuse d'être.
  //
  // La couverture 4:5 était servie pour les deux héros du mur en mosaïque, à
  // fond perdu et en portrait. La v3 n'a plus de héros : la grille pose des
  // images de 100 points de haut sur des colonnes de 171, la vignette du
  // quartier est un carré de 44, et aucune de ces trois surfaces n'est un
  // portrait. Soit le serveur cesse de la produire — c'est un rendu de plus par
  // salon —, soit un écran à venir en a l'usage. À trancher, pas à ranger.
  // Le prochain palier était le pied du mur, « la seule fois où le fil parle
  // des paliers ». La revue v3 déplace ce sujet vers Audience, qui ne consulte
  // pas le fil mais `mesPaliers` : le champ reste calculé et n'a plus de
  // lecteur. Deux issues, et c'est une question de route plutôt que d'écran —
  // le servir depuis `mesPaliers`, ou cesser de le calculer sur le fil.
  //
  // La vidéo de fond de l'accueil est retirée par la planche v3 : elle servait
  // à donner envie sur un écran dont le seul travail est de faire choisir un
  // rôle, et elle coûtait six mécanismes — repli sur l'affiche, choix
  // d'orientation, hors-ligne, reprise au premier plan, relance après montage,
  // boucle garantie deux fois. Le manifeste reste servi et n'a plus de lecteur
  // pour sa partie `home`. Les catégories, elles, sont toujours lues.
  'MediasPlateforme.home': 'a-instruire',
  //
  // **Le compte à rebours de #181 n'est pas l'horloge que la planche demande.**
  // Il court jusqu'à `deadline_at`, l'échéance de publication — 48 ou 72 h
  // selon le palier. La jauge verte de la planche mesure la **fenêtre de
  // vérification** : 24 h depuis la publication, au-delà desquelles l'API ne
  // voit plus la story. Deux horloges, sur le même écran, et afficher l'une
  // pour l'autre annoncerait « 21 h » quand il en reste 45.
  //
  // Le champ n'est pas faux pour autant : il retire un calcul local à qui
  // voudrait animer l'échéance de publication. Mais l'écran l'écrit en instant
  // absolu — « avant jeudi 21, 14:30 » plutôt qu'« sous 48 h » — parce qu'un
  // délai demande de compter depuis une date qu'on ne regarde plus. Deux
  // issues : la route sert la fenêtre de vérification et celui-ci reste sans
  // emploi, ou un écran à venir compte l'échéance en délai. À trancher.
  'Collaboration.secondes_avant_echeance': 'a-instruire',
};

const RAISONS = new Set(['contrat', 'technique', 'a-instruire']);

/** Les champs déclarés par chaque type de `types.ts`. */
function champsDeclares(): [string, string][] {
  const source = readFileSync(TYPES, 'utf-8');
  const paires: [string, string][] = [];
  for (const [, nom, corps] of source.matchAll(/export type (\w+) = \{(.*?)\n\};/gs)) {
    for (const [, champ] of corps.matchAll(/^ {2}(\w+)\??:/gm)) paires.push([nom, champ]);
  }
  return paires;
}

/** Tout `src/`, sauf la déclaration elle-même. */
function leResteDeSrc(): string {
  const morceaux: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) parcourir(chemin);
      else if (/\.tsx?$/.test(entree) && chemin !== TYPES) morceaux.push(readFileSync(chemin, 'utf-8'));
    }
  };
  parcourir(SRC);
  return morceaux.join('\n');
}

function estLu(champ: string, blob: string): boolean {
  return new RegExp(`[.\\['"]${champ}\\b`).test(blob) || new RegExp(`\\b${champ}:`).test(blob);
}

describe('un champ servi est rendu, ou sa raison est écrite', () => {
  const declares = champsDeclares();
  const blob = leResteDeSrc();

  it('la garde regarde bien quelque chose', async () => {
    // **L'assertion de volume qui manquait ailleurs.** Un jour, la forme des
    // types change, la lecture rend une liste vide, et le test passe au vert en
    // n'inspectant rien — c'est arrivé au garde-fou des routes publiques.
    expect(declares.length).toBeGreaterThan(300);
  });

  it('aucun champ n’est servi sans être lu ni justifié', async () => {
    const orphelins = declares
      .filter(([typ, champ]) => !estLu(champ, blob))
      .map(([typ, champ]) => `${typ}.${champ}`)
      .filter((clef) => !(clef in NON_RENDUS));

    expect(orphelins).toEqual([]);
  });

  it('et la table ne garde pas de ligne devenue fausse', async () => {
    // **Le sens inverse.** Une table qui ne se vide jamais se remplit de lignes
    // fausses et cesse de dire quoi que ce soit — c'est ce qui est arrivé à
    // `$meta.unconfirmed`, gardé longtemps après que le manque a été comblé.
    const declaresClefs = new Set(declares.map(([t, c]) => `${t}.${c}`));
    const perimees = Object.keys(NON_RENDUS).filter(
      (clef) => !declaresClefs.has(clef) || estLu(clef.split('.')[1], blob),
    );

    expect(perimees).toEqual([]);
  });

  it('chaque raison est l’une des trois, et jamais un mot inventé', async () => {
    for (const [clef, raison] of Object.entries(NON_RENDUS)) {
      expect(RAISONS.has(raison)).toBe(true);
      expect(clef).toMatch(/^\w+\.\w+$/);
    }
  });
});
