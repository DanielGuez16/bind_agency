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
 * **Le rôle se lit une fois, sous la marque.** Sa couleur, et rien d'autre —
 * pas de bandeau, pas de pastille répétée à chaque ligne.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, ScrollView, View } from 'react-native';

import { Icone } from '../components';
import { Marque } from '../components/Logo';
import { Texte } from '../components/Texte';
import { useI18n } from '../i18n';
import {
  breakpoint,
  radius,
  spacing,
  useColors,
  useTheme,
  type ColorName,
} from '../theme';
import { useRepli } from './preferenceDeRepli';

/** La hauteur d'une ligne de navigation. L'administration est plus dense. */
const HAUTEUR_DE_LIGNE = { creator: 44, merchant: 44, admin: 38 } as const;

/** La couleur du nom sous la marque. L'administration n'a pas de teinte. */
const COULEUR_DU_ROLE: Record<string, ColorName> = {
  creator: 'role.creator',
  merchant: 'role.merchant',
  admin: 'text.secondary',
};

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
  const { role } = useTheme();
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
        backgroundColor: c['bg.surface'],
        borderRightWidth: 1,
        borderRightColor: c['border.subtle'],
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
          <Icone nom='etincelle' couleur='accent.default' />
        ) : (
          <Marque taille={26} />
        )}
        {!replie && intitule ? (
          <Texte
            variante='type.caption'
            couleur={COULEUR_DU_ROLE[role]}
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
                borderRadius: radius['radius.md'],
                backgroundColor: actif ? c['accent.subtle'] : 'transparent',
                // Deux marques et non une : le fond, et cette barre. La couleur
                // seule ne dit rien à qui ne la distingue pas.
                borderLeftWidth: 3,
                borderLeftColor: actif ? c['accent.default'] : 'transparent',
              }}
            >
              {options.tabBarIcon?.({
                focused: actif,
                color: actif ? c['accent.default'] : c['text.muted'],
                size: 24,
              })}
              {replie ? null : (
                <Texte
                  variante='type.label'
                  couleur={actif ? 'text.primary' : 'text.secondary'}
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
          <Icone nom='chevron' couleur='text.muted' />
        </View>
        {replie ? null : (
          <Texte variante='type.caption' couleur='text.muted'>
            {t('coquille.replier')}
          </Texte>
        )}
      </Pressable>
    </View>
  );
}
