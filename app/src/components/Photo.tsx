/**
 * Une photo qui arrive sans pousser ce qu'on lisait.
 *
 * **Le défaut n'était pas la lenteur de l'image.** C'était que la carte
 * grandissait quand la photo arrivait, et poussait le texte qu'on était en
 * train de lire. Une image lente dans une place réservée se remarque à peine ;
 * une image rapide qui redimensionne sa carte fait sauter la liste entière.
 *
 * **La zone a donc sa hauteur définitive dès la première image**, et le fond
 * est un aplat `bg.deep` — pas un blanc, qui se confondrait avec la surface de
 * la carte et donnerait à croire qu'il n'y a rien à attendre.
 *
 * **Opacité seule, jamais d'échelle ni de translation.** Une photo qui glisse
 * ou qui grandit déplace le texte voisin dans le regard, ce qui est le défaut
 * qu'on répare. Le système n'autorise de toute façon que `opacity` et
 * `transform` sur le fil natif ; ici on n'utilise que la première.
 *
 * **Le fondu est aussi ce qui rend la règle des quatre cents millisecondes
 * vraie sur une image.** Une photo qui apparaît d'un coup est un clignotement,
 * quelle que soit sa vitesse — et le seuil ne peut rien pour elle, puisqu'on ne
 * sait pas d'avance combien de temps elle mettra.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, View, type ImageResizeMode, type StyleProp, type ViewStyle } from 'react-native';

import { motion, useColors } from '../theme';
import { useMouvementReduit } from './Mouvement';

export function Photo({
  uri,
  hauteur,
  cadrage = 'cover',
  style,
  testID,
  accessibiliteMasquee = false,
  replit,
}: {
  /** Nulle : la zone reste, et c'est le repli qui l'occupe. */
  uri: string | null | undefined;
  /**
   * La hauteur de la zone, **connue avant l'image**.
   *
   * C'est le cœur du composant : sans elle il n'y a pas de place réservée, et
   * la carte grandirait à l'arrivée de la photo. Elle est omise quand le parent
   * la fixe déjà — une vignette carrée, un fond absolu.
   */
  hauteur?: number;
  cadrage?: ImageResizeMode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Décorative : la nommer ferait annoncer « photo » avant le titre. */
  accessibiliteMasquee?: boolean;
  /** Ce qu'on montre à la place quand il n'y a pas de photo. */
  replit?: React.ReactNode;
}) {
  const c = useColors();
  const reduit = useMouvementReduit();
  const opacite = useRef(new Animated.Value(0)).current;
  const [chargee, setChargee] = useState(false);

  useEffect(() => {
    // Une nouvelle source repart de zéro : sans cela, une vignette recyclée par
    // une liste montrerait la photo précédente à pleine opacité pendant que la
    // suivante charge.
    opacite.setValue(0);
    setChargee(false);
  }, [uri, opacite]);

  useEffect(() => {
    if (!chargee) return;
    if (reduit) {
      opacite.setValue(1);
      return;
    }
    const animation = Animated.timing(opacite, {
      toValue: 1,
      duration: motion.fondu,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [chargee, opacite, reduit]);

  return (
    <View
      testID={testID}
      style={[
        {
          height: hauteur,
          // **L'aplat qui tient la place.** Il est visible avant la photo, et
          // reste derrière elle : une photo transparente ou plus étroite que sa
          // zone ne laisse pas voir la surface de la carte au travers.
          backgroundColor: c['bg.deep'],
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {uri ? (
        <Animated.View style={{ flex: 1, opacity: opacite }}>
          <Image
            source={{ uri }}
            resizeMode={cadrage}
            onLoad={() => setChargee(true)}
            // Une image qui échoue laisse l'aplat : mieux vaut une zone sourde
            // qu'un cadre brisé, et la carte n'a pas changé de taille.
            onError={() => setChargee(false)}
            style={{ width: '100%', height: '100%' }}
            accessibilityElementsHidden={accessibiliteMasquee}
            importantForAccessibility={accessibiliteMasquee ? 'no-hide-descendants' : 'auto'}
            testID={testID ? `${testID}-image` : undefined}
          />
        </Animated.View>
      ) : (
        replit ?? null
      )}
    </View>
  );
}
