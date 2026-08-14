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
import { breakpoint, spacing, useColors } from '../theme';

export type BarreDeTitreProps = {
  titre: string;
  /** Rendu tel quel — « il y a 2 h ». Jamais une date brute. */
  fraicheur?: string | null;
  onRetour?: () => void;
  /** Deux au plus. Au-delà, le nom de l'écran se noie. */
  actions?: ReactNode;
  testID?: string;
};

export function BarreDeTitre({
  titre,
  fraicheur,
  onRetour,
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
        height: breakpoint.topBarHeight,
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
          accessibilityLabel={t('common.retour')}
          hitSlop={12}
          onPress={onRetour}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Icone nom="retour" couleur="ink.soft" taille={18} />
        </Pressable>
      ) : null}

      <Texte variante="type.section" ellipseSurNomPropre style={{ flexShrink: 1 }}>
        {titre}
      </Texte>

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
