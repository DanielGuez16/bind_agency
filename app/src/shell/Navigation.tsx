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
import {
  NavigationContainer,
  DefaultTheme,
  useNavigationContainerRef,
  type Theme,
} from '@react-navigation/native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { FichePublique, OffreDeLaFiche, PalierAccessible } from '../api';
import { Icone, type NomIcone } from '../components';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { useTheme } from '../theme';
import { AbonnementScreen } from '../screens/AbonnementScreen';
import { AnnuaireScreen } from '../screens/AnnuaireScreen';
import { ArbitrageScreen } from '../screens/ArbitrageScreen';
import { AudienceScreen } from '../screens/AudienceScreen';
import { FavorisScreen } from '../screens/FavorisScreen';
import { FiabiliteScreen } from '../screens/FiabiliteScreen';
import { CodeScreen } from '../screens/CodeScreen';
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
import { TerrainScreen } from '../screens/TerrainScreen';
import { PreuveScreen } from '../screens/PreuveScreen';
import { PublicationsScreen } from '../screens/PublicationsScreen';
import { CatalogueScreen } from '../screens/CatalogueScreen';
import { HorairesScreen } from '../screens/HorairesScreen';
import { LieuScreen } from '../screens/LieuScreen';
import { CameraScanner } from '../screens/CameraScanner';
import { RedemptionScreen } from '../screens/RedemptionScreen';
import { ReglagesScreen } from '../screens/ReglagesScreen';
import { ReportingScreen } from '../screens/ReportingScreen';
import { BarreLaterale, type ContexteDeBarre } from './BarreLaterale';
import { useGabarit } from './gabarit';
import { usePosition } from './usePosition';
import { CommerceProvider, useMonCommerce } from './useMonCommerce';

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
  Historique: undefined;
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
  Audience: undefined;
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
export type PileAnnuaireParams = {
  Annuaire: undefined;
  Abonnement: undefined;
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
  if (!large) return undefined;
  return (props: BottomTabBarProps) => (
    <BarreLaterale {...props} intitule={intitule} {...salon} />
  );
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
function onglet(titre: string, icone: NomIcone) {
  return {
    title: titre,
    tabBarIcon: ({ color }: { color: string }) => <IconeDOnglet nom={icone} actif={color} />,
  };
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
          />
        )}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Fiche">
        {({ navigation, route }) => (
          <FicheScreen
            businessId={route.params.businessId}
            onRetour={() => navigation.goBack()}
            onReserver={(offre, fiche) => navigation.navigate('Creneaux', { fiche, offre })}
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
        {({ navigation }) => (
          <HistoriqueScreen
            // **Le code redevient atteignable.** Il ne l'était
            // qu'immédiatement après la confirmation : fermer l'application le
            // faisait perdre jusqu'au rendez-vous, alors que c'est la seule
            // chose à montrer au comptoir.
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

/** L'audience, et le score qu'on ouvre depuis elle. */
function PileDeLAudience({ onVoirMesPaliers }: { onVoirMesPaliers: () => void }) {
  return (
    <PileAudience.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileAudience.Screen name="Audience">
        {({ navigation }) => (
          <AudienceScreen
            onVoirMesPaliers={onVoirMesPaliers}
            onVoirLeScore={() => navigation.navigate('Fiabilite')}
          />
        )}
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
            onReserve={() => navigation.navigate('reservations', { screen: 'Historique' })}
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
      <Onglets.Screen name="audience" options={onglet(t('onglets.audience'), 'personne')}>
        {() => <PileDeLAudience onVoirMesPaliers={onVoirMesPaliers} />}
      </Onglets.Screen>
      <Onglets.Screen
        name="reglages"
        component={ReglagesScreen}
        options={onglet(t('onglets.reglages'), 'reglages')}
      />
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

/** L'annuaire, et l'abonnement qu'on atteint depuis son refus. */
function PileDeLAnnuaire({ businessId }: { businessId: string }) {
  return (
    <PileAnnuaire.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileAnnuaire.Screen name="Annuaire">
        {({ navigation }) => (
          <AnnuaireScreen
            businessId={businessId}
            onVoirLAbonnement={() => navigation.navigate('Abonnement')}
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
  const { businessId, nom, commerces, choisir, ecranDAttente } = useMonCommerce();
  const options = useOptionsDOnglets();
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
      <Onglets.Screen name="journee" options={onglet(t('onglets.journee'), 'calendrier')}>
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
      <Onglets.Screen name="reporting" options={onglet(t('onglets.reporting'), 'rapport')}>
        {() => <ReportingScreen businessId={businessId} />}
      </Onglets.Screen>
      {/* **L'annuaire est ce que l'abonnement achète**, donc il est au premier
          niveau : le ranger derrière un autre écran reviendrait à cacher la
          contrepartie de ce qu'on facture. C'est le septième onglet du
          commerce, deux de plus que ce que `Icone` recommande — la barre
          latérale de bureau les tient sans effort, la barre du bas est
          serrée. À arbitrer avec Design si un huitième se présente. */}
      <Onglets.Screen name="annuaire" options={onglet(t('onglets.annuaire'), 'personne')}>
        {() => <PileDeLAnnuaire businessId={businessId} />}
      </Onglets.Screen>
      {/* **Deux entrées de rang égal, et plus une porte qui en cache deux.**
          La découpe est par objet — ce qui décrit l'endroit, ce qui décrit ce
          qu'on y fait — et elle recoupe la fréquence : un lieu se compose une
          fois, un catalogue vit en continu. Aucune des deux n'est un réglage de
          l'autre, donc aucune ne se range sous l'autre. */}
      <Onglets.Screen name="lieu" options={onglet(t('onglets.lieu'), 'lieu')}>
        {() => <LieuScreen businessId={businessId} />}
      </Onglets.Screen>
      <Onglets.Screen name="prestations" options={onglet(t('onglets.prestations'), 'coche')}>
        {() => <CatalogueScreen businessId={businessId} />}
      </Onglets.Screen>
      <Onglets.Screen
        name="reglages"
        component={ReglagesScreen}
        options={onglet(t('onglets.reglages'), 'reglages')}
      />
    </Onglets.Navigator>
  );
}

// --------------------------------------------------------------------------
// administrateur
// --------------------------------------------------------------------------

function OngletsAdmin() {
  const { t } = useI18n();
  const options = useOptionsDOnglets();
  // L'administration n'a pas de contexte à situer : le rôle suffit.
  const barreLaterale = useBarreLaterale(null);
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
          trimestre. */}
      <Onglets.Screen
        name="commerces"
        component={CommercesScreen}
        options={onglet(t('onglets.commerces'), 'lieu')}
      />
      <Onglets.Screen
        name="plans"
        component={PlansScreen}
        options={onglet(t('onglets.plans'), 'rapport')}
      />
      {/* **Le mode terrain.** Il n'est pas rangé derrière un autre écran : la
          fondatrice l'ouvre debout dans un salon, entre deux clients, et deux
          gestes de plus pour l'atteindre suffisent à ne pas le sortir. */}
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
          onConnecterUnReseau={() => conteneur.navigate('audience' as never)}
          onVoirMonAudience={() => conteneur.navigate('audience' as never)}
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
