/**
 * La position du téléphone, pour le fil.
 *
 * **Nulle tant que l'autorisation n'est pas donnée**, et l'écran du fil le sait :
 * il propose de la demander plutôt que d'appeler l'API sans coordonnées, ce qui
 * rendrait une erreur de validation qu'il traduirait mal.
 *
 * **Rien n'est demandé au démarrage.** Une autorisation réclamée avant d'avoir
 * montré à quoi elle sert se refuse, et une fois refusée elle ne se redemande
 * plus. C'est l'écran qui la demande, quand il en a besoin.
 *
 * **Un refus n'est pas une panne.** On reste sans position, l'écran continue de
 * proposer. Lever ferait tomber la frontière d'erreur sur une décision
 * parfaitement légitime.
 */
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';

export type Position = { longitude: number; latitude: number };

export function usePosition() {
  const [position, setPosition] = useState<Position | null>(null);

  const demander = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const lue = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPosition({
        longitude: lue.coords.longitude,
        latitude: lue.coords.latitude,
      });
    } catch {
      // Ni service de localisation, ni matériel, ni autorisation : on reste
      // sans position, et l'écran continue de proposer de la donner.
    }
  }, []);

  return { position, demander: () => void demander() };
}
