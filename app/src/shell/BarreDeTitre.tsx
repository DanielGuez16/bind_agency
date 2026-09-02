/**
 * La barre de titre de bureau : 56 points, fixes, au-dessus du contenu.
 *
 * **Le retour cesse de défiler.** Il vivait dans le flux, en haut du contenu :
 * dès qu'on descendait de trois lignes il quittait l'écran, et sur le web —
 * où il n'y a ni geste de balayage ni bouton système — on ne sortait plus de
 * l'écran qu'en changeant d'onglet. Une barre fixe le garde à sa place, qui est
 * la même partout.
 *
 * **Deux actions au plus.** La passation le borne, et la raison tient à ce que
 * la barre est aussi le seul repère de position : une rangée de boutons y noie
 * le nom de l'écran, qui est ce qu'on vient y lire.
 *
 * **La fraîcheur se dit ici.** Elle appartient à l'écran entier, pas à un bloc
 * de contenu ; la poser à côté du titre évite de la répéter par carte, et de la
 * perdre quand la première carte est vide.
 *
 * En compact, cette barre n'existe pas : le titre reste dans le flux, où il a la
 * place de respirer, et le retour garde sa forme en ligne.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icone } from '../components';
import { Texte } from '../components/Texte';
import { useI18n } from '../i18n';
import { breakpoint, size, spacing, useColors } from '../theme';

export type BarreDeTitreProps = {
  titre: string;
  /**
   * La seconde ligne, sous le titre.
   *
   * **Elle existe pour que le titre puisse cesser de nommer l'écran.** La
   * journée du commerce s'appelait « Aujourd'hui » et listait des heures : un
   * inventaire, dont la revue a dit « on ne comprend même pas à quoi sert cette
   * page ». Le titre compte maintenant ce qui attend une réponse ; le jour et
   * les horaires, qui étaient tout ce que la barre disait, descendent ici — ils
   * situent, ils ne convoquent pas.
   */
  sousTitre?: string | null;
  /** Rendu tel quel — « il y a 2 h ». Jamais une date brute. */
  fraicheur?: string | null;
  onRetour?: () => void;
  /**
   * Le nom de l'endroit où le retour ramène.
   *
   * Absent, le glyphe reste seul — c'est le cas d'une pile où l'on sait d'où
   * l'on vient parce qu'on vient d'y être. Il se nomme quand la sous-page est
   * atteinte depuis un menu, où le retour ramène ailleurs que dans le fil de
   * lecture.
   */
  retourVers?: string;
  /** Deux au plus. Au-delà, le nom de l'écran se noie. */
  actions?: ReactNode;
  testID?: string;
};

export function BarreDeTitre({
  titre,
  sousTitre,
  fraicheur,
  onRetour,
  retourVers,
  actions,
  testID = 'barre-de-titre',
}: BarreDeTitreProps) {
  const c = useColors();
  const { t } = useI18n();

  return (
    <View
      testID={testID}
      accessibilityRole="header"
      style={{
        // **La barre grandit avec sa seconde ligne, elle ne la comprime pas.**
        // Deux lignes dans 56 points obligeraient à rogner l'interligne du
        // titre, et un titre resserré se lit comme une étiquette.
        minHeight: breakpoint.topBarHeight,
        paddingVertical: sousTitre ? spacing['space.2'] : 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing['space.3'],
        paddingHorizontal: spacing['space.5'],
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
        backgroundColor: c['bg.page'],
      }}
    >
      {onRetour ? (
        <Pressable
          testID="retour"
          accessibilityRole="button"
          // **La destination reste dans l'annonce, elle quitte l'écran.**
          // « Back » dit qu'on peut revenir sans dire où ; le nom répondait à
          // cette seconde question, et le répétait sur chaque sous-page d'un
          // menu qu'on venait de quitter. La flèche le dit déjà à qui voit
          // l'écran — elle ne le dit pas à qui l'écoute, donc le libellé
          // accessible garde la destination.
          accessibilityLabel={retourVers ?? t('common.retour')}
          hitSlop={12}
          onPress={onRetour}
          style={({ pressed }) => ({
            // **La cible ne rétrécit pas avec le libellé.** La flèche seule
            // fait 18 points ; c'est la zone qui doit rester atteignable, pas
            // le glyphe qui doit grossir.
            minWidth: size.touchMin,
            minHeight: size.touchMin,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: -spacing['space.3'],
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icone nom="retour" couleur="ink.soft" taille={18} />
        </Pressable>
      ) : null}

      <View style={{ flexShrink: 1, gap: 2 }}>
        <Texte variante="type.section" ellipseSurNomPropre>
          {titre}
        </Texte>
        {sousTitre ? (
          <Texte variante="type.caption" couleur="ink.mute" testID="sous-titre">
            {sousTitre}
          </Texte>
        ) : null}
      </View>

      {fraicheur ? (
        <Texte variante="type.caption" couleur="ink.mute" testID="fraicheur">
          {fraicheur}
        </Texte>
      ) : null}

      <View style={{ flex: 1 }} />
      {actions}
    </View>
  );
}
