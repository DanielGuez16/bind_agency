/**
 * La navigation : trois arbres, un par rôle.
 *
 * **Chaque rôle n'a que ses onglets.** Ce n'est pas une garantie de sécurité —
 * l'API refuse, et c'est elle qui décide — mais une garantie de lisibilité :
 * un créateur ne doit pas voir un onglet « caisse » qu'il ne pourra pas
 * ouvrir. Un onglet qui répond 403 est pire qu'un onglet absent.
 *
 * **Les écrans qui prennent des paramètres vivent dans une pile.** Une fiche de
 * commerce a besoin d'un identifiant, un écran de créneaux d'une offre : ils ne
 * peuvent pas être des onglets, ils s'ouvrent depuis celui qui les a produits.
 * C'est aussi ce qui donne le bouton retour sans l'écrire.
 *
 * **Le commerce choisit son commerce une fois.** Les écrans commerce prennent
 * tous un `businessId`, et le demander à chaque écran obligerait à le porter
 * partout. Il est lu une fois au montage, depuis l'appartenance de
 * l'utilisateur — et tant qu'il n'y en a pas, l'onglet dit quoi faire plutôt
 * que d'afficher une erreur.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  NavigationContainer,
  DefaultTheme,
  useNavigationContainerRef,
  type Theme,
} from '@react-navigation/native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { FichePublique, OffreDeLaFiche, PalierAccessible, RepriseOuverte } from '../api';
import { useApi } from '../api';
import { Button, Icone, StatusMessage, Texte, type NomIcone } from '../components';
import { formatDateTime } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { size, useColors, useTheme } from '../theme';
import { AbonnementScreen } from '../screens/AbonnementScreen';
import { AnnuaireScreen } from '../screens/AnnuaireScreen';
import { CreatriceScreen } from '../screens/CreatriceScreen';
import { ArbitrageScreen } from '../screens/ArbitrageScreen';
import { AudienceScreen } from '../screens/AudienceScreen';
import { FavorisScreen } from '../screens/FavorisScreen';
import { FiabiliteScreen } from '../screens/FiabiliteScreen';
import { CodeScreen } from '../screens/CodeScreen';
import { presentationAuComptoir } from './presentationAuComptoir';
import { CreneauxScreen } from '../screens/CreneauxScreen';
import { FicheScreen } from '../screens/FicheScreen';
import { FilScreen } from '../screens/FilScreen';
import { HistoriqueScreen, destination } from '../screens/HistoriqueScreen';
import { JourneeScreen } from '../screens/JourneeScreen';
import { PaliersScreen, RAYON_DES_PALIERS_KM } from '../screens/PaliersScreen';
import { PrestationsDuPalierScreen } from '../screens/PrestationsDuPalierScreen';
import { ReglesScreen } from '../screens/ReglesScreen';
import { PlansScreen } from '../screens/PlansScreen';
import { CommercesScreen } from '../screens/CommercesScreen';
import { CreateursAdminScreen } from '../screens/CreateursAdminScreen';
import { TerrainScreen } from '../screens/TerrainScreen';
import { PreuveScreen } from '../screens/PreuveScreen';
import { MesPublicationsScreen } from '../screens/MesPublicationsScreen';
import { ProfilScreen } from '../screens/ProfilScreen';
import { PublicationsScreen } from '../screens/PublicationsScreen';
import { CatalogueScreen } from '../screens/CatalogueScreen';
import { HorairesScreen } from '../screens/HorairesScreen';
import { LieuScreen } from '../screens/LieuScreen';
import { MenuDuCommerce } from '../screens/MenuDuCommerce';
import { CameraScanner } from '../screens/CameraScanner';
import { RedemptionScreen } from '../screens/RedemptionScreen';
import { ReglagesScreen } from '../screens/ReglagesScreen';
import { ReportingScreen } from '../screens/ReportingScreen';
import { BarreLaterale, type ContexteDeBarre } from './BarreLaterale';
import { indexAllume } from './ongletAllume';
import { useGabarit } from './gabarit';
import { usePosition } from './usePosition';
import { CommerceProvider, useMonCommerce } from './useMonCommerce';
import { nomDeLEcran } from '../screens/reprise/portee';

// --------------------------------------------------------------------------
// paramètres
// --------------------------------------------------------------------------

/** La découverte : du fil jusqu'au choix d'un créneau. */
export type PileCreateurParams = {
  Fil: undefined;
  Fiche: { businessId: string };
  Creneaux: { fiche: FichePublique; offre: OffreDeLaFiche };
  /**
   * **L'explication, ouverte depuis le fil.** Les paliers étaient un onglet ;
   * ils répondaient à une question qu'on ne se pose pas en ouvrant
   * l'application. Ce qu'on veut savoir, c'est ce qu'on peut réserver — le fil
   * répond, et les paliers expliquent pourquoi. Une pile, donc : l'écran naît
   * d'une ligne du fil et y revient.
   */
  Paliers: undefined;
  /**
   * **Ce que le cœur ouvre.** Même raison que les paliers : le geste naît sur
   * une carte du mur, et la liste explique ce geste. Un onglet la rangerait
   * loin de la question — et la barre du bas en a trois, pas quatre.
   */
  Favoris: undefined;
  /**
   * Les prestations d'un palier. Le palier voyage en paramètre plutôt que
   * d'être relu : l'écran d'où l'on vient l'a déjà, et le redemander ferait
   * deux vérités sur ce qu'il ouvre.
   */
  PrestationsDuPalier: { palier: PalierAccessible };
  Regles: undefined;
};

/**
 * Les réservations, et ce qui en découle.
 *
 * **Le code et la preuve vivent ici, pas dans la découverte.** Ils avaient été
 * empilés sur le fil parce que c'est de là qu'on réserve ; le code s'affichait
 * donc à l'intérieur de l'onglet « à proximité », qui n'a rien à voir avec une
 * réservation déjà prise. Ils appartiennent à la réservation, et la
 * confirmation bascule d'onglet.
 */
export type PileReservationsParams = {
  /**
   * `onglet` : la clé de l'onglet sur lequel s'ouvrir, quand on arrive
   * d'ailleurs. Absente, l'écran garde son défaut.
   */
  Historique: { onglet?: string } | undefined;
  Code: { bookingId: string };
  Preuve: { collaborationId: string };
};

/**
 * L'audience, et le score en détail.
 *
 * **Une pile pour un seul détail, et c'est la planche v3 qui l'impose.** Le
 * score passe en deux niveaux : son chiffre et sa conséquence sur l'écran,
 * sa mécanique et ses deux garanties derrière un chevron. Un bloc qui répétait
 * le détail sur place faisait de la fiabilité le troisième sujet d'un écran qui
 * en a déjà deux.
 */
export type PileAudienceParams = {
  Profil: undefined;
  Audience: undefined;
  MesPublications: undefined;
  /**
   * Les favoris, seconde porte.
   *
   * Le nom diffère de celui de la pile du fil : deux écrans du même nom dans
   * deux piles se confondent au retour, et l'un se retrouve empilé sur l'autre.
   */
  FavorisDuProfil: undefined;
  Reglages: undefined;
  Fiabilite: undefined;
};

export type PileCommerceParams = {
  Journee: { businessId: string };
  Caisse: undefined;
};

/** La composition du commerce : ce qu'il offre, quand, et à quel palier. */
/**
 * L'annuaire, et l'abonnement qu'il réclame.
 *
 * **Une pile pour donner une issue au refus.** L'annuaire interceptait le 402 et
 * expliquait qu'un abonnement manque, puis s'arrêtait là : c'est ce que BIND
 * vend, et le seul endroit où un commerce le rencontre. L'abonnement s'y empile
 * plutôt que d'ouvrir un huitième onglet — la barre du commerce en compte déjà
 * deux de plus que ce que le système recommande.
 */
