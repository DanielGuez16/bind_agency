/**
 * Demander l'autorisation, puis donner son jeton au serveur.
 *
 * **Rien n'est demandé au premier écran.** Une autorisation réclamée avant
 * d'avoir montré à quoi elle sert se refuse, et une fois refusée elle ne se
 * redemande plus — c'est la même règle que la position, et elle a coûté cher
 * là-bas. On attend d'être connecté : à ce moment, il y a des réservations à
 * suivre et des publications à rendre, donc quelque chose à annoncer.
 *
 * **Le jeton se réaffirme à chaque démarrage.** Il change quand l'application
 * est réinstallée, et la route est idempotente pour cette raison — c'est un
 * `PUT`, pas un `POST`.
 *
 * **Un refus n'est pas une panne.** On ne bloque rien, on ne remonte rien à
 * l'écran : le produit fonctionne sans notifications, il prévient seulement
 * moins bien. L'écran de réglages, lui, dit où le lever.
 *
 * **Rien sur un simulateur ni sur le web.** Expo n'y délivre pas de jeton
 * distant, et le demander lève. `Device.isDevice` est le seul test fiable.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import type { Api, PlateformeDeTerminal } from '../api';
import { refuseesSurCetAppareil } from './notificationsDeCetAppareil';

/** Ce qu'on a pu faire. Rendu pour les tests ; l'app n'en affiche rien. */
export type IssueDuJeton =
  | { issue: 'enregistre'; token: string }
  /** Refusée, ou jamais accordée. L'écran de réglages dit où la lever. */
  | { issue: 'refusee' }
  /** Simulateur, navigateur : Expo n'y délivre pas de jeton distant. */
  | { issue: 'indisponible' }
  /**
   * L'appareil a demandé qu'on le laisse tranquille, dans les réglages.
   *
   * **Distinct de `refusee`**, qui est le refus du système : celui-ci se lève
   * dans les réglages de l'application, l'autre dans ceux du téléphone. Les
   * confondre enverrait quelqu'un chercher au mauvais endroit.
   */
  | { issue: 'refusee-ici' }
  /** Le serveur n'a pas voulu, ou le réseau manquait. Sans conséquence. */
  | { issue: 'echec' };

function plateforme(): PlateformeDeTerminal {
  if (Platform.OS === 'ios') return 'ios';
  return Platform.OS === 'android' ? 'android' : 'web';
}

/**
 * Obtient le jeton et le donne au serveur.
 *
 * Exportée à part du hook : c'est la seule règle de ce module qui mérite
 * d'être éprouvée seule, et la tester au travers d'un effet demanderait de
 * monter un arbre pour vérifier une suite de conditions.
 */
export async function enregistrerCeTerminal(api: Api): Promise<IssueDuJeton> {
  // Un simulateur n'a pas de jeton distant, et le demander lève.
  if (!Device.isDevice) return { issue: 'indisponible' };

  // **Le refus de l'appareil se relit avant de repartir.** Sans cette lecture,
  // couper les notifications dans les réglages serait défait au lancement
  // suivant — un geste qui s'annule tout seul est un bouton qui ment.
  if (await refuseesSurCetAppareil()) return { issue: 'refusee-ici' };

  try {
    const actuel = await Notifications.getPermissionsAsync();
    // **On ne redemande que si le système accepte encore de poser la
    // question.** Après un refus, `requestPermissionsAsync` répond « refusé »
    // sans rien afficher : insister ne rouvre rien.
    const accorde =
      actuel.granted ||
      (actuel.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!accorde) return { issue: 'refusee' };

    const { data } = await Notifications.getExpoPushTokenAsync();
    await api.enregistrerUnTerminal({ token: data, platform: plateforme() });
    return { issue: 'enregistre', token: data };
  } catch {
    // Ni autorisation, ni réseau, ni identifiant de projet : le produit
    // fonctionne sans notifications. Lever ferait tomber la frontière
    // d'erreur sur un manque parfaitement supportable.
    return { issue: 'echec' };
  }
}

/**
 * Le jeton de cet appareil, sans l'enregistrer.
 *
 * **Séparé de l'enregistrement**, parce que révoquer et enregistrer sont deux
 * gestes opposés qui ont besoin de la même chose : couper suppose de connaître
 * le jeton, et le demander en passant par l'enregistrement le réinscrirait
 * juste avant de le retirer.
 */
export async function jetonDeCetAppareil(): Promise<string | null> {
  if (!Device.isDevice) return null;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync();
    return data;
  } catch {
    // Sans jeton, il n'y a rien à révoquer côté serveur — et le refus local
    // suffit à ce que rien ne se réenregistre.
    return null;
  }
}

/**
 * Réaffirme le jeton une fois par session connectée.
 *
 * `actif` vient de la session : sans lui, le hook demanderait l'autorisation
 * sur l'écran de connexion, c'est-à-dire avant d'avoir rien montré.
 */
export function useNotificationsPush(api: Api, actif: boolean): void {
  useEffect(() => {
    if (!actif) return;
    let vivant = true;
    void enregistrerCeTerminal(api).then(() => {
      // Rien à faire du résultat : il n'y a pas d'écran à mettre à jour, et
      // un état ici ne servirait qu'à provoquer un rendu de plus.
      void vivant;
    });
    return () => {
      vivant = false;
    };
  }, [api, actif]);
}
