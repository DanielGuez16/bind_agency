/**
 * Le salon qu'on regarde, quand on en a deux.
 *
 * **Retenu par appareil, comme le repli de la barre.** Un gérant qui gère deux
 * adresses ouvre l'application sur celle où il travaille ce jour-là ; la lui
 * faire rechoisir à chaque démarrage transformerait un choix rare en geste
 * quotidien. `AsyncStorage` et non le trousseau : ce n'est pas un secret, et
 * une lecture de Keychain au montage de la coquille se paierait à chaque
 * ouverture pour savoir quel nom afficher.
 *
 * **Un identifiant retenu ne fait jamais autorité.** Il est confronté à la
 * liste d'appartenance à chaque montage : un salon qu'on a quitté, révoqué, ou
 * dont on a perdu l'accès ne doit pas rester choisi. Retomber sur le premier de
 * la liste est le comportement d'avant le sélecteur, donc rien ne s'aggrave si
 * la mémoire ment.
 *
 * **Une lecture qui échoue vaut « aucun choix ».** Stockage plein, valeur
 * corrompue : on retombe sur le premier, jamais sur une exception au montage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CLE = 'bind.commerce.choisi';

export async function lireLeChoix(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CLE);
  } catch {
    return null;
  }
}

export async function retenirLeChoix(businessId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CLE, businessId);
  } catch {
    // Le choix vaut pour cette session, il ne survivra pas au redémarrage.
    // Mieux que de faire échouer un geste de navigation.
  }
}

/**
 * Le salon retenu s'il est toujours dans la liste, sinon le premier.
 *
 * Pure et exportée : c'est la règle qui décide ce qu'on regarde, et elle
 * s'éprouve sans monter de coquille ni de stockage.
 */
export function commerceRetenu<T extends { id: string }>(
  commerces: readonly T[],
  choisi: string | null,
): T | null {
  if (commerces.length === 0) return null;
  return commerces.find((commerce) => commerce.id === choisi) ?? commerces[0];
}