export type PileReglagesParams = {
  Reglages: undefined;
  Abonnement: undefined;
};

export type PileAnnuaireParams = {
  Annuaire: undefined;
  Abonnement: undefined;
  /** La fiche d'une créatrice, où la rangée de l'annuaire mène. */
  Creatrice: { creatorId: string };
};

export type PileConfigurationParams = {
  Configuration: undefined;
  Catalogue: undefined;
  Horaires: undefined;
};

const PileCreateur = createNativeStackNavigator<PileCreateurParams>();
const PileReservations = createNativeStackNavigator<PileReservationsParams>();
const PileCommerce = createNativeStackNavigator<PileCommerceParams>();
const PileConfiguration = createNativeStackNavigator<PileConfigurationParams>();
const PileAudience = createNativeStackNavigator<PileAudienceParams>();
const PileAnnuaire = createNativeStackNavigator<PileAnnuaireParams>();
const PileReglages = createNativeStackNavigator<PileReglagesParams>();
const Onglets = createBottomTabNavigator();

/**
 * Les options communes à toutes les barres d'onglets.
 *
 * **La barre porte elle-même la marge du bas.** `ZoneSure` applique le haut et
 * les côtés ; le bas ne peut pas venir de là, parce que la barre est collée au
 * bord et que la remonter laisserait une bande de fond sous elle. Sans cette
 * marge, l'indicateur d'accueil de l'iPhone recouvrait la moitié des libellés :
 * « Nearby » se lisait « Nearbv ».
 *
 * **Une hauteur explicite.** La hauteur par défaut est calculée avant que les
 * marges soient connues, et ne se met pas à jour ensuite.
 */
/**
 * La barre latérale, à passer au **navigateur** et non aux options d'écran.
 *
 * `tabBar` est une propriété de `Navigator`. Rangée dans `screenOptions`, elle
 * est ignorée sans un mot : la barre latérale n'était jamais montée, et comme
 * la barre du bas était masquée par ailleurs, il ne restait aucune navigation.
 */
function useBarreLaterale(intitule?: string | null, salon?: ContexteDeBarre) {
  const { large } = useGabarit();
  if (!large) return BarreDuBas;
  return (props: BottomTabBarProps) => (
    <BarreLaterale {...props} intitule={intitule} {...salon} />
  );
}

/**
 * La barre du bas de la bibliothèque, avec l'onglet allumé par son groupeur.
 *
 * **C'est ici que le défaut se voyait.** Les écrans rangés sous « More » sont
 * des onglets masqués : la bibliothèque allume par index, l'index focalisé
 * désignait un onglet qu'elle ne dessine pas, et la barre n'allumait donc plus
 * rien. Sur « Your place », les quatre pastilles étaient éteintes.
 *
 * **Un état réécrit plutôt qu'une barre réécrite.** Refaire le rendu pour
 * changer une comparaison aurait recopié la disposition, les pastilles, les
 * marges sûres et l'accessibilité — quatre choses justes qu'on n'a aucune
 * raison de reprendre. On ne change que ce qui décide.
 */
function BarreDuBas(props: BottomTabBarProps) {
  const allume = indexAllume(
    props.state.routes,
    props.state.index,
    (route) => props.descriptors[route.key]?.options,
  );
  return <BottomTabBar {...props} state={{ ...props.state, index: allume }} />;
}

function useOptionsDOnglets(intitule?: string | null) {
  const marges = useSafeAreaInsets();
  const { color: c } = useTheme();
  const { large } = useGabarit();

  return {
    headerShown: false,
    // Au-delà du seuil, la barre du bas cède la place à la barre latérale.
    // `tabBarPosition` déplace la boîte, `tabBar` en remplace le contenu : il
    // faut les deux, sinon la barre latérale s'afficherait couchée en bas.
    tabBarPosition: large ? ('left' as const) : ('bottom' as const),
    // Un fondu entre onglets. Sans lui, le changement est une coupe franche :
    // rien ne relie l'écran qu'on quitte à celui qui arrive, et sur cinq
    // onglets on ne sait plus lequel on vient de toucher.
    animation: 'fade' as const,
    // Ce style ne vaut que pour la barre du bas. En grand, `tabBar` la
    // remplace entièrement et il est ignoré : le conditionner ferait croire
    // qu'il pilote quelque chose là-haut.
    tabBarStyle: {
      // La hauteur se compose : le contenu, puis la marge système. Fixer une
      // hauteur *et* des marges intérieures écrase le libellé — la boîte tient
      // dans la barre, mais le texte déborde sous sa ligne de base, ce qui ne
      // se voit qu'à l'œil et jamais dans une mesure de mise en page.
      height: HAUTEUR_BARRE + marges.bottom,
      paddingTop: 6,
      paddingBottom: marges.bottom + 6,
      backgroundColor: c['bg.surface'],
      borderTopColor: c['line.default'],
      borderTopWidth: 1,
    },
    tabBarLabelStyle: { fontSize: 11, lineHeight: 15, marginTop: 4 },
    tabBarActiveTintColor: c['brand.700'],
    tabBarInactiveTintColor: c['ink.mute'],
  } as const;
}

/**
 * La barre, hors marge système.
 *
 * Mesurée à l'écran, pas déduite : 24 points d'icône, l'écart, le libellé sur
 * sa ligne, et les marges. Cinquante-huit rognait la dernière ligne de pixels
 * des libellés — assez pour transformer « Nearby » en « Nearbv », pas assez
 * pour que la cause saute aux yeux, et invisible dans une mesure de boîte : la
 * boîte du libellé tenait, son texte non.
 */
const HAUTEUR_BARRE = 74;

/**
 * Les options communes aux piles.
 *
 * **Un glissement horizontal, et un retour au geste.** Les écrans
 * apparaissaient sans transition : rien ne disait qu'on entrait dans un détail
 * plutôt que de changer d'onglet, et le retour ne s'offrait que par le bouton
 * système. `gestureEnabled` rend le glissement depuis le bord, qui est le
 * retour que tout le monde essaie d'abord.
 */
const OPTIONS_DE_PILE = {
  headerShown: false,
  animation: 'slide_from_right',
  gestureEnabled: true,
} as const;

/**
 * Les options d'un onglet : son libellé et son icône.
 *
 * Sans `tabBarIcon`, la barre affiche le caractère de repli de la
 * bibliothèque — cinq flèches identiques, qui ne distinguent rien. L'icône est
 * ici et pas dans l'écran : c'est une propriété de la navigation.
 */
function onglet(titre: string, icone: NomIcone, compte?: number) {
  return {
    title: titre,
    tabBarIcon: ({ color }: { color: string }) => <IconeDOnglet nom={icone} actif={color} />,
    // **Le compte est ce qui justifie la place d'un onglet.** Un onglet sans
    // compte n'appelle jamais : il attend qu'on pense à lui. Zéro ne se rend
    // pas — une pastille à zéro dit « rien » en occupant la place de « quelque
    // chose », et on apprend à ne plus la regarder.
    tabBarBadge: compte && compte > 0 ? compte : undefined,
  };
}

/**
 * Un écran joignable, mais pas depuis la barre.
 *
 * Il reste une destination à part entière — la navigation y mène, l'adresse
 * web fonctionne — il ne prend simplement pas un quart de la barre du bas. Sur
 * un téléphone, c'est ce qui sépare les quatre écrans du quotidien des quatre
 * qu'on ouvre deux fois par mois.
 */
