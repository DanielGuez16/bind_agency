/**
 * La barre latérale de bureau, qui remplace la barre d'onglets au-delà de 900.
 *
 * **Ce n'est pas la barre du bas couchée sur le flanc.** Une barre d'onglets
 * mobile reprise en bas d'un écran de bureau est ce que la campagne de test a
 * relevé en premier : cinq libellés minuscules collés au bord inférieur d'un
 * écran de 1500, à un mètre des yeux. La barre latérale porte ce que le bas ne
 * pouvait pas — la marque, le contexte, et le nom de la personne ou du commerce.
 *
 * **Le repli est un choix, pas une conséquence.** Le rail de 72 s'obtient en le
 * demandant, et la préférence est retenue par appareil. Se replier tout seul en
 * dessous d'une largeur ferait sauter la mise en page pendant qu'on
 * redimensionne, sans que rien ne dise ce qui la commande.
 *
 * **La ligne active porte deux marques, jamais la couleur seule.** Un fond
 * `accent.subtle` et une barre gauche de 3 points : la couleur seule disparaît
 * pour qui ne la distingue pas, et l'écran courant est précisément ce qu'on ne
 * peut pas se permettre de perdre.
 *
 * **Le rôle se lit à la matière de la barre, plus à une teinte.** La v1.0
 * supprime `role.creator` et `role.merchant` : une seule teinte de marque ne
 * peut plus distinguer deux rôles, et une teinte de rôle ne servait de toute
 * façon qu'à nous — un rôle ne coexiste jamais avec un autre dans une session,
 * et personne n'a besoin de reconnaître le sien à une couleur.
 *
 * L'arbitrage rendu est celui du §8 de la passation : la distinction est
 * gardée, **en matière**. Encre pour l'administration, os pour le commerce,
 * papier pour le créateur. Trois fonds qui existent déjà dans le système, et
 * aucune couleur de plus à décoder. Une capture d'écran dit donc encore d'où
 * elle vient, ce qui était le seul coût de la suppression pure.
 *
 * **Le nom sous la marque reste**, en `ink.mute` — ou sa nuance claire sur
 * l'encre de l'administration. Il est plus explicite qu'une teinte, et c'est
 * lui qui situe la session.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, ScrollView, View } from 'react-native';

import { Icone } from '../components';
import { Marque } from '../components/Logo';
import { Texte } from '../components/Texte';
import { useI18n } from '../i18n';
import { breakpoint, radius, spacing, useColors, useTheme } from '../theme';
import { useRepli } from './preferenceDeRepli';

/** La hauteur d'une ligne de navigation. L'administration est plus dense. */
const HAUTEUR_DE_LIGNE = { creator: 44, merchant: 44, admin: 38 } as const;

export type ContexteDeBarre = {
  /** Le nom du commerce, ou celui de la personne. Ce qui situe la session. */
  intitule?: string | null;
};

export function BarreLaterale({
  state,
  descriptors,
  navigation,
  intitule,
}: BottomTabBarProps & ContexteDeBarre) {
  const c = useColors();
  const { role, matiere } = useTheme();
  const { t } = useI18n();
  const [replie, basculer] = useRepli();

  const largeur = replie
    ? breakpoint.sidebarRailWidth
    : breakpoint.sidebarWidth;
  const hauteur = HAUTEUR_DE_LIGNE[role];

  return (
    <View
      testID='barre-laterale'
      accessibilityRole='tablist'
      style={{
        width: largeur,
        // La matière du rôle, et rien d'autre : encre, os ou papier.
        backgroundColor: c[matiere.surface],
        borderRightWidth: 1,
        borderRightColor: c[matiere.ligne],
        paddingVertical: spacing['space.4'],
      }}
    >
      <View
        style={{
          paddingHorizontal: replie ? spacing['space.3'] : spacing['space.4'],
          gap: spacing['space.1'],
          marginBottom: spacing['space.5'],
        }}
      >
        {/* Replié, le signe suffit : la passation ne fait accompagner le nom
            que sur l'accueil et la connexion. */}
        {replie ? (
          <Icone nom='etincelle' couleur={matiere.texte} />
        ) : (
          // Le sigle est monochrome, et d'une seule couleur par occurrence :
          // l'encre de la matière sur laquelle il est posé.
          <Marque taille={26} couleur={matiere.texte} />
        )}
        {!replie && intitule ? (
          <Texte
            variante='type.caption'
            couleur={matiere.texteSourd}
            ellipseSurNomPropre
          >
            {intitule}
          </Texte>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 2 }}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const actif = state.index === index;
          const libelle = options.title ?? route.name;

          return (
            <Pressable
              key={route.key}
              testID={`ligne-${route.name}`}
              accessibilityRole='tab'
              accessibilityState={{ selected: actif }}
              // Replié, le libellé n'est plus à l'écran : il doit rester dans
              // l'arbre d'accessibilité, sans quoi le rail devient une colonne
              // de pictogrammes muets pour un lecteur d'écran.
              accessibilityLabel={libelle}
              onPress={() => {
                const evenement = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!actif && !evenement.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={{
                height: hauteur,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing['space.3'],
                marginHorizontal: spacing['space.2'],
                paddingLeft: replie ? 0 : spacing['space.3'],
                justifyContent: replie ? 'center' : 'flex-start',
                borderRadius: radius['radius.none'],
                // `brand.50` est une nappe orange très claire : elle se lit
                // sur le papier et sur l'os, et disparaît sur l'encre de
                // l'administration, où c'est le contraire qui marque — un cran
                // plus clair que le fond.
                backgroundColor: actif
                  ? c[matiere.surface === 'bg.inverse' ? 'line.onDark' : 'brand.50']
                  : 'transparent',
                // Deux marques et non une : le fond, et cette barre. La couleur
                // seule ne dit rien à qui ne la distingue pas. Et la barre est
                // en `brand.500` — c'est une surface de 3 px, pas une encre.
                borderLeftWidth: 3,
                borderLeftColor: actif ? c['brand.500'] : 'transparent',
              }}
            >
              {options.tabBarIcon?.({
                focused: actif,
                color: actif
                  ? c[matiere.surface === 'bg.inverse' ? matiere.texte : 'brand.700']
                  : c[matiere.texteSourd],
                size: 24,
              })}
              {replie ? null : (
                <Texte
                  variante='type.label'
                  couleur={actif ? matiere.texte : matiere.texteSourd}
                  ellipseSurNomPropre
                >
                  {libelle}
                </Texte>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        testID='basculer-le-repli'
        accessibilityRole='button'
        accessibilityLabel={t(replie ? 'coquille.deplier' : 'coquille.replier')}
        onPress={basculer}
        style={{
          height: hauteur,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing['space.3'],
          marginHorizontal: spacing['space.2'],
          paddingLeft: replie ? 0 : spacing['space.3'],
          justifyContent: replie ? 'center' : 'flex-start',
        }}
      >
        {/* Un seul chevron dans le jeu d'icônes, tourné vers la droite. Le
            retourner vaut mieux que d'en ajouter un second à traduire
            visuellement — et une rotation statique n'anime rien. */}
        <View style={{ transform: [{ rotate: replie ? '0deg' : '180deg' }] }}>
          <Icone nom='chevron' couleur={matiere.texteSourd} />
        </View>
        {replie ? null : (
          <Texte variante='type.caption' couleur={matiere.texteSourd}>
            {t('coquille.replier')}
          </Texte>
        )}
      </Pressable>
    </View>
  );
}
