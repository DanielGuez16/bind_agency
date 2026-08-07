/**
 * Où vivent les jetons.
 *
 * **Le trousseau de l'appareil, pas le stockage local.** `AsyncStorage` écrit
 * en clair dans un fichier que n'importe quelle sauvegarde emporte et que le
 * navigateur expose à tout script du même domaine. Un jeton d'accès y vaut une
 * session complète pendant quinze minutes, un jeton de rafraîchissement pendant
 * trente jours. `expo-secure-store` s'appuie sur le Keychain iOS et le
 * Keystore Android, qui sont faits pour cela.
 *
 * **Le web n'a pas de trousseau.** `expo-secure-store` n'y est pas disponible,
 * et il n'existe rien d'équivalent dans un navigateur. On retombe sur
 * `AsyncStorage`, et on le dit : la version web est une commodité de
 * développement, pas une cible de production. Un repli silencieux aurait fait
 * croire que le web est protégé comme le natif.
 *
 * **Une lecture qui échoue vaut une absence de session, jamais une exception.**
 * Un trousseau verrouillé, un stockage corrompu : dans tous les cas on repart
 * d'une connexion. Lever au démarrage donnerait un écran blanc.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { CoffreDeJetons, Jetons } from '../api';

const CLE = 'bind.tokens';

/** Vrai quand le trousseau de l'appareil est réellement disponible. */
export const trousseauDisponible = Platform.OS !== 'web';

async function lireBrut(): Promise<string | null> {
  if (!trousseauDisponible) return AsyncStorage.getItem(CLE);
  return SecureStore.getItemAsync(CLE);
}

async function ecrireBrut(valeur: string | null): Promise<void> {
  if (!trousseauDisponible) {
    if (valeur === null) await AsyncStorage.removeItem(CLE);
    else await AsyncStorage.setItem(CLE, valeur);
    return;
  }
  if (valeur === null) await SecureStore.deleteItemAsync(CLE);
  else await SecureStore.setItemAsync(CLE, valeur);
}

export const coffreSecurise: CoffreDeJetons = {
  async lire(): Promise<Jetons | null> {
    try {
      const brut = await lireBrut();
      if (!brut) return null;
      const jetons = JSON.parse(brut) as Jetons;
      // Une forme inattendue vaut une absence : on ne rend pas un objet à
      // moitié rempli que le client attacherait ensuite à ses en-têtes.
      return jetons?.access_token && jetons?.refresh_token ? jetons : null;
    } catch {
      return null;
    }
  },

  async ecrire(jetons: Jetons | null): Promise<void> {
    try {
      await ecrireBrut(jetons === null ? null : JSON.stringify(jetons));
    } catch {
      // Un trousseau qui refuse d'écrire ne doit pas faire échouer une
      // connexion réussie : la session vivra le temps du processus. C'est
      // dégradé, ce n'est pas cassé.
    }
  },
};