function ongletHorsBarre(titre: string, icone: NomIcone) {
  return { ...onglet(titre, icone), tabBarItemStyle: { display: 'none' as const } };
}

/**
 * L'icône, teintée par l'état de l'onglet.
 *
 * La bibliothèque donne la couleur ; on ne la traduit pas en jeton, parce
 * qu'elle vient déjà du thème de navigation, lui-même construit sur nos
 * jetons. La reprendre ici créerait une seconde source.
 */
function IconeDOnglet({ nom, actif }: { nom: NomIcone; actif: string }) {
  return <Icone nom={nom} teinte={actif} />;
}

// --------------------------------------------------------------------------
// créateur
// --------------------------------------------------------------------------

/**
 * Le parcours de découverte, du fil jusqu'au code de retrait.
 *
 * Une pile et non des onglets : chaque écran naît du précédent et en reçoit
 * quelque chose. Les mettre côte à côte demanderait de choisir un commerce
 * avant d'avoir vu le fil.
 */
function ParcoursCreateur({
  prenom,
  onReserve,
  onConnecterUnReseau,
  onVoirMonAudience,
  onVoirMesPaliers,
}: {
  prenom: string | null;
  onReserve: (bookingId: string) => void;
  onConnecterUnReseau: () => void;
  onVoirMonAudience: () => void;
  onVoirMesPaliers: () => void;
}) {
  const { position, etat, demander } = usePosition();

  /**
   * Combien de fois un cœur a basculé depuis l'ouverture de la pile.
   *
   * **Un signal, pas un compte.** Le fil sert le nombre de favoris, et il ne se
   * recharge pas de lui-même quand on revient d'une fiche : la pile garde
   * l'écran monté dessous. Ce compteur lui dit qu'il y a lieu de redemander —
   * il ne lui dit pas quoi, parce que deux vérités du même nombre finissent par
   * diverger et que c'est celle qu'on regarde le moins qui ment.
   *
   * **Il monte à l'appui, et non au démontage de la fiche.** La première
   * version attendait la sortie, pour n'envoyer qu'une requête par visite. Elle
   * ne marchait pas : sur le web, revenir en arrière ne démonte pas la fiche au
   * moment où on le croit, et le compte restait celui du dernier chargement —
   * trouvé par le parcours de bout en bout, invisible aux tests unitaires, qui
   * pilotent la version à la main. Une requête de fil par cœur pressé est le
   * prix, et il est modeste : elle part pendant qu'on est ailleurs, sur un
   * écran que rien ne redessine.
   *
   * Il vit ici et non dans le fil : c'est la pile qui relie les deux écrans, et
   * le fil ne sait rien de la fiche.
   */
  const [versionDesFavoris, setVersionDesFavoris] = useState(0);

  return (
    <PileCreateur.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileCreateur.Screen name="Fil">
        {({ navigation }) => (
          <FilScreen
            position={position}
            // Pourquoi il n'y a pas de position : un refus ne se redemande
            // pas, il se réactive, et l'écran doit dire où.
            etatDeLaPosition={etat}
            onConnecterUnReseau={onConnecterUnReseau}
            onVoirMonAudience={onVoirMonAudience}
            // Dans la pile, plus vers un onglet : c'est ce déplacement qui
            // fait de l'écran une explication au lieu d'une destination.
            onVoirMesPaliers={() => navigation.navigate('Paliers')}
            // **La liste vit dans la pile du fil**, comme les paliers : le cœur
            // se pose sur une carte du mur, et ce qu'il ouvre explique cette
            // carte. Un onglet de plus rangerait la réponse loin de la question.
            onVoirMesFavoris={() => navigation.navigate('Favoris')}
            onDemanderLaPosition={demander}
            onOuvrirLeCommerce={(businessId) => navigation.navigate('Fiche', { businessId })}
            versionDesFavoris={versionDesFavoris}
          />
        )}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Fiche">
        {({ navigation, route }) => (
          <FicheScreen
            businessId={route.params.businessId}
            // La position vient de la coquille, comme pour le fil et les
            // paliers : on lit d'où l'on est, pas d'où l'on habite.
            position={position}
            onRetour={() => navigation.goBack()}
            onReserver={(offre, fiche) => navigation.navigate('Creneaux', { fiche, offre })}
            onConnecterUnReseau={onConnecterUnReseau}
            // Le cœur a quitté le fil : il vit ici, ligne par ligne. Le fil
            // n'en garde que le compte, et redemande quand celui-ci a bougé.
            onFavoriBascule={() => setVersionDesFavoris((tour: number) => tour + 1)}
          />
        )}
      </PileCreateur.Screen>

      {/* **Les paliers s'ouvrent d'ici, et nulle part ailleurs.** L'écran
          explique le nombre que le fil annonce ; le sortir de cette pile le
          remettrait à distance de la question qu'il répond. */}
      {/* **Les favoris vivent dans la pile du fil**, comme les paliers. Le cœur
          se pose sur une carte du mur, et ce qu'il ouvre explique cette carte :
          un onglet de plus rangerait la réponse loin de la question. */}
      <PileCreateur.Screen name="Favoris">
        {({ navigation }) => (
          <FavorisScreen
            onRetour={() => navigation.goBack()}
            onOuvrirLeCommerce={(businessId) => navigation.navigate('Fiche', { businessId })}
            onVoirMesPaliers={() => navigation.navigate('Paliers')}
          />
        )}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Paliers">
        {({ navigation }) => (
          <PaliersScreen
            prenom={prenom}
            // Sans elle, « neuf prestations chez six salons » ne s'écrit
            // jamais : le serveur rend des comptes nuls faute de savoir d'où.
            position={position}
            onRetour={() => navigation.goBack()}
            onConnecterUnReseau={onConnecterUnReseau}
            onVoirMonAudience={onVoirMonAudience}
            onLireLesRegles={() => navigation.navigate('Regles')}
            // **La porte que le cadre 02a ouvrait dans le vide.**
            // `onVoirLesPrestations` existait sur l'écran, `porteOuverte` en
            // dépendait, et personne ne le passait : « voir les 34 prestations »
            // ne menait nulle part. Il fallait une lecture non bornée par le
            // rayon, qui n'existait pas.
            onVoirLesPrestations={(palier) =>
              navigation.navigate('PrestationsDuPalier', { palier })
            }
          />
        )}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="PrestationsDuPalier">
        {({ navigation, route }) => (
          <PrestationsDuPalierScreen
            palier={route.params.palier}
            rayonKm={RAYON_DES_PALIERS_KM}
            // La position vient de la coquille, comme pour le fil : on lit
            // d'où l'on est, pas d'où l'on habite. Nulle, l'écran rend la
            // liste entière et tait la moitié de sa phrase.
            position={position}
            // La fiche vit dans la même pile : la liste qui nomme une
            // prestation réservable mène à l'endroit où on la réserve.
            onOuvrir={(businessId) => navigation.navigate('Fiche', { businessId })}
            onRetour={() => navigation.goBack()}
          />
        )}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Regles">
        {({ navigation }) => <ReglesScreen onRetour={() => navigation.goBack()} />}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Creneaux">
        {({ navigation, route }) => (
          <CreneauxScreen
            onRetour={() => navigation.goBack()}
            fiche={route.params.fiche}
            offre={route.params.offre}
            onReserve={(bookingId) => {
              // La place est prise : revenir sur les créneaux n'a plus de
              // sens, la pile de découverte repart du fil.
              navigation.popToTop();
              onReserve(bookingId);
            }}
          />
        )}
      </PileCreateur.Screen>

    </PileCreateur.Navigator>
  );
}

