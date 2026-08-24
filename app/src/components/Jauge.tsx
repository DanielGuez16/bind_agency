/**
 * Une barre de progression, et une seule dans tout le produit.
 *
 * **Elle vit ici parce qu'un écran ne peint pas la teinte de marque.** Les
 * jauges de l'audience v3 — les abonnés vers leur seuil, le score sur cent —
 * sont le même objet à deux endroits ; les écrire deux fois dans l'écran aurait
 * demandé d'exempter le fichier entier de la garde des aplats de marque, et une
 * exemption par fichier laisse passer la pastille orange du mois suivant. Le
 * composant, lui, est le lieu légitime de la teinte.
 *
 * **Une seule couleur de remplissage, et c'est un choix de la planche.** Deux
 * barres identiques en tout sauf la teinte promettraient que la teinte porte un
 * sens, et le système n'a aucune couleur pour « le score est bas » :
 * l'avertissement n'a pas de teinte, le danger est réservé à ce qui est cassé.
 * La piste change — l'ambre clair sous les abonnés, le neutre sous le score —
 * parce qu'elle suit la surface qui la porte, pas l'état qu'elle mesure.
 */
import { View } from 'react-native';

import { radius, useColors, type ColorName } from '../theme';

const HAUTEUR = 8;

export function Jauge({
  fraction,
  piste = 'bg.inset',
  testID,
}: {
  /** De zéro à un. Bornée ici plutôt que chez l'appelant : une valeur aberrante
   * ne doit pas déborder de sa piste, et le rappeler à chaque appel finit par
   * s'oublier une fois. */
  fraction: number;
  piste?: ColorName;
  testID?: string;
}) {
  const c = useColors();
  const part = Math.min(1, Math.max(0, fraction));

  return (
    <View
      testID={testID}
      style={{
        height: HAUTEUR,
        borderRadius: radius['radius.pill'],
        backgroundColor: c[piste],
        overflow: 'hidden',
      }}
    >
      <View
        testID={testID ? `${testID}-part` : undefined}
        style={{
          width: `${Math.round(part * 100)}%`,
          height: HAUTEUR,
          borderRadius: radius['radius.pill'],
          backgroundColor: c['brand.500'],
        }}
      />
    </View>
  );
}
