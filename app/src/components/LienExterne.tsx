/**
 * Un lien qui quitte l'application — et qui en est vraiment un sur le web.
 *
 * **`Pressable` + `Linking.openURL` ne fait pas un lien, il fait un bouton qui
 * navigue.** Rendu par react-native-web, `accessibilityRole="link"` donne un
 * `<div role="link">` sans `href` : le clic marche, et rien d'autre. Pas de
 * clic-milieu, pas de ctrl-clic pour ouvrir dans un onglet, pas de « copier
 * l'adresse du lien », pas d'aperçu de la destination dans la barre d'état, et
 * `window.open` appelé hors d'un `<a>` reste à la merci d'un bloqueur de
 * fenêtres. Sur un écran d'administration dont le seul geste est « va voir ce
 * profil », c'est la moitié du geste qui manque.
 *
 * **Sur le web on rend donc l'ancre, sur natif on garde `Linking`.** RNW pose
 * l'attribut quand on lui donne `href` ; `Linking.openURL` reste la seule voie
 * là où il n'y a pas de document. Les deux branches portent le même rôle
 * d'accessibilité et le même libellé, pour qu'un lecteur d'écran entende la
 * même chose des deux côtés.
 *
 * **`rel="noopener noreferrer"` avec `target="_blank"`**, sans quoi la page
 * ouverte reçoit une référence à la nôtre par `window.opener`.
 */
import type { ReactNode } from 'react';
import { Linking, Platform, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

export type LienExterneProps = {
  /**
   * Où il mène. Absolu : ces liens sortent du produit.
   *
   * **`null` rend la même chose, sans le lien.** Trois appelants portaient déjà
   * cette branche à la main — une rangée d'annuaire sans compte rattaché, une
   * publication sans adresse, une ligne de journée sans profil — et tous
   * rendaient une vue au même style plutôt que rien. Un lien qui ne mène nulle
   * part se lit comme une panne ; ne pas en poser du tout est la bonne
   * réponse, et c'est ici qu'elle vit maintenant plutôt qu'en trois copies.
   */
  url: string | null;
  /** Ce que le lien montre. */
  children: ReactNode;
  /** Ce qu'un lecteur d'écran annonce à sa place. */
  accessibilityLabel?: string;
  /** Posé sur la surface cliquable, dans les deux branches. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Ce que RNW accepte et que les types de React Native ne décrivent pas.
 *
 * `href` et `hrefAttrs` sont des extensions du rendu web : les déclarer ici
 * plutôt que de museler le vérificateur garde l'erreur si l'un des deux change
 * de nom, ce qu'un `@ts-expect-error` aurait avalé.
 */
type ProprietesDAncre = {
  href?: string;
  hrefAttrs?: { target?: string; rel?: string; download?: boolean };
};

export function LienExterne({
  url,
  children,
  accessibilityLabel,
  style,
  testID,
}: LienExterneProps) {
  // Ni ancre ni bouton : la rangée garde sa forme et ne prétend rien ouvrir.
  if (url === null) {
    return (
      <View testID={testID} style={style}>
        {children}
      </View>
    );
  }

  if (Platform.OS === 'web') {
    const ancre: ProprietesDAncre = {
      href: url,
      hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' },
    };
    return (
      <View
        {...ancre}
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={style}
      >
        {children}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={() => void Linking.openURL(url)}
      testID={testID}
      style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}
    >
      {children}
    </Pressable>
  );
}