/**
 * Les réservations : la liste, le code de retrait, la preuve.
 *
 * **Une réservation identifie son écran de code.** Sans `getId`, ouvrir une
 * deuxième réservation revient sur l'écran déjà empilé en changeant seulement
 * ses paramètres ; l'écran a sa propre garde, mais la faire porter aussi par
 * la navigation évite d'avoir à s'en remettre à un seul verrou pour la règle
 * « un code, une réservation ».
 */
/**
 * La pile des réservations, **exportée pour être éprouvée de bout en bout**.
 *
 * Le code de retrait est la seule chose à montrer au comptoir : sans lui aucune
 * prestation ne se consomme. Son chemin part de la liste, traverse `destination`
 * et aboutit à un écran de la pile — trois pièces dont chacune était gardée
 * séparément, et dont la jonction ne l'était pas. Une refonte qui déplace la
 * liste laisse les trois vertes et le parcours mort.
 */
export function PileDesReservations() {
  return (
    <PileReservations.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileReservations.Screen name="Historique">
        {({ navigation, route }) => (
          <HistoriqueScreen
            ongletDemande={route.params?.onglet}
            onOngletApplique={() => navigation.setParams({ onglet: undefined })}
            // **Le code redevient atteignable.** Il ne l'était
            // qu'immédiatement après la confirmation : fermer l'application le
            // faisait perdre jusqu'au rendez-vous, alors que c'est la seule
            // chose à montrer au comptoir.
            // **Vers la fiche, par l'onglet qui la porte.** `Fiche` vit dans
            // la pile du fil et nulle part ailleurs ; la dupliquer ici
            // amènerait aussi `Creneaux`, donc tout le parcours de
            // réservation dans un onglet qui n'en est pas un. Le saut
            // d'onglet est celui que `onReserve` fait déjà en sens inverse.
            onOuvrirLeCommerce={(businessId) =>
              navigation.navigate('parcours', { screen: 'Fiche', params: { businessId } })
            }
            onOuvrir={(reservation) => {
              const cible = destination(reservation);
              if (cible === 'code') {
                navigation.navigate('Code', { bookingId: reservation.booking_id });
              } else if (cible === 'preuve' && reservation.contrepartie) {
                navigation.navigate('Preuve', {
                  collaborationId: reservation.contrepartie.collaboration_id,
                });
              }
            }}
          />
        )}
      </PileReservations.Screen>

      <PileReservations.Screen name="Code" getId={({ params }) => params?.bookingId}>
        {({ navigation, route }) => (
          <CodeScreen
            bookingId={route.params.bookingId}
            onRetour={() => navigation.goBack()}
            /* **La couture existait, et personne ne la remplissait.** L'écran
               appelle `activer` en prenant le focus et `desactiver` en le
               perdant depuis toujours ; l'implémentation, elle, n'existait pas —
               deux jetons à `true` et aucun module installé. */
            presentationAuComptoir={presentationAuComptoir}
          />
        )}
      </PileReservations.Screen>

      <PileReservations.Screen name="Preuve">
        {({ navigation, route }) => (
          <PreuveScreen
            collaborationId={route.params.collaborationId}
            onRetour={() => navigation.goBack()}
          />
        )}
      </PileReservations.Screen>
    </PileReservations.Navigator>
  );
}

/**
 * Le profil, et ce qui s'ouvre depuis lui.
 *
 * **Deux onglets sont devenus un.** L'audience et les réglages occupaient
 * chacun une place sur une barre qui en portait quatre, et ce sont les deux
 * qu'on ouvrait le moins : on consulte ses chiffres de temps en temps, on
 * change un réglage deux fois par an. La barre passe à trois — le fil, les
 * réservations, le profil — et les cibles y gagnent la place que quatre
 * onglets leur prenaient sur un iPhone.
 *
 * **Les favoris gardent leurs deux portes, et c'est délibéré.** Ils vivent
 * dans la pile du fil parce que le cœur se pose sur une carte du mur et que ce
 * qu'il ouvre explique cette carte. Le profil est l'autre question — « ce que
 * j'ai mis de côté » — et elle mérite sa porte. Un même écran, deux chemins :
 * ce n'est pas une duplication, c'est deux questions qui aboutissent au même
 * endroit.
 */
function PileDuProfil({ onVoirMesPaliers }: { onVoirMesPaliers: () => void }) {
  return (
    <PileAudience.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileAudience.Screen name="Profil">
        {({ navigation }) => (
          <ProfilScreen
            onReglages={() => navigation.navigate('Reglages')}
            onMesPublications={() => navigation.navigate('MesPublications')}
            onFavoris={() => navigation.navigate('FavorisDuProfil')}
            onMonAudience={() => navigation.navigate('Audience')}
          />
        )}
      </PileAudience.Screen>
      <PileAudience.Screen name="Audience">
        {({ navigation }) => (
          <AudienceScreen
            onVoirMesPaliers={onVoirMesPaliers}
            onVoirLeScore={() => navigation.navigate('Fiabilite')}
            onRetour={() => navigation.goBack()}
          />
        )}
      </PileAudience.Screen>
      <PileAudience.Screen name="MesPublications">
        {({ navigation }) => <MesPublicationsScreen onRetour={() => navigation.goBack()} />}
      </PileAudience.Screen>
      <PileAudience.Screen name="FavorisDuProfil">
        {({ navigation }) => (
          <FavorisScreen
            onRetour={() => navigation.goBack()}
            // **Le salon s'ouvre dans la pile du fil, pas ici.** La fiche mène
            // à la réservation, et la réservation appartient au parcours : la
            // rendre depuis le profil enfermerait quelqu'un dans une pile qui
            // n'a pas de suite.
            //
            // **Et la prop est donc absente, non pas vide.** Une fonction vide
            // laissait la rangée pressable : elle répondait au doigt sans rien
            // ouvrir, et annonçait un bouton à la lecture d'écran là où il n'y
            // en a pas. Sans destination, la rangée n'est plus un bouton.
            onVoirMesPaliers={onVoirMesPaliers}
          />
        )}
      </PileAudience.Screen>
      <PileAudience.Screen name="Reglages">
        {({ navigation }) => <ReglagesScreen onRetour={() => navigation.goBack()} />}
      </PileAudience.Screen>
      <PileAudience.Screen name="Fiabilite">
        {({ navigation }) => <FiabiliteScreen onRetour={() => navigation.goBack()} />}
      </PileAudience.Screen>
    </PileAudience.Navigator>
  );
}

