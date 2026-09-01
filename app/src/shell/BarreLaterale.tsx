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
 *
 * **Replié, le libellé revient au survol.** Il était dans l'arbre
 * d'accessibilité et nulle part ailleurs : un lecteur d'écran savait lire le
 * rail, un œil devait deviner cinq pictogrammes. L'étiquette apparaît à droite
 * de la ligne, hors du rail, ce que la planche Desktop v0.6 demande depuis
 * qu'elle existe.
 *
 * **Au survol et au focus.** Le survol seul laisserait la navigation au clavier
 * devant les mêmes pictogrammes muets, et c'est le même manque déplacé. Ni l'un
 * ni l'autre n'existe au doigt, où le rail ne se replie de toute façon qu'à la
 * demande sur un appareil qui a un pointeur.
 */
import { useRef, useState } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, ScrollView, View } from 'react-native';

import { Icone } from '../components';
import { Marque } from '../components/Logo';
import { Texte } from '../components/Texte';
import { useI18n } from '../i18n';
import { breakpoint, radius, spacing, useColors, useTheme } from '../theme';
import { useRepli } from './preferenceDeRepli';
import { SelecteurDeSalon, type SalonAChoisir } from './SelecteurDeSalon';
import { indexAllume } from './ongletAllume';
import { etatAccessible } from '../components/etatAccessible';

/** La hauteur d'une ligne de navigation. L'administration est plus dense. */
const HAUTEUR_DE_LIGNE = { creator: 44, merchant: 44, admin: 38 } as const;

export type ContexteDeBarre = {
  /** Le nom du commerce, ou celui de la personne. Ce qui situe la session. */
  intitule?: string | null;
  /**
   * Les salons entre lesquels choisir, quand il y en a plus d'un.
   *
   * Vide ou à un seul élément, l'intitulé reste ce qu'il était : une ligne qui
   * situe la session. Un contrôle qui n'offre aucun choix occupe la place et
   * fait douter — c'est la règle du bouton qu'on retire plutôt que de griser.
   */
  salons?: readonly SalonAChoisir[];
  choisi?: string | null;
  onChoisir?: (id: string) => void;
};

