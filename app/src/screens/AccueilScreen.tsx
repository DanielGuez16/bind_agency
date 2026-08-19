/**
 * Le premier écran du produit : deux portes, et rien derrière elles.
 *
 * **La vidéo part, et ce n'est pas une perte.** Elle servait à donner envie sur
 * un écran dont le seul travail est de faire **choisir un rôle**. Ce qui donne
 * envie est le fil derrière, et personne n'y arrive plus vite parce qu'un fond
 * bouge.
 *
 * **Ce qu'elle emporte avec elle, et c'est le vrai gain** : le repli sur
 * l'affiche, le choix d'orientation entre une 16:9 et une 9:16, le cas « pas de
 * réseau », la reprise après un retour au premier plan, la relance après le
 * montage parce que Safari refuse une lecture demandée avant que l'élément
 * existe, et la boucle garantie deux fois. Six mécanismes pour un fond. L'écran
 * s'ouvre aussi plus vite, ce qu'on attend d'un premier écran.
 *
 * **Le satin part avec elle.** Il était la couche du dessous, posée là pour que
 * la composition ne change pas entre la première image et l'arrivée du
 * manifeste. Sans manifeste, il n'y a plus rien qui arrive : la composition est
 * la même à la milliseconde zéro et à la seconde suivante, ce qui était tout ce
 * qu'on lui demandait.
 *
 * **Et le défilement part aussi.** Il existait parce que deux cartes empilées
 * dépassaient la hauteur d'un iPhone. Côte à côte, elles tiennent : sur
 * 390 × 844, barre d'état et marge basse retirées, il reste 728 points, et
 * l'écran s'y range sans que rien ne sorte.
 */
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RoleInscriptible } from '../session';
import { useColors } from '../theme';
import { ChoixDeLaPorte } from './ChoixDeLaPorte';

export function AccueilScreen({
  onChoisir,
  onSeConnecter,
}: {
  onChoisir: (role: RoleInscriptible) => void;
  onSeConnecter: () => void;
}) {
  const c = useColors();
  // La barre d'onglets n'existe pas avant la connexion : sans cette marge, le
  // lien de connexion se termine sous la barre d'accueil de l'iPhone,
  // atteignable et impressable.
  const marges = useSafeAreaInsets();

  return (
    <View
      testID="ecran-accueil"
      style={{
        flex: 1,
        backgroundColor: c['bg.page'],
        paddingHorizontal: 20,
        paddingTop: marges.top,
        paddingBottom: marges.bottom,
      }}
    >
      {/* **`surMedia` disparaît avec le média.** Il valait `true` en dur depuis
          que le satin était devenu la couche du dessous ; il n'y a plus de
          couche, donc plus rien à distinguer. Les encres claires calibrées pour
          une image cèdent la place à celles de la page. */}
      <ChoixDeLaPorte onChoisir={onChoisir} onSeConnecter={onSeConnecter} />
    </View>
  );
}
