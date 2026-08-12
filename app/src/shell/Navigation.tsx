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

import type { FichePublique, OffreDeLaFiche } from '../api';
import { Icone, type NomIcone } from '../components';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { useTheme } from '../theme';
import { ActivationScreen } from '../screens/ActivationScreen';
import { ArbitrageScreen } from '../screens/ArbitrageScreen';
import { AudienceScreen } from '../screens/AudienceScreen';
import { CodeScreen } from '../screens/CodeScreen';
import { CreneauxScreen } from '../screens/CreneauxScreen';
import { FicheScreen } from '../screens/FicheScreen';
import { FilScreen } from '../screens/FilScreen';
import { HistoriqueScreen, destination } from '../screens/HistoriqueScreen';
import { JourneeScreen } from '../screens/JourneeScreen';
import { PaliersScreen } from '../screens/PaliersScreen';
import { ReglesScreen } from '../screens/ReglesScreen';
import { PlansScreen } from '../screens/PlansScreen';
import { PreuveScreen } from '../screens/PreuveScreen';
import { PublicationsScreen } from '../screens/PublicationsScreen';
import { CatalogueScreen } from '../screens/CatalogueScreen';
import { CompositionDuCommerce, ConfigurationScreen } from '../screens/ConfigurationScreen';
import { HorairesScreen } from '../screens/HorairesScreen';
import { CameraScanner } from '../screens/CameraScanner';
import { RedemptionScreen } from '../screens/RedemptionScreen';
import { ReglagesScreen } from '../screens/ReglagesScreen';
import { ReportingScreen } from '../screens/ReportingScreen';
import { BarreLaterale } from './BarreLaterale';
import { useGabarit } from './gabarit';
import { usePosition } from './usePosition';
import { useMonCommerce } from './useMonCommerce';

// --------------------------------------------------------------------------
// paramètres
// --------------------------------------------------------------------------

