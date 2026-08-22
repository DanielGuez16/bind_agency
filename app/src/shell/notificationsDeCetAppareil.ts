/**
 * Couper les notifications sur cet appareil, et que ça tienne.
 *
 * **Révoquer ne suffit pas.** Le jeton se réenregistre à chaque ouverture de
 * session : couper sans mémoriser le choix ferait un geste qui s'annule tout
 * seul au lancement suivant, c'est-à-dire un bouton qui ment. Le refus est donc
 * gardé sur l'appareil, et l'enregistrement le relit avant de repartir.
 *
 * **Ce que cet écran ne fait pas, et il faut le dire.** Il coupe les
 * notifications de **l'appareil qu'on tient**. Couper celles d'un téléphone
 * perdu demande de les énumérer depuis un autre appareil, et aucune route ne
 * liste les terminaux — `PUT /me/devices` et `DELETE /me/devices/{token}`
 * existent, `GET` non. Révoquer exige de posséder le jeton, qu'on n'a que sur
 * le téléphone lui-même. Voir `TASKS.md`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CLE = 'bind.notifications.refusees';

/**
 * Vrai quand l'appareil a demandé qu'on le laisse tranquille.
 *
 * Un stockage indisponible répond faux : le défaut est de notifier, parce que
 * c'est ce que l'utilisateur a accordé au système. Un défaut inverse ferait
 * taire les notifications de quelqu'un qui n'a rien demandé, sur une panne de
 * disque.
 */
export async function refuseesSurCetAppareil(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CLE)) === 'oui';
  } catch {
    return false;
  }
}

export async function noterLeRefus(refusees: boolean): Promise<void> {
  try {
    if (refusees) await AsyncStorage.setItem(CLE, 'oui');
    else await AsyncStorage.removeItem(CLE);
  } catch {
    // Un stockage indisponible ne doit pas empêcher le geste : la révocation
    // côté serveur a déjà eu lieu, et c'est elle qui compte aujourd'hui.
  }
}
