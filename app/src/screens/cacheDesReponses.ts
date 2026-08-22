/**
 * Ce qu'on a déjà vu, rendu avant que le réseau réponde.
 *
 * **La règle des 400 ms n'était vraie qu'au second lancement.** Un fil déjà
 * consulté hier repart d'un écran de chargement à chaque ouverture, alors que
 * la réponse d'hier est presque toujours la bonne : des salons n'apparaissent
 * pas en une nuit. Ce module range la dernière réponse réussie, et l'écran la
 * pose immédiatement pendant que la requête part quand même.
 *
 * ## Ce qui se cache, et ce qui ne se cache jamais
 *
 * **L'inscription est au cas par cas, chez l'appelant**, et c'est délibéré :
 * un cache posé par défaut finirait par couvrir une route qui décide d'un
 * geste. Les routes inscrites changent en heures ou en jours — l'appartenance,
 * le fil, la fiche d'un salon, sa carte, ses paliers, les plans.
 *
 * Ce qui n'y entre pas est la moitié qui compte : la disponibilité, la journée
 * du commerce, les réservations, les contreparties, les codes de retrait, les
 * reprises de compte. Toutes décident d'un geste à l'instant où on les lit.
 * Une réponse d'il y a dix minutes y ferait tenir un créneau déjà pris, ou
 * dirait « personne n'est dans votre compte » à quelqu'un chez qui on est
 * entré.
 *
 * ## Trois règles, et chacune répare quelque chose de précis
 *
 * **La clé porte une version.** Un champ retiré du contrat rendrait une
 * réponse d'hier incompatible avec l'écran d'aujourd'hui — et le défaut
 * n'apparaîtrait que chez ceux qui avaient déjà ouvert l'application, c'est-à-
 * dire jamais en développement.
 *
 * **Tout est effacé à la fermeture de session.** Une réponse en cache est de la
 * donnée personnelle : la laisser survivre à une déconnexion la rendrait
 * lisible au suivant, sur un téléphone prêté comme sur un poste partagé.
 *
 * **Passé un âge, on n'affiche plus rien.** Un fil de la semaine dernière vaut
 * moins qu'un écran de chargement : il montre des salons qui ne sont peut-être
 * plus là, et il le montre avec l'aplomb d'une réponse fraîche.
 *
 * `AsyncStorage` et non le trousseau : ce ne sont pas des secrets, et une
 * lecture de Keychain à chaque montage d'écran se paierait à chaque ouverture.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Le préfixe de toutes nos clés, **et sa version**.
 *
 * Elle se change à la main le jour où une forme servie change de façon
 * incompatible. C'est plus grossier qu'une invalidation par champ, et c'est
 * voulu : une invalidation fine se trompe en silence, celle-ci jette tout et
 * l'écran repart d'une requête, ce qu'il savait déjà faire.
 */
export const PREFIXE = 'bind.cache.v1.';

export type EntreeDuCache<T> = { donnees: T; vuA: number };

/** Ce qu'on a rangé sous cette clé, ou `null`. Jamais une exception. */
export async function lireDuCache<T>(cle: string): Promise<EntreeDuCache<T> | null> {
  try {
    const brut = await AsyncStorage.getItem(PREFIXE + cle);
    if (!brut) return null;
    const entree = JSON.parse(brut) as EntreeDuCache<T>;
    // **Une forme inattendue vaut une absence.** Rendre un objet à moitié
    // rempli ferait planter l'écran sur une donnée qu'il croit complète, et le
    // plantage arriverait à l'ouverture — le pire endroit.
    if (typeof entree?.vuA !== 'number' || !('donnees' in entree)) return null;
    return entree;
  } catch {
    return null;
  }
}

/** Range la dernière réponse réussie. Un échec d'écriture ne casse rien. */
export async function ecrireAuCache<T>(cle: string, donnees: T, vuA: number): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIXE + cle, JSON.stringify({ donnees, vuA }));
  } catch {
    // Stockage plein, quota du navigateur : l'écran a ses données, il les
    // affiche. Le prochain lancement repartira d'une requête, comme avant.
  }
}

/**
 * Efface tout ce que nous avons rangé. **Appelé à la fermeture de session.**
 *
 * Nos clés seulement : `AsyncStorage.clear()` emporterait le salon choisi, le
 * repli de la barre et la préférence de notifications, qui ne sont pas des
 * réponses et n'ont rien à voir avec la personne connectée.
 */
export async function viderLeCache(): Promise<void> {
  try {
    const clefs = await AsyncStorage.getAllKeys();
    const lesNotres = clefs.filter((cle) => cle.startsWith(PREFIXE));
    if (lesNotres.length > 0) await AsyncStorage.multiRemove(lesNotres);
  } catch {
    // Rien à faire de plus ici. La session est fermée dans tous les cas, et
    // une erreur de stockage ne doit pas empêcher quelqu'un de sortir.
  }
}

/**
 * Les âges au-delà desquels on n'affiche plus, en millisecondes.
 *
 * **Ce sont des plafonds d'affichage, pas des durées de validité.** La requête
 * part toujours ; ce nombre décide seulement si on montre quelque chose en
 * l'attendant. Un fil de plus de six heures est encore probablement juste — on
 * ne le montre pas parce qu'un salon fermé entre-temps se lirait comme ouvert
 * pendant les quelques centaines de millisecondes où l'écran est le seul à
 * parler.
 */
export const AGES = {
  /** L'appartenance : elle ne change que lorsqu'on rejoint ou quitte un salon. */
  appartenance: 7 * 24 * 3600 * 1000,
  /** Le fil, la fiche d'un salon, sa carte : des heures, pas des jours. */
  contenu: 6 * 3600 * 1000,
  /** Les paliers et les plans : de la configuration, qui bouge à peine. */
  configuration: 24 * 3600 * 1000,
} as const;
