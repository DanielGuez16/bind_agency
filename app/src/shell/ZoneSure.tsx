/**
 * La zone sûre, posée une fois pour toute l'application.
 *
 * **Le titre passait sous l'encoche et se coupait, sur tous les écrans.**
 * Traité ici plutôt qu'écran par écran : un écran qui l'oublierait rouvrirait
 * le défaut, et l'oubli ne se voit que sur un appareil à encoche — donc jamais
 * pendant le développement.
 *
 * **Les marges sont appliquées à la main, pas par `SafeAreaView`.** Ce dernier
 * les pose côté natif, dans une vue que le style JavaScript ne montre pas :
 * l'intention devient invisible en lecture et invérifiable en test. Un `View`
 * avec les marges lues par `useSafeAreaInsets` dit exactement ce qu'il fait.
 *
 * **Le bas est laissé à la barre d'onglets**, qui pose son propre décalage.
 * L'ajouter ici la ferait flotter au-dessus du bord de l'écran.
 *
 * **La bande prend la couleur du fond.** Sans couleur, elle laisse voir la
 * racine — blanche — et coupe l'écran d'une barre claire en haut d'un thème
 * sombre.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '../theme';

export function ZoneSure({ children }: { children: ReactNode }) {
  const c = useColors();
  const marges = useSafeAreaInsets();

  return (
    <View
      testID="zone-sure"
      style={{
        flex: 1,
        backgroundColor: c['bg.canvas'],
        paddingTop: marges.top,
        paddingLeft: marges.left,
        paddingRight: marges.right,
      }}
    >
      {children}
    </View>
  );
}