export function BarreLaterale({
  state,
  descriptors,
  navigation,
  intitule,
  salons = [],
  choisi = null,
  onChoisir,
}: BottomTabBarProps & ContexteDeBarre) {
  const c = useColors();
  const { role, matiere } = useTheme();
  const { t } = useI18n();
  const [replie, basculer] = useRepli();
  const [deplie, setDeplie] = useState(false);

  /**
   * **La caisse est le seul écran où le nom n'est pas un contrôle.**
   *
   * Pas grisé — la règle du produit l'interdit, un bouton grisé demande de
   * deviner ce qui le débloque. Simplement pas un contrôle : il n'a donc rien à
   * refuser. On ne change pas de salon en tenant un code ; on quitte la caisse,
   * on change, on revient. Un geste de plus, et c'est le but.
   *
   * **Servir un code du mauvais salon est la seule erreur de ce parcours qu'on
   * ne peut pas défaire** : elle consomme la réservation de quelqu'un d'autre,
   * et `consumed` est terminal. Le serveur la refuse — l'appartenance est
   * vérifiée sur la vérification comme sur la consommation, et deux tests le
   * prouvent en constatant que la réservation reste `confirmed`. L'écran ne
   * porte donc pas la protection ; il évite de proposer le geste qui la
   * déclencherait, ce qui n'est pas la même chose et se cumule.
   */
  const surLaCaisse = state.routes[state.index]?.name === 'caisse';
  const allume = indexAllume(state.routes, state.index, (route) => descriptors[route.key]?.options);
  const choisissable = salons.length > 1 && Boolean(onChoisir) && !surLaCaisse;
  /**
   * La ligne dont l'étiquette est visible, avec de quoi la placer.
   *
   * Une seule à la fois : deux étiquettes ouvertes se chevaucheraient, et le
   * pointeur comme le focus ne désignent jamais deux lignes ensemble.
   *
   * **`y` vient de la ligne, il ne se calcule pas.** Le déduire du rang et de
   * la hauteur marcherait jusqu'au jour où une ligne change de densité ou
   * qu'un séparateur s'ajoute, et l'étiquette désignerait alors la voisine.
   */
  const [designee, setDesignee] = useState<{
    cle: string;
    nom: string;
    libelle: string;
    y: number;
  } | null>(
    null,
  );
  const positions = useRef<Record<string, number>>({});
  /**
   * De combien la liste a défilé.
   *
   * L'étiquette vit **hors** du défileur : celui-ci rogne ce qui déborde à
   * droite, et une étiquette posée dans une ligne y serait coupée net. Elle est
   * donc placée dans la barre, ce qui oblige à retrancher le défilement — sans
   * quoi elle resterait où la ligne était.
   */
  const [defilement, setDefilement] = useState(0);
  const [hautDeLaListe, setHautDeLaListe] = useState(0);

  const largeur = replie
    ? breakpoint.sidebarRailWidth
    : breakpoint.sidebarWidth;
  const hauteur = HAUTEUR_DE_LIGNE[role];

  const designer = (cle: string, nom: string, libelle: string) =>
    setDesignee({ cle, nom, libelle, y: positions.current[cle] ?? 0 });
  // On n'efface que ce qu'on avait posé : le pointeur quitte une ligne après
  // être entré dans la suivante, et effacer sans regarder laquelle ferait
  // disparaître l'étiquette qui venait d'apparaître.
  const oublier = (cle: string) => setDesignee((posee) => (posee?.cle === cle ? null : posee));

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
        // La barre est rendue avant le contenu dans la rangée de la coquille :
        // sans ce cran, l'étiquette du rail replié, qui déborde à droite,
        // passerait sous l'écran plutôt que dessus.
        zIndex: 1,
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
          // Les lettres suivent la matière de la coquille — encre sur os et
          // papier, blanc sur l'encre de l'administration. Le point reste
          // orange dans les deux cas : c'est la seule couleur du logotype.
          <Marque taille={15} variante={matiere.surface === 'bg.inverse' ? 'blanc' : 'encre'} />
        )}
        {/* **Le nom devient une porte quand il y a un choix derrière.** Avec
            un seul salon il reste ce qu'il a toujours été : une ligne qui situe
            la session, et rien à presser. La liste se déplie sous lui plutôt
            que d'ouvrir un écran — c'est ici qu'on lit le nom, c'est ici qu'on
            en change. */}
        {!replie && intitule ? (
          choisissable ? (
            <Pressable
              accessibilityRole="button"
              {...etatAccessible({ expanded: deplie })}
              onPress={() => setDeplie((ouvert) => !ouvert)}
              testID="changer-de-salon"
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 32,
              })}
            >
              <Texte variante='type.caption' couleur={matiere.texteSourd} ellipseSurNomPropre>
                {intitule}
              </Texte>
              {/* Un seul chevron dans le système, tourné : il n'y a pas de
                  variante haut/bas, et en inventer une pour un état ouvert
                  ajouterait un glyphe qu'aucun autre écran ne partagerait. */}
              <View style={{ transform: [{ rotate: deplie ? '-90deg' : '90deg' }] }}>
                <Icone nom="chevron" couleur={matiere.texteSourd} taille={14} />
              </View>
            </Pressable>
          ) : (
            <Texte
              variante='type.caption'
              couleur={matiere.texteSourd}
              ellipseSurNomPropre
            >
              {intitule}
            </Texte>
          )
        ) : null}
      </View>

      {!replie && choisissable && deplie ? (
        <View style={{ paddingHorizontal: spacing['space.2'], paddingBottom: spacing['space.3'] }}>
          <SelecteurDeSalon
            commerces={salons}
            choisi={choisi}
            onChoisir={(id) => {
              onChoisir?.(id);
              setDeplie(false);
            }}
            testID="selecteur-de-salon-barre"
          />
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 2 }}
        onLayout={(evenement) => setHautDeLaListe(evenement.nativeEvent.layout.y)}
        onScroll={(evenement) => setDefilement(evenement.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          // **Allumé par le groupeur, pas par la seule route focalisée.** La
          // barre latérale montre tout aujourd'hui, donc les deux coïncident ;
          // la règle est ici quand même pour que l'ajout d'un écran masqué ne
          // l'éteigne pas en silence, comme cela s'est produit en bas.
          const actif = allume === index;
          const libelle = options.title ?? route.name;

          return (
            <Pressable
              key={route.key}
              testID={`ligne-${route.name}`}
              accessibilityRole='tab'
              {...etatAccessible({ selected: actif })}
              // Replié, le libellé n'est plus à l'écran : il doit rester dans
              // l'arbre d'accessibilité, sans quoi le rail devient une colonne
              // de pictogrammes muets pour un lecteur d'écran.
              accessibilityLabel={libelle}
              // Les quatre ensemble, et jamais le survol seul : le clavier
              // traverse le même rail et rencontrerait les mêmes pictogrammes.
              //
              // **`onPointerEnter` et non `onHoverIn`.** Les deux existent et
              // décrivent le même geste, mais `Pressable` retient `onHoverIn`
              // pour sa propre mécanique de pression et ne le repose pas sur la
              // vue : aucun test ne peut l'atteindre, donc rien n'aurait dit
              // que l'étiquette ne s'ouvre pas. Les événements de pointeur, eux,
              // traversent jusqu'à l'hôte — vérifié avant d'écrire la ligne, et
              // c'est ce qui rend le test possible.
              onLayout={(evenement) => {
                positions.current[route.key] = evenement.nativeEvent.layout.y;
              }}
              onPointerEnter={() => designer(route.key, route.name, libelle)}
              onPointerLeave={() => oublier(route.key)}
              onFocus={() => designer(route.key, route.name, libelle)}
              onBlur={() => oublier(route.key)}
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
              style={({ pressed }) => ({
                height: hauteur,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing['space.3'],
                marginHorizontal: spacing['space.2'],
                paddingLeft: replie ? 0 : spacing['space.3'],
                justifyContent: replie ? 'center' : 'flex-start',
                borderRadius: radius['radius.md'],
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
          opacity: pressed ? 0.7 : 1,
        })}
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

      {/* **L'étiquette sort du rail**, et elle sort aussi du défileur.
          Soixante-douze points ne portent pas « Bookings » : la loger dedans
          redonnerait le pictogramme muet sous une autre forme. Et posée dans
          une ligne, elle serait rognée net par le défileur, qui coupe ce qui
          déborde à droite — ce qu'aucun test de rendu ne voit, et qu'on ne
          découvrirait que dans un vrai navigateur.

          Elle ne reçoit pas le pointeur : sans quoi elle se mettrait entre lui
          et la ligne qui l'a fait naître, et clignoterait. Et elle est cachée
          des lecteurs d'écran — le libellé y est déjà, sur la ligne, et
          l'annoncer deux fois est une gêne, pas un service. */}
      {replie && designee ? (
        <View
          testID={`etiquette-${designee.nom}`}
          pointerEvents='none'
          accessibilityElementsHidden
          importantForAccessibility='no-hide-descendants'
          style={{
            position: 'absolute',
            left: largeur + spacing['space.2'],
            top: hautDeLaListe + designee.y - defilement,
            height: hauteur,
            justifyContent: 'center',
            paddingHorizontal: spacing['space.3'],
            backgroundColor: c['bg.inverse'],
            borderRadius: radius['radius.md'],
            // La barre est rendue avant le contenu dans la rangée de la
            // coquille : sans cela, l'étiquette passerait dessous.
            zIndex: 1,
          }}
        >
          <Texte variante='type.label' couleur='ink.onDark'>
            {designee.libelle}
          </Texte>
        </View>
      ) : null}

      <Pressable
        testID='basculer-le-repli'
        accessibilityRole='button'
        accessibilityLabel={t(replie ? 'coquille.deplier' : 'coquille.replier')}
        onPress={basculer}
        style={({ pressed }) => ({
          height: hauteur,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing['space.3'],
          marginHorizontal: spacing['space.2'],
          paddingLeft: replie ? 0 : spacing['space.3'],
          justifyContent: replie ? 'center' : 'flex-start',
          opacity: pressed ? 0.7 : 1,
        })}
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
