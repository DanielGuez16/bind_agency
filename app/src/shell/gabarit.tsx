/**
 * Le gabarit : compact ou étendu, mesuré sur le conteneur.
 *
 * **Jamais `useWindowDimensions`.** Le seuil porte sur la place réellement
 * disponible, pas sur la taille de la fenêtre : une tablette en écran partagé,
 * une fenêtre de navigateur réduite à côté d'un éditeur, un iPad en Slide Over
 * ont tous une fenêtre large et un conteneur étroit. Mesurer la fenêtre y
 * déploierait une barre latérale de 240 dans 380 points de large. C'est la
 * contrainte que la passation nomme — « seuils mesurés sur le conteneur et
 * jamais en media query » — et elle vaut aussi en React Native, où la media
 * query n'existe pas mais où `Dimensions` en tient lieu.
 *
 * **Compact tant que rien n'est mesuré.** La première image est rendue avant le
 * premier `onLayout` ; partir de « étendu » ferait apparaître une barre latérale
 * le temps d'une image sur un téléphone. Le défaut va donc dans le sens le plus
 * étroit, celui qui ne casse rien s'il se trompe.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { breakpoint } from '../theme';

export type Gabarit = {
  /** La largeur du conteneur, en points. Zéro avant la première mesure. */
  largeur: number;
  /** Au-delà du seuil « expanded » : barre latérale au lieu d'onglets. */
  large: boolean;
};

const COMPACT: Gabarit = { largeur: 0, large: false };

const Contexte = createContext<Gabarit>(COMPACT);

/**
 * Mesure la place disponible et la met à disposition de l'arbre.
 *
 * Placé au-dessus de la navigation, sous la zone sûre : ce qu'on mesure est ce
 * dont la coquille dispose vraiment, encoches déduites.
 */
export function GabaritProvider({ children }: { children: ReactNode }) {
  const [largeur, setLargeur] = useState(0);

  const valeur = useMemo<Gabarit>(
    () => ({ largeur, large: largeur >= breakpoint.expanded }),
    [largeur],
  );

  const mesurer = (evenement: LayoutChangeEvent) => {
    const mesuree = Math.round(evenement.nativeEvent.layout.width);
    // Arrondi et comparé : une largeur qui oscille d'un demi-point à chaque
    // rotation d'écran relancerait un rendu de tout l'arbre pour rien.
    setLargeur((precedente) => (precedente === mesuree ? precedente : mesuree));
  };

  return (
    <View style={{ flex: 1 }} onLayout={mesurer}>
      <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
    </View>
  );
}

export function useGabarit(): Gabarit {
  return useContext(Contexte);
}

/**
 * La largeur maximale du contenu, par nature d'écran.
 *
 * En compact, aucune borne : le contenu occupe la colonne. En étendu, chaque
 * nature a la sienne — et le vide à droite d'un détail commerce est voulu, pas
 * un défaut de remplissage.
 */
export type NatureDeContenu = 'creator' | 'merchant' | 'reports';

const BORNES: Record<NatureDeContenu, number> = {
  creator: breakpoint.contentMaxCreator,
  merchant: breakpoint.contentMaxMerchant,
  reports: breakpoint.contentMaxReports,
};

export function largeurMaximale(
  nature: NatureDeContenu,
  large: boolean,
): number | undefined {
  return large ? BORNES[nature] : undefined;
}