function OngletsCreateur({
  prenom,
  onConnecterUnReseau,
  onVoirMonAudience,
  onVoirMesPaliers,
}: {
  prenom: string | null;
  onConnecterUnReseau: () => void;
  onVoirMonAudience: () => void;
  onVoirMesPaliers: () => void;
}) {
  const { t } = useI18n();
  const options = useOptionsDOnglets();
  const barreLaterale = useBarreLaterale(prenom);
  return (
    <Onglets.Navigator screenOptions={options} tabBar={barreLaterale}>
      <Onglets.Screen name="parcours" options={onglet(t('onglets.fil'), 'lieu')}>
        {({ navigation }) => (
          <ParcoursCreateur
            prenom={prenom}
            onConnecterUnReseau={onConnecterUnReseau}
            onVoirMonAudience={onVoirMonAudience}
            onVoirMesPaliers={onVoirMesPaliers}
            // **La confirmation change d'onglet, et s'arrête à la liste.**
            //
            // Le code de retrait appartient au parcours des réservations ;
            // l'afficher dans l'onglet « à proximité » le donnait à lire comme
            // une étape de la découverte. Mais l'ouvrir *tout de suite* était
            // faux aussi : la prestation est souvent dans plusieurs jours, et
            // le code n'y sert à rien avant d'être au comptoir. Pire, la
            // validation par le commerce étant le comportement par défaut, la
            // réservation vient d'entrer en `awaiting_business` — elle n'a
            // aucun code, et l'écran s'ouvrait sur un refus du serveur.
            //
            // La liste est la bonne arrivée : elle confirme que la place est
            // prise, elle porte la date, et c'est de là qu'on rouvre le code le
            // jour venu.
            //
            // **Et sur l'onglet « à venir ».** La liste s'ouvre sur « en cours »
            // par défaut — l'ordre des onglets est celui de ce qu'on doit
            // faire — mais une réservation qu'on vient de prendre est en
            // `held` ou `awaiting_business`, jamais en `consumed`. On
            // atterrissait donc sur un onglet qui ne contenait pas ce qu'on
            // venait de faire, et souvent vide : pour un créateur qui réserve
            // sa première prestation, l'écran de confirmation était un état
            // vide.
            onReserve={() =>
              navigation.navigate('reservations', {
                screen: 'Historique',
                params: { onglet: 'a-venir' },
              })
            }
          />
        )}
      </Onglets.Screen>
      <Onglets.Screen
        name="reservations"
        component={PileDesReservations}
        options={onglet(t('onglets.reservations'), 'calendrier')}
      />
      {/* **L'entrée vers les paliers vit ici depuis le fil v3.** Elle était
          sur le fil — « douze prestations vous sont ouvertes », qu'on appuyait
          pour comprendre pourquoi. La revue l'en sort, et l'endroit est juste :
          les abonnés et le score de fiabilité, les deux autres grandeurs qui
          ouvrent une prestation, sont déjà sur cet écran. Sans ce passage, la
          seule route vers les paliers serait l'état vide du fil — c'est-à-dire
          accessible aux seuls créateurs qui n'ont rien à réserver. */}
      <Onglets.Screen name="profil" options={onglet(t('onglets.profil'), 'personne')}>
        {() => <PileDuProfil onVoirMesPaliers={onVoirMesPaliers} />}
      </Onglets.Screen>
    </Onglets.Navigator>
  );
}

// --------------------------------------------------------------------------
// commerce
// --------------------------------------------------------------------------

/**
 * La caisse, avec sa caméra.
 *
 * **Le pont au jeton brut a disparu, et c'est le correctif.** L'écran recevait
 * `accessToken`, lu une fois à l'ouverture, et construisait ses requêtes
 * lui-même. Quinze minutes plus tard ce jeton était périmé, le serveur
 * répondait 401, et la caisse affichait « authentification requise » sur chaque
 * code présenté — sans rotation, sans retour à la connexion, sans issue autre
 * que fermer l'application. Elle passe maintenant par le client, comme tout le
 * reste de l'app.
 *
 * **Le scanner se branche ici**, et c'est ce qui manquait avant : sans lui,
 * l'écran retombait sur son message « pas de caméra sur cet appareil » — sur un
 * iPhone qui en a une, et sans qu'aucune autorisation ait jamais été demandée.
 * La caméra n'était pas refusée, elle n'était jamais montée.
 */
function CaisseAvecJeton({ businessId }: { businessId?: string }) {
  return <RedemptionScreen scanner={CameraScanner} businessId={businessId} />;
}


function ParcoursCommerce({ businessId }: { businessId: string }) {
  return (
    <PileCommerce.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileCommerce.Screen name="Journee" initialParams={{ businessId }}>
        {() => <JourneeScreen businessId={businessId} />}
      </PileCommerce.Screen>
      <PileCommerce.Screen name="Caisse">
        {/* `RedemptionScreen` fait partie des écrans écrits avant le client
            d'API : il construit ses requêtes et veut un jeton brut. Le pont est
            nommé ici plutôt que caché dans l'écran, pour qu'il disparaisse avec
            la dette. */}
        {() => <CaisseAvecJeton businessId={businessId} />}
      </PileCommerce.Screen>
    </PileCommerce.Navigator>
  );
}

/**
 * Les réglages du commerce, et l'abonnement qu'ils ouvrent.
 *
 * **Une pile plutôt qu'un écran seul.** L'abonnement n'était atteignable que
 * par le mur de l'annuaire, lequel ne s'affiche qu'à un salon **sans**
 * abonnement : un salon abonné ne pouvait ni voir sa formule, ni en changer,
 * ni résilier. Les réglages sont l'endroit où on le cherche, et il y mène
 * maintenant.
 */
function PileDesReglagesDuCommerce({ businessId }: { businessId: string }) {
  const { t } = useI18n();
  return (
    <PileReglages.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileReglages.Screen name="Reglages">
        {({ navigation }) => (
          <ReglagesScreen onVoirLAbonnement={() => navigation.navigate('Abonnement')} />
        )}
      </PileReglages.Screen>
      <PileReglages.Screen name="Abonnement">
        {({ navigation }) => (
          <AbonnementScreen
            businessId={businessId}
            onRetour={() => navigation.goBack()}
            retourVers={t('onglets.reglages')}
          />
        )}
      </PileReglages.Screen>
    </PileReglages.Navigator>
  );
}

/** L'annuaire, et l'abonnement qu'on atteint depuis son refus. */
function PileDeLAnnuaire({
  businessId,
  onRetour,
  retourVers,
}: {
  businessId: string;
  onRetour?: () => void;
  retourVers?: string;
}) {
  return (
    <PileAnnuaire.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileAnnuaire.Screen name="Annuaire">
        {({ navigation }) => (
          <AnnuaireScreen
            businessId={businessId}
            onVoirLAbonnement={() => navigation.navigate('Abonnement')}
            onOuvrirLaCreatrice={(creatorId) => navigation.navigate('Creatrice', { creatorId })}
            onRetour={onRetour}
            retourVers={retourVers}
          />
        )}
      </PileAnnuaire.Screen>
      <PileAnnuaire.Screen name="Creatrice">
        {({ navigation, route }) => (
          <CreatriceScreen
            businessId={businessId}
            creatorId={route.params.creatorId}
            onRetour={() => navigation.goBack()}
          />
        )}
      </PileAnnuaire.Screen>
      <PileAnnuaire.Screen name="Abonnement">
        {({ navigation }) => (
          <AbonnementScreen businessId={businessId} onRetour={() => navigation.goBack()} />
        )}
      </PileAnnuaire.Screen>
    </PileAnnuaire.Navigator>
  );
}

/**
 * Les onglets du commerce, sous le fournisseur d'appartenance.
 *
 * Le fournisseur est posé **ici** et non plus haut : au-dessus, la session
 * n'est pas encore établie et la requête partirait sans jeton. Plus bas, chaque
 * écran remonterait la sienne — et c'est exactement ce qui rendait un choix de
 * salon impossible à tenir.
 */
function OngletsCommerce() {
  return (
    <CommerceProvider>
      <OngletsDuCommerceChoisi />
    </CommerceProvider>
  );
}

