/**
 * Le repli de la barre latérale : un choix, retenu par appareil.
 *
 * **Jamais une conséquence de la largeur.** La passation est explicite : la
 * barre se replie parce que quelqu'un l'a demandé, pas parce que la fenêtre a
 * rétréci. Une barre qui se replie toute seule à 1000 points et se redéploie à
 * 1100 fait sauter la mise en page pendant qu'on redimensionne, et personne ne
 * comprend ce qui la commande.
 *
 * **`AsyncStorage` et non le trousseau.** Le trousseau est pour les jetons —
 * `session/coffre.ts` dit pourquoi. Une préférence d'affichage n'a rien à y
 * faire : elle n'est pas un secret, et l'y mettre ferait payer une lecture de
 * Keychain à chaque démarrage pour savoir s'il faut afficher des libellés.
 *
 * **Une lecture qui échoue vaut « déployée ».** Stockage plein, valeur
 * corrompue : on retombe sur l'état le plus lisible, jamais sur une exception
 * au montage de la coquille.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const CLE = 'bind.barreLaterale.replie';

export async function lireLeRepli(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CLE)) === 'oui';
  } catch {
    return false;
  }
}

export async function ecrireLeRepli(replie: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(CLE, replie ? 'oui' : 'non');
  } catch {
    // Le choix vaut pour cette session, et c'est déjà l'essentiel. Échouer ici
    // ne doit pas empêcher la barre de se replier à l'écran.
  }
}

/**
 * L'état du repli et de quoi le changer.
 *
 * La lecture est asynchrone : la barre s'affiche déployée le temps d'un aller
 * au stockage. C'est le bon sens du défaut — un rail qui se déploie est moins
 * surprenant qu'une barre qui se replie sous les yeux.
 */
export function useRepli(): [boolean, () => void] {
  const [replie, setReplie] = useState(false);

  useEffect(() => {
    let vivant = true;
    void lireLeRepli().then((valeur) => {
      if (vivant) setReplie(valeur);
    });
    return () => {
      vivant = false;
    };
  }, []);

  const basculer = useCallback(() => {
    setReplie((precedent) => {
      const suivant = !precedent;
      void ecrireLeRepli(suivant);
      return suivant;
    });
  }, []);

  return [replie, basculer];
}
