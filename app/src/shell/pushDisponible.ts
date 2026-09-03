/**
 * Cette plateforme peut-elle délivrer un jeton de notification distante.
 *
 * **`Device.isDevice` ne répond pas à cette question, et le croire a coûté une
 * popup en production.** `useNotificationsPush` s'en servait comme test unique
 * — « rien sur un simulateur ni sur le web », disait son en-tête — mais
 * `expo-device` rend `isDevice: true` **en dur** sur tout navigateur, bureau
 * comme mobile. La garde ne fermait donc jamais sur le web : une vraie fenêtre
 * « Autoriser les notifications ? » s'ouvrait juste après la connexion, sans
 * qu'aucun écran ne l'ait annoncée, et le produit demandait une autorisation
 * qu'il ne pouvait de toute façon pas utiliser.
 *
 * **Deux plateformes, deux empêchements différents.**
 *
 * En natif, `Device.isDevice` est juste : il distingue un vrai téléphone d'un
 * simulateur, qui n'a pas de jeton distant.
 *
 * Sur le web, la question n'est pas le matériel — c'est la configuration.
 * `getExpoPushTokenAsync` y exige `notification.vapidPublicKey` dans
 * `app.json` et lève `ERR_NOTIFICATIONS_PUSH_WEB_MISSING_CONFIG` sans elle.
 * Cette clé n'existe pas dans ce dépôt : sur le web, l'enregistrement est donc
 * **garanti** d'échouer, et demander l'autorisation avant de le découvrir
 * revient à déranger quelqu'un pour rien.
 *
 * **Lue au même endroit que la bibliothèque la lit.** `expo-notifications` va
 * chercher `Constants.expoConfig?.notification?.vapidPublicKey` ; recopier la
 * valeur ailleurs — un drapeau à nous, une variable d'environnement — ferait
 * deux vérités, et c'est la nôtre qui vieillirait le jour où la clé arriverait
 * vraiment. Le jour où elle est posée dans `app.json`, ce module dit oui sans
 * qu'on y touche.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * La clé VAPID déclarée, ou rien.
 *
 * `notification` n'est pas au schéma de `expoConfig` — `expo-notifications`
 * lui-même le contourne par un `@ts-expect-error`. On lit donc par un accès
 * indexé typé, qui dit la même chose sans désactiver le contrôle de types.
 */
function cleVapid(): string | null {
  const config = Constants.expoConfig as
    | ({ notification?: { vapidPublicKey?: string } } | null)
    | undefined;
  return config?.notification?.vapidPublicKey ?? null;
}

/**
 * Vrai quand un jeton distant est **obtenable ici**.
 *
 * Faux ne veut pas dire « refusé » : rien n'a été demandé, et il n'y a rien à
 * lever dans des réglages. C'est la distinction que porte `IssueDuJeton` entre
 * `indisponible` et `refusee`.
 */
export function pushDisponible(): boolean {
  if (Platform.OS === 'web') return cleVapid() !== null;
  return Device.isDevice;
}