function OngletsDuCommerceChoisi() {
  const { t } = useI18n();
  const { businessId, nom, commerces, choisir, ecranDAttente, timezone } = useMonCommerce();
  const options = useOptionsDOnglets();
  /**
   * **Quatre onglets sur un téléphone, huit sur un bureau.**
   *
   * Les huit viennent de la coquille de bureau, où une barre latérale de 240
   * points les porte sans effort ; transposées telles quelles en bas d'un
   * iPhone, elles font des cibles de 48 points de large. Le défaut n'est pas le
   * nombre, c'est qu'aucun tri ne les séparait.
   *
   * Le tri est celui de la **fréquence**, le même que la configuration emploie
   * déjà : en bas ce qu'un salon touche chaque jour et qui porte une échéance —
   * une décision à rendre, un code à valider, un délai de publication qui court
   * — et sous « More » ce qu'il a composé une fois et relit parfois.
   *
   * C'est la même donnée en deux mises en forme, comme le sélecteur de salon
   * qui est un bouton partout et un mur à la caisse. Les quatre écrans rangés
   * restent des destinations : ils quittent la barre, pas la navigation.
   */
  const { large } = useGabarit();
  const compteDuJour = commerces.find((salon) => salon.id === businessId)?.decisions_en_attente;
  // Le sélecteur vit là où le nom vit déjà. Il ne se rend qu'à partir de deux
  // salons — la barre décide, parce qu'elle seule sait si elle est repliée.
  const barreLaterale = useBarreLaterale(nom, { salons: commerces, choisi: businessId, onChoisir: choisir });

  // Pas de commerce rattaché : un onglet qui répondrait 403 partout ne dit
  // rien. On montre ce qu'il faut faire, et les réglages restent joignables.
  if (businessId === null) {
    return (
      <Onglets.Navigator screenOptions={options} tabBar={barreLaterale}>
        {/* **L'onglet dit ce qu'il y a derrière, et non ce qu'il y aura.**
            « Aujourd'hui » annonçait une journée de rendez-vous à quelqu'un qui
            n'a pas encore de commerce ; ce qui l'attend est un formulaire de
            création, et c'est ce que l'onglet doit nommer. */}
        <Onglets.Screen name="attente" options={onglet(t('onglets.demarrer'), 'coche')}>
          {() => ecranDAttente}
        </Onglets.Screen>
        {/* **Pas d'abonnement ici, et ce n'est pas un oubli.** Ce montage est
            celui d'un compte dont le commerce n'existe pas encore :
            `businessId` est nul, et il n'y a pas de formule à montrer avant
            qu'il y ait un salon à abonner. */}
        <Onglets.Screen
          name="reglages"
          component={ReglagesScreen}
          options={onglet(t('onglets.reglages'), 'reglages')}
        />
      </Onglets.Navigator>
    );
  }

  return (
    <Onglets.Navigator screenOptions={options} tabBar={barreLaterale}>
      {ecransDuCommerce({ businessId, timezone, compteDuJour, large, t })}
      <Onglets.Screen
        name="reglages"
        options={
          large
            ? onglet(t('onglets.reglages'), 'reglages')
            : ongletHorsBarre(t('onglets.reglages'), 'reglages')
        }
      >
        {() => <PileDesReglagesDuCommerce businessId={businessId} />}
      </Onglets.Screen>
    </Onglets.Navigator>
  );
}

/**
 * Les onglets du commerce, en fragment plutôt qu'en composant.
 *
 * **Une fonction et non un composant**, exprès : les enfants d'un navigateur
 * d'onglets doivent être des `Onglets.Screen` directement, pas un composant
 * qui les enveloppe. Une fonction ordinaire retournant un fragment traverse
 * exactement comme les écrans conditionnels déjà posés en ligne ailleurs dans
 * ce fichier ; un composant y ajouterait une couche que la bibliothèque ne
 * traverse pas de la même façon.
 *
 * **Extraite pour un second appelant.** Le commerce qui a choisi son salon
 * l'appelle depuis toujours ; l'administration l'appelle maintenant depuis une
 * reprise ouverte, sur le `businessId` qu'elle vient d'obtenir plutôt que sur
 * celui d'une appartenance. Les écrans eux-mêmes ne savent pas d'où vient leur
 * `businessId`, et n'ont jamais eu à le savoir : ils le prenaient déjà en
 * paramètre explicite, jamais d'un contexte de session.
 *
 * **Réglages n'y est pas.** Il ferme une porte pour l'ouvrir : sous une
 * session d'administration, `ReglagesScreen` masque la pause et l'historique
 * de reprise — les deux sont gardés sur `role === 'business_member'`, le rôle
 * de la session et non celui qu'on exerce. Le rendre quand même montrerait un
 * réglage amputé sans le dire ; l'omettre le dit en ne le montrant pas du
 * tout. Chaque appelant pose donc son propre onglet « reglages ».
 */