/** La découverte : du fil jusqu'au choix d'un créneau. */
export type PileCreateurParams = {
  Fil: undefined;
  Fiche: { businessId: string };
  Creneaux: { fiche: FichePublique; offre: OffreDeLaFiche };
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
 * Les paliers, et les règles qui les gouvernent.
 *
 * Une pile pour deux écrans : les règles étaient jusqu'ici nulle part, et
 * l'écran des paliers citait une condition de fiabilité que rien n'expliquait.
 * En grand écran elles sont la colonne de droite de l'échelle et cette pile
 * n'est jamais empilée — le second écran n'existe que faute de seconde colonne.
 */
export type PilePaliersParams = {
  Paliers: undefined;
  Regles: undefined;
};

export type PileCommerceParams = {
  Journee: { businessId: string };
  Caisse: undefined;
};

/** La composition du commerce : ce qu'il offre, quand, et à quel palier. */
export type PileConfigurationParams = {
  Configuration: undefined;
  Catalogue: undefined;
  Horaires: undefined;
  Activation: undefined;
};

const PileCreateur = createNativeStackNavigator<PileCreateurParams>();
const PileReservations = createNativeStackNavigator<PileReservationsParams>();
const PilePaliers = createNativeStackNavigator<PilePaliersParams>();
const PileCommerce = createNativeStackNavigator<PileCommerceParams>();
const PileConfiguration = createNativeStackNavigator<PileConfigurationParams>();
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
function useBarreLaterale(intitule?: string | null) {
  const { large } = useGabarit();
  if (!large) return undefined;
  return (props: BottomTabBarProps) => <BarreLaterale {...props} intitule={intitule} />;
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
      borderTopColor: c['border.subtle'],
      borderTopWidth: 1,
    },
    tabBarLabelStyle: { fontSize: 11, lineHeight: 15, marginTop: 4 },
    tabBarActiveTintColor: c['accent.default'],
    tabBarInactiveTintColor: c['text.muted'],
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
            prenom={prenom}
            onConnecterUnReseau={onConnecterUnReseau}
            onVoirMonAudience={onVoirMonAudience}
            onVoirMesPaliers={onVoirMesPaliers}
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

/** L'échelle, et les règles derrière elle. */
function PileDesPaliers({
  prenom,
  onConnecterUnReseau,
  onVoirMonAudience,
}: {
  prenom: string | null;
  onConnecterUnReseau?: () => void;
  onVoirMonAudience?: () => void;
}) {
  return (
    <PilePaliers.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PilePaliers.Screen name="Paliers">
        {({ navigation }) => (
          <PaliersScreen
            prenom={prenom}
            onConnecterUnReseau={onConnecterUnReseau}
            onVoirMonAudience={onVoirMonAudience}
            onLireLesRegles={() => navigation.navigate('Regles')}
          />
        )}
      </PilePaliers.Screen>

      <PilePaliers.Screen name="Regles">
        {({ navigation }) => <ReglesScreen onRetour={() => navigation.goBack()} />}
      </PilePaliers.Screen>
    </PilePaliers.Navigator>
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
function PileDesReservations() {
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
            // **La confirmation change d'onglet.** Le code de retrait
            // appartient au parcours des réservations ; l'afficher dans
            // l'onglet « à proximité » le donnait à lire comme une étape de la
            // découverte, et laissait la liste des réservations muette juste
            // après en avoir pris une.
            onReserve={(bookingId) =>
              navigation.navigate('reservations', {
                screen: 'Code',
                params: { bookingId },
              })
            }
          />
        )}
      </Onglets.Screen>
      <Onglets.Screen name="paliers" options={onglet(t('onglets.paliers'), 'paliers')}>
        {() => (
          <PileDesPaliers
            prenom={prenom}
            onConnecterUnReseau={onConnecterUnReseau}
            onVoirMonAudience={onVoirMonAudience}
          />
        )}
      </Onglets.Screen>
      <Onglets.Screen
        name="reservations"
        component={PileDesReservations}
        options={onglet(t('onglets.reservations'), 'calendrier')}
      />
      <Onglets.Screen
        name="audience"
        component={AudienceScreen}
        options={onglet(t('onglets.audience'), 'personne')}
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
// commerce
// --------------------------------------------------------------------------

/** Le pont vers l'écran de caisse, qui n'utilise pas encore le client d'API. */
function CaisseAvecJeton({ businessId }: { businessId?: string }) {
  const { jetonDAcces } = useSession();
  // Sans jeton, l'écran ne peut rien vérifier. Il n'y en a pas tant que la
  // session n'est pas rétablie ; rendre `null` évite un appel voué à un 401.
  //
  // **Le scanner se branche ici**, et c'est ce qui manquait : sans lui, l'écran
  // retombait sur son message « pas de caméra sur cet appareil » — sur un
  // iPhone qui en a une, et sans qu'aucune autorisation ait jamais été
  // demandée. La caméra n'était pas refusée, elle n'était jamais montée.
  return jetonDAcces ? (
    <RedemptionScreen
      accessToken={jetonDAcces}
      scanner={CameraScanner}
      businessId={businessId}
    />
  ) : null;
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
 * La configuration : une entrée, trois écrans.
 *
 * Une pile et non trois onglets — la barre en a déjà cinq, et ce sont des
 * écrans qu'on ouvre le premier jour puis une fois par saison. Chacun rend son
 * propre retour : sur le web il n'y a pas de geste de balayage, et sans lui on
 * ne quitte l'écran qu'en changeant d'onglet.
 */
function PileDeConfiguration({ businessId }: { businessId: string }) {
  const { large } = useGabarit();

  // **Sur grand écran, la table des matières n'existe pas.** Trois cartes au
  // milieu du vide dont le seul rôle est de mener ailleurs, c'est un clic et
  // une page dépensés pour un menu. Le menu devient une colonne, la section
  // vit à côté, et la pile n'a plus lieu d'être : il n'y a rien à empiler.
  if (large) return <CompositionDuCommerce businessId={businessId} />;

  return (
    <PileConfiguration.Navigator screenOptions={OPTIONS_DE_PILE}>
      <PileConfiguration.Screen name="Configuration">
        {({ navigation }) => (
          <ConfigurationScreen
            onOuvrir={(porte) =>
              navigation.navigate(
                porte === 'catalogue'
                  ? 'Catalogue'
                  : porte === 'horaires'
                    ? 'Horaires'
                    : 'Activation',
              )
            }
          />
        )}
      </PileConfiguration.Screen>

      <PileConfiguration.Screen name="Catalogue">
        {({ navigation }) => (
          <CatalogueScreen businessId={businessId} onRetour={() => navigation.goBack()} />
        )}
      </PileConfiguration.Screen>

      <PileConfiguration.Screen name="Horaires">
        {({ navigation }) => (
          <HorairesScreen businessId={businessId} onRetour={() => navigation.goBack()} />
        )}
      </PileConfiguration.Screen>

      <PileConfiguration.Screen name="Activation">
        {({ navigation }) => (
          <ActivationScreen
            businessId={businessId}
            onActive={() => {}}
            onRetour={() => navigation.goBack()}
          />
        )}
      </PileConfiguration.Screen>
    </PileConfiguration.Navigator>
  );
}

function OngletsCommerce() {
  const { t } = useI18n();
  const { businessId, nom, ecranDAttente } = useMonCommerce();
  const options = useOptionsDOnglets();
  const barreLaterale = useBarreLaterale(nom);

  // Pas de commerce rattaché : un onglet qui répondrait 403 partout ne dit
  // rien. On montre ce qu'il faut faire, et les réglages restent joignables.
  if (businessId === null) {
    return (
      <Onglets.Navigator screenOptions={options} tabBar={barreLaterale}>
        <Onglets.Screen name="attente" options={onglet(t('onglets.journee'), 'calendrier')}>
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
      <Onglets.Screen name="configuration" options={onglet(t('onglets.configuration'), 'coche')}>
        {() => <PileDeConfiguration businessId={businessId} />}
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
      <Onglets.Screen
        name="plans"
        component={PlansScreen}
        options={onglet(t('onglets.plans'), 'rapport')}
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
      primary: couleurs['accent.default'],
      background: couleurs['bg.canvas'],
      card: couleurs['bg.surface'],
      text: couleurs['text.primary'],
      border: couleurs['border.subtle'],
      notification: couleurs['status.danger'],
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
          onVoirMesPaliers={() => conteneur.navigate('paliers' as never)}
        />
      ) : role === 'business_member' ? (
        <OngletsCommerce />
      ) : (
        <OngletsAdmin />
      )}
    </NavigationContainer>
  );
}
