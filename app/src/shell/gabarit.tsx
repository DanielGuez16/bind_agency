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

import { breakpoint, density } from '../theme';
import { ECART_DES_COLONNES, placeDisponible } from './placeDisponible';

export type Gabarit = {
  /** La largeur du conteneur, en points. Zéro avant la première mesure. */
  largeur: number;
  /**
   * Y a-t-il la place pour une seconde colonne de `besoin` points ?
   *
   * **`large` ne suffit pas, et rien ne composait entre 390 et 1512.** Le seuil
   * `expanded` vaut 900 : à cette largeur exacte, la barre latérale déployée en
   * prend 240 et il reste 660 pour le contenu. Une colonne latérale fixe de 440
   * — le journal de la caisse — laissait alors **196 points** au pavé de code,
   * c'est-à-dire moins que ce qui l'accompagne. Rien ne débordait : la colonne
   * fixe tient sa largeur et c'est le corps qui se comprime, ce qui rend le
   * défaut invisible à toute garde qui cherche un débordement.
   *
   * La question à poser n'est donc pas « l'écran est-il large » mais **« reste-t-il
   * la place »**. Chaque écran connaît la largeur de sa seconde colonne ; il la
   * donne, et cette fonction répond.
   *
   * **La barre est comptée déployée, toujours.** Son repli est une préférence
   * d'appareil qui vit ailleurs, et la lire ici coupleraient la mesure à un
   * réglage. Compter le pire fait scinder un peu plus tard qu'il n'aurait été
   * possible — jamais plus tôt qu'il ne faut, ce qui est le seul sens dans
   * lequel l'erreur est sans conséquence.
   */
  place: (besoin: number) => boolean;
  /** Au-delà du seuil « expanded » : barre latérale au lieu d'onglets. */
  large: boolean;
};

const COMPACT: Gabarit = { largeur: 0, large: false, place: () => false };

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
    () => ({
      largeur,
      large: largeur >= breakpoint.expanded,
      // L'écart entre les deux colonnes est celui du système, et il compte : à
      // vingt-quatre points près on scinde une colonne qui ne tient pas.
      place: (besoin: number) => placeDisponible(largeur, besoin),
    }),
    [largeur],
  );

  const mesurer = (evenement: LayoutChangeEvent) => {
    const mesuree = Math.round(evenement.nativeEvent.layout.width);
    // Arrondi et comparé : une largeur qui oscille d'un demi-point à chaque
    // rotation d'écran relancerait un rendu de tout l'arbre pour rien.
    setLargeur((precedente) => (precedente === mesuree ? precedente : mesuree));
  };

  return (
    // Le `testID` n'est pas décoratif : c'est par lui qu'un test envoie une
    // vraie mesure. Sans point d'accroche, la seule façon d'éprouver le grand
    // écran serait de remplacer `useGabarit` — et l'on ne vérifierait plus
    // jamais que quelque chose renseigne la largeur.
    <View testID="gabarit" style={{ flex: 1 }} onLayout={mesurer}>
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
export { ECART_DES_COLONNES } from './placeDisponible';

export type NatureDeContenu =
  | 'creator'
  | 'merchant'
  | 'reports'
  | 'merchantListeDetail'
  /**
   * L'arbitrage : une file de six colonnes **et** le dossier ouvert à côté.
   *
   * **`reports` ne suffisait pas, et la mesure seule l'a dit.** L'écran la
   * déclarait déjà — 1120 points — mais cette borne vaut pour un contenu d'un
   * seul tenant : ici le panneau de détail en prend 440 fixes, et la file
   * héritait des 608 restants pour une table qui en fait 760. « Reasons » et
   * « Flagged » — le motif répété et l'ancienneté, c'est-à-dire les deux
   * colonnes sur lesquelles on tranche — tombaient hors du cadre.
   *
   * Rien ne le signalait : la colonne fixe tient sa largeur et c'est la file
   * qui se comprime, sous un `overflow: 'hidden'` sans défilement. Même défaut
   * que celui déjà noté dans `placeDisponible` — un dépassement qu'aucune
   * garde ne voit parce qu'il n'en est pas un.
   */
  | 'adminListeDetail'
  /**
   * Un écran rendu **dans** une colonne déjà bornée par son parent.
   *
   * Les trois écrans de la configuration vivent à droite du menu de sections :
   * s'y borner à 720 y centrait une colonne dans le reste de la place, et le
   * contenu flottait dans une grande surface — le défaut de fond de la
   * campagne 2. Ce n'est pas une borne de plus, c'est l'absence de borne :
   * celle du parent est la bonne, elle a déjà retiré la barre latérale et le
   * menu.
   */
  | 'section';

/**
 * Ce que mesure la file de l'arbitrage : ses six colonnes, plus la marge de
 * douze points que `TableRow` pose de chaque côté.
 *
 * **Ici et non dans `tokens.json`.** Ce n'est pas un jeton de Design, c'est la
 * somme de largeurs que le produit a choisies : la ranger avec la palette
 * l'aurait rendue invisible au seul endroit où elle peut se démentir. Une
 * assertion dans `arbitrage-v3.test.tsx` la confronte aux colonnes réelles —
 * sans elle, élargir une colonne recréerait le débord en silence.
 */
const LARGEUR_DE_LA_FILE_ADMIN = 760;

const BORNES: Record<NatureDeContenu, number> = {
  creator: breakpoint.contentMaxCreator,
  merchant: breakpoint.contentMaxMerchant,
  reports: breakpoint.contentMaxReports,
  // Deux colonnes : la liste **et** le détail. Borner l'ensemble à 720 —
  // la borne du détail seul — écraserait la liste à 300 et rendrait ses
  // lignes illisibles. L'addition est ici plutôt que dans l'écran, avec les
  // autres largeurs, sinon elle dériverait des jetons sans qu'on le voie.
  merchantListeDetail:
    breakpoint.listWidthMerchant + ECART_DES_COLONNES + breakpoint.contentMaxMerchant,
  // La file de l'arbitrage **et** le dossier ouvert.
  //
  // **Les marges de l'écran sont dans l'addition, et les oublier a laissé le
  // défaut en place.** La borne s'applique au conteneur d'`Ecran`, qui pose
  // ensuite `screenPaddingLarge` de chaque côté *à l'intérieur* : sans les
  // quarante-huit points, la file recevait 712 pour 760 et « Flagged » restait
  // coupée. La première version de cette ligne les omettait, et l'assertion
  // écrite en même temps les omettait aussi — donc elle est passée au vert sur
  // un écran encore coupé. C'est le navigateur qui l'a dit, pas le test.
  adminListeDetail:
    LARGEUR_DE_LA_FILE_ADMIN +
    ECART_DES_COLONNES +
    breakpoint.detailPanelAdmin +
    2 * density.creator.screenPaddingLarge,
  // Zéro veut dire « aucune borne » : `largeurMaximale` le traduit en
  // `undefined`. Le parent a déjà mesuré ce qui restait.
  section: 0,
};



export function largeurMaximale(
  nature: NatureDeContenu,
  large: boolean,
): number | undefined {
  return large ? BORNES[nature] || undefined : undefined;
}