function ecransDuCommerce({
  businessId,
  timezone,
  compteDuJour,
  large,
  t,
}: {
  businessId: string;
  timezone: string | null;
  compteDuJour: number | undefined;
  large: boolean;
  t: (cle: string, valeurs?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <Onglets.Screen
        name="journee"
        options={onglet(t('onglets.journee'), 'calendrier', compteDuJour)}
      >
        {() => <ParcoursCommerce businessId={businessId} />}
      </Onglets.Screen>
      {/* **La caisse est un onglet, pas un écran enfoui.** Elle n'était
          atteignable que depuis une ligne de réservation du jour : une journée
          vide la rendait inaccessible, et le salon ne pouvait valider aucun
          code — la boucle du produit ne se fermait jamais. C'est l'écran le
          plus utilisé d'un comptoir, et il sert debout avec un client en face. */}
      <Onglets.Screen name="caisse" options={onglet(t('onglets.caisse'), 'etincelle')}>
        {() => <CaisseAvecJeton />}
      </Onglets.Screen>
      <Onglets.Screen name="publications" options={onglet(t('onglets.publications'), 'image')}>
        {() => <PublicationsScreen businessId={businessId} />}
      </Onglets.Screen>
      {/* **Le quatrième onglet du téléphone, et rien sur le bureau.** Il ne
          porte aucun écran de plus : il groupe ceux que la barre vient de
          libérer, et chaque ligne y porte son état — le menu informe au lieu de
          rediriger. */}
      {/* **`liste` et non le « + » de la planche, et c'est un écart écrit.** Un
          plus sur une barre d'onglets se lit « ajouter », juste à côté d'une
          caisse où l'on ajoute effectivement quelque chose. Le glyphe de liste
          dit « il y en a d'autres », ce que l'onglet fait. */}
      {large ? null : (
        <Onglets.Screen name="menu" options={onglet(t('onglets.menu'), 'liste')}>
          {() => <MenuDuCommerce businessId={businessId} />}
        </Onglets.Screen>
      )}
      <Onglets.Screen
        name="reporting"
        options={
          large
            ? onglet(t('onglets.reporting'), 'rapport')
            : ongletHorsBarre(t('onglets.reporting'), 'rapport')
        }
      >
        {({ navigation }) => (
          <ReportingScreen
            businessId={businessId}
            onRetour={large ? undefined : () => navigation.navigate('menu' as never)}
            retourVers={large ? undefined : t('onglets.menu')}
          />
        )}
      </Onglets.Screen>
      {/* **L'annuaire est ce que l'abonnement achète**, donc il est au premier
          niveau : le ranger derrière un autre écran reviendrait à cacher la
          contrepartie de ce qu'on facture. C'est le septième onglet du
          commerce, deux de plus que ce que `Icone` recommande — la barre
          latérale de bureau les tient sans effort, la barre du bas est
          serrée. À arbitrer avec Design si un huitième se présente. */}
      <Onglets.Screen
        name="annuaire"
        options={
          large
            ? onglet(t('onglets.annuaire'), 'personne')
            : ongletHorsBarre(t('onglets.annuaire'), 'personne')
        }
      >
        {({ navigation }) => (
          <PileDeLAnnuaire
            businessId={businessId}
            onRetour={large ? undefined : () => navigation.navigate('menu' as never)}
            retourVers={large ? undefined : t('onglets.menu')}
          />
        )}
      </Onglets.Screen>
      {/* **Deux entrées de rang égal, et plus une porte qui en cache deux.**
          La découpe est par objet — ce qui décrit l'endroit, ce qui décrit ce
          qu'on y fait — et elle recoupe la fréquence : un lieu se compose une
          fois, un catalogue vit en continu. Aucune des deux n'est un réglage de
          l'autre, donc aucune ne se range sous l'autre. */}
      <Onglets.Screen
        name="lieu"
        options={
          large
            ? onglet(t('onglets.lieu'), 'lieu')
            : ongletHorsBarre(t('onglets.lieu'), 'lieu')
        }
      >
        {({ navigation }) => (
          <LieuScreen
            businessId={businessId}
            timezone={timezone ?? undefined}
            // **Le retour n'existe que sur téléphone.** Sur bureau, cet écran
            // est un onglet de premier rang : y poser « revenir au menu »
            // nommerait une destination qui n'est pas dans la barre.
            onRetour={large ? undefined : () => navigation.navigate('menu' as never)}
            retourVers={large ? undefined : t('onglets.menu')}
          />
        )}
      </Onglets.Screen>
      <Onglets.Screen
        name="prestations"
        options={
          large
            ? onglet(t('onglets.prestations'), 'coche')
            : ongletHorsBarre(t('onglets.prestations'), 'coche')
        }
      >
        {({ navigation }) => (
          <CatalogueScreen
            businessId={businessId}
            onRetour={large ? undefined : () => navigation.navigate('menu' as never)}
            retourVers={large ? undefined : t('onglets.menu')}
          />
        )}
      </Onglets.Screen>
    </>
  );
}

// --------------------------------------------------------------------------
// administrateur
// --------------------------------------------------------------------------

/** Le commerce dans lequel l'administration navigue, ou aucun. */
type RepriseActive = {
  businessId: string;
  nom: string;
  /**
   * Servi seulement à l'ouverture d'une reprise neuve. En y revenant depuis la
   * liste des salons, on ne le rapporte pas — la ligne dit « ouverte », pas ce
   * qu'elle porte, et refaire l'aller-retour pour l'obtenir retarderait
   * l'entrée pour une phrase qui ne bloque rien.
   */
  detail?: RepriseOuverte;
};

function OngletsAdmin() {
  const { t } = useI18n();
  const options = useOptionsDOnglets();
  // L'administration n'a pas de contexte à situer : le rôle suffit.
  const barreLaterale = useBarreLaterale(null);

  /**
   * **La bascule vit ici, en état local, comme le fait déjà `businessId` sur
   * le commerce qui a choisi son salon.** Aucune route nommée, aucun
   * navigateur de plus : ouvrir une reprise remplace la barre d'onglets de
   * l'administration par celle du commerce, le temps qu'elle dure, exactement
   * comme un commerce sans salon voit sa propre barre remplacée par un
   * formulaire de création. Le motif est le même dans les deux cas — deux
   * arbres d'onglets réellement différents ne se laissent pas fondre en un
   * troisième qui les couvrirait mal tous les deux.
   */
  const [reprise, setReprise] = useState<RepriseActive | null>(null);

  if (reprise) {
    return (
      <EcranDeReprise
        businessId={reprise.businessId}
        nomDuSalon={reprise.nom}
        detail={reprise.detail}
        onQuitter={() => setReprise(null)}
      />
    );
  }

  return (
    <Onglets.Navigator screenOptions={options} tabBar={barreLaterale}>
      <Onglets.Screen
        name="arbitrage"
        component={ArbitrageScreen}
        options={onglet(t('onglets.arbitrage'), 'liste')}
      />
      {/* **Les salons, deuxième et non dernier.** C'est l'entrée du travail de
          support : reconnaître le bon salon parmi cent, puis décider d'y
          entrer. Les plans sont de la configuration, qu'on ouvre une fois par
          trimestre.

          **Et depuis ce soir, y entrer veut dire quelque chose.** Une reprise
          ouverte donnait une autorisation que rien dans l'app ne savait
          exercer : l'administration lisait un message de confirmation et
          s'arrêtait là, sans écran pour regarder ce que l'accès venait
          d'ouvrir. */}
      <Onglets.Screen name="commerces" options={onglet(t('onglets.commerces'), 'lieu')}>
        {() => (
          <CommercesScreen
            onEntrerEnReprise={(businessId, nom, detail) => setReprise({ businessId, nom, detail })}
          />
        )}
      </Onglets.Screen>
      <Onglets.Screen
        name="createurs"
        component={CreateursAdminScreen}
        options={onglet(t('onglets.createurs'), 'personne')}
      />
      <Onglets.Screen
        name="plans"
        component={PlansScreen}
        options={onglet(t('onglets.plans'), 'rapport')}
      />
      {/* **Le mode terrain.** Il n'est pas rangé derrière un autre écran : la
          fondatrice l'ouvre debout dans un salon, entre deux clients, et deux
          gestes de plus pour l'atteindre suffisent à ne pas le sortir. */}
      {/* **Sans reprise de compte.** Elle y était offerte et se lisait comme
          une capacité du démarchage — « on prend le contrôle des salons qu'on
          visite » — alors que c'est l'accès de support. Elle reste sur
          l'écran des salons, au-dessus. */}
      <Onglets.Screen
        name="terrain"
        component={TerrainScreen}
        options={onglet(t('onglets.terrain'), 'personne')}
      />
      <Onglets.Screen
        name="reglages"
        component={ReglagesScreen}
        options={onglet(t('onglets.reglages'), 'reglages')}
      />
    </Onglets.Navigator>
  );
}

/**
 * L'administration, à l'intérieur d'un commerce qu'elle a repris.
 *
 * **Ce qui manquait n'était pas le pouvoir, c'était l'écran.** Le serveur
 * accorde déjà, à chaque requête, exactement l'autorité d'un salon sur les
 * écrans que la reprise couvre — `require_business_member` la synthétise sans
 * qu'une ligne ne soit jamais écrite en base. Rien côté app ne l'exerçait :
 * ouvrir une reprise rendait un message de confirmation, et l'administration
 * n'avait ensuite aucun moyen de regarder une réservation, une preuve, un
 * horaire. Le pouvoir existait, la porte pour s'en servir non.
 *
 * **Les mêmes écrans, sur le même `businessId`.** Chacun le prend déjà en
 * paramètre explicite — jamais d'un contexte de session — donc aucun n'a eu à
 * changer pour servir cet appelant-ci plutôt que celui qui a choisi son salon.
 *
 * **Un aller sans y toucher, et un retrait qui touche.** La flèche revient à
 * l'administration sans rien faire à la reprise : un administrateur qui va
 * vérifier autre chose sur Plans ne perd pas son accès pour l'avoir quitté des
 * yeux. « Close my access » est le geste distinct, et le seul des deux qui
 * appelle le serveur — c'est `fermerLaReprise`, que le client d'API portait
 * depuis le début sans qu'aucun écran ne l'appelle.
 */
function EcranDeReprise({
  businessId,
  nomDuSalon,
  detail,
  onQuitter,
}: {
  businessId: string;
  nomDuSalon: string;
  detail?: RepriseOuverte;
  onQuitter: () => void;
}) {
  const { t, locale } = useI18n();
  const { api, messageDErreur } = useApi();
  const c = useColors();
  const { large } = useGabarit();
  const options = useOptionsDOnglets();
  const barreLaterale = useBarreLaterale(nomDuSalon);
  const [fermeture, setFermeture] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function fermer() {
    setEchec(null);
    setFermeture(true);
    try {
      await api.fermerLaReprise(businessId);
      onQuitter();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setFermeture(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      {/* **Le bandeau, sur la même encre que celui que le salon lit.**
          `BandeauDeReprise` le lui montre depuis son côté ; celui-ci est
          l'autre moitié de la même promesse — l'administration voit qu'elle
          est entrée, pas seulement le salon qui la reçoit. */}
      <View
        testID="bandeau-reprise-admin"
        style={{
          gap: 8,
          paddingTop: 8,
          paddingBottom: 14,
          paddingHorizontal: 16,
          backgroundColor: c['bg.inverse'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            // La même clé partagée que les autres flèches de retour de l'app
            // (`CodeScreen`, `FicheScreen`, `ReglagesScreen`) : une clé de plus
            // pour le même mot aurait divergé le jour où l'une des deux change.
            accessibilityLabel={t('common.retour')}
            onPress={onQuitter}
            hitSlop={12}
            style={({ pressed }) => ({
              minWidth: size.touchMin,
              minHeight: size.touchMin,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: -12,
              opacity: pressed ? 0.7 : 1,
            })}
            testID="reprise-admin-retour"
          >
            <Icone nom="retour" teinte={c['ink.onDark']} taille={18} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Texte variante="type.label" couleur="ink.onDark" ellipseSurNomPropre>
              {t('admin.repriseBandeauTitre', { salon: nomDuSalon })}
            </Texte>
            {/* **Le motif, quand on l'a.** Il n'arrive qu'à l'ouverture ; en
                revenant depuis la liste des salons, la ligne dit « ouverte »
                et rien de plus, et refaire l'aller-retour pour l'obtenir
                retarderait l'entrée pour une phrase qui ne bloque rien. */}
            {detail ? (
              // **La même clé que le bandeau du salon.** Le motif se cite mot
              // pour mot des deux côtés — le composer deux fois aurait fini
              // par le citer différemment, guillemets compris.
              <Texte
                variante="type.caption"
                couleur="ink.onDark"
                ellipseSurNomPropre
                testID="reprise-admin-motif"
              >
                {t('commerce.repriseMotif', { motif: detail.reason })}
              </Texte>
            ) : null}
          </View>
          <Button
            // **« Ferme mon accès », pas « Termine-la ».** Le salon coupe une
            // reprise qu'il n'a pas ouverte — `reglages.repriseRefermerAction`
            // parle depuis ce côté-là. Ici c'est l'administration qui referme
            // ce qu'elle a elle-même ouvert : une voix différente, un mot
            // différent, même si le geste serveur (`fermerLaReprise`) est
            // distinct de celui du salon (`refermerLaReprise`).
            label={t('admin.repriseBandeauFermer')}
            variant="secondary"
            size="sm"
            fullWidth={false}
            loading={fermeture}
            onPress={() => void fermer()}
            testID="reprise-admin-fermer"
          />
        </View>
        {detail ? (
          // **Les deux mêmes clés que le bandeau du salon** (`commerce.*`) et
          // que l'historique des réglages : trois lecteurs de la même donnée,
          // un seul jeu de mots pour la dire.
          <>
            <Texte variante="type.dataLabel" couleur="ink.onDark" testID="reprise-admin-portee">
              {t('commerce.repriseOuvre', {
                ecrans: detail.scope
                  .map((ecran) => nomDeLEcran(ecran, t))
                  .join(t('reglages.porteeSeparateur')),
              })}
            </Texte>
            {/* **En UTC, comme le reste de cette liste.** L'administration
                n'est pas sur le fuseau du salon — `CommercesScreen` lit déjà
                ses dates ainsi, pour la même raison : celle qui regarde peut
                être n'importe où. */}
            <Texte variante="type.dataLabel" couleur="ink.onDark" testID="reprise-admin-quand">
              {t('commerce.repriseDepuisJusqua', {
                debut: formatDateTime(detail.started_at, locale, 'UTC'),
                fin: formatDateTime(detail.expires_at, locale, 'UTC'),
              })}
            </Texte>
          </>
        ) : null}
        {echec ? (
          <StatusMessage level="danger" body={echec} testID="reprise-admin-echec" />
        ) : null}
      </View>

      <Onglets.Navigator screenOptions={options} tabBar={barreLaterale}>
        {ecransDuCommerce({
          businessId,
          // **Nulle, et non devinée.** L'admin n'a pas la fiche du salon sous
          // la main à cet instant ; `LieuScreen` traite déjà un fuseau absent
          // comme une donnée à charger, pas comme une erreur.
          timezone: null,
          compteDuJour: undefined,
          large,
          t,
        })}
      </Onglets.Navigator>
    </View>
  );
}

// --------------------------------------------------------------------------

/** Les couleurs de navigation, tirées du thème. Aucune valeur en dur. */
function themeDeNavigation(couleurs: ReturnType<typeof useTheme>['color']): Theme {
  return {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: couleurs['brand.700'],
      background: couleurs['bg.page'],
      card: couleurs['bg.surface'],
      text: couleurs['ink.default'],
      border: couleurs['line.default'],
      notification: couleurs['status.danger.text'],
    },
  };
}

export function Navigation({
  role,
  prenom = null,
}: {
  role: 'creator' | 'business_member' | 'admin';
  /** Résolu par `App`, à partir de la session. Les écrans ne la lisent pas. */
  prenom?: string | null;
}) {
  const { color } = useTheme();
  // La référence sert à viser l'onglet du rattachement depuis un écran qui
  // n'est pas dans le même arbre — le fil et les paliers y mènent tous les
  // deux, et leur passer un objet de navigation les rendrait dépendants de
  // l'arbre où ils sont montés.
  const conteneur = useNavigationContainerRef();

  return (
    <NavigationContainer ref={conteneur} theme={themeDeNavigation(color)}>
      {role === 'creator' ? (
        <OngletsCreateur
          prenom={prenom}
          // **Vers l'audience, à travers le profil.** L'onglet ne s'appelle
          // plus « audience » : il porte le profil, et l'audience est l'écran
          // qu'on y ouvre. Naviguer vers l'onglet seul déposerait quelqu'un sur
          // le profil en lui laissant chercher ce qu'il venait voir.
          onConnecterUnReseau={() =>
            (conteneur.navigate as (n: string, p?: object) => void)('profil', {
              screen: 'Audience',
            })
          }
          onVoirMonAudience={() =>
            (conteneur.navigate as (n: string, p?: object) => void)('profil', {
              screen: 'Audience',
            })
          }
          // **`paliers` n'a jamais existé.** Les onglets du créateur sont
          // `parcours`, `audience`, `reservations` et `reglages` ; l'écran des
          // paliers vit dans la pile du fil, sous `Paliers`. L'appui partait,
          // React Navigation ignorait le nom, et rien ne bougeait — ce qui se
          // lit comme un texte non cliquable. C'était le seul chemin vers les
          // paliers depuis qu'ils ont quitté le fil.
          //
          // Le `as never` est ce qui l'a rendu possible : il existe parce que
          // le conteneur n'est pas typé sur une liste de routes, et il efface
          // du même coup la vérification qui aurait dit que le nom était faux.
          onVoirMesPaliers={() =>
            (
              conteneur.navigate as unknown as (
                onglet: string,
                cible: { screen: string },
              ) => void
            )('parcours', { screen: 'Paliers' })
          }
        />
      ) : role === 'business_member' ? (
        <OngletsCommerce />
      ) : (
        <OngletsAdmin />
      )}
    </NavigationContainer>
  );
}
