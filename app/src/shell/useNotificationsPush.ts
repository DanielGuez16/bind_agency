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

/** Ce qu'on a pu faire. Rendu pour les tests ; l'app n'en affiche rien. */
export type IssueDuJeton =
  | { issue: 'enregistre'; token: string }
  /** Refusée, ou jamais accordée. L'écran de réglages dit où la lever. */
  | { issue: 'refusee' }
  /** Simulateur, navigateur : Expo n'y délivre pas de jeton distant. */
  | { issue: 'indisponible' }
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
