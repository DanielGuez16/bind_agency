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
import { NavigationContainer, DefaultTheme, type Theme } from '@react-navigation/native';
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
import { PlansScreen } from '../screens/PlansScreen';
import { PreuveScreen } from '../screens/PreuveScreen';
import { PublicationsScreen } from '../screens/PublicationsScreen';
import { RedemptionScreen } from '../screens/RedemptionScreen';
import { ReglagesScreen } from '../screens/ReglagesScreen';
import { ReportingScreen } from '../screens/ReportingScreen';
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

export type PileCommerceParams = {
  Journee: { businessId: string };
  Caisse: undefined;
};

const PileCreateur = createNativeStackNavigator<PileCreateurParams>();
const PileReservations = createNativeStackNavigator<PileReservationsParams>();
const PileCommerce = createNativeStackNavigator<PileCommerceParams>();
const Onglets = createBottomTabNavigator();

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
function ParcoursCreateur({ onReserve }: { onReserve: (bookingId: string) => void }) {
  const { position, demander } = usePosition();

  return (
    <PileCreateur.Navigator screenOptions={{ headerShown: false }}>
      <PileCreateur.Screen name="Fil">
        {({ navigation }) => (
          <FilScreen
            position={position}
            onDemanderLaPosition={demander}
            onOuvrirLeCommerce={(businessId) => navigation.navigate('Fiche', { businessId })}
          />
        )}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Fiche">
        {({ navigation, route }) => (
          <FicheScreen
            businessId={route.params.businessId}
            onReserver={(offre, fiche) => navigation.navigate('Creneaux', { fiche, offre })}
          />
        )}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Creneaux">
        {({ navigation, route }) => (
          <CreneauxScreen
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
function PileDesReservations() {
  return (
    <PileReservations.Navigator screenOptions={{ headerShown: false }}>
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
        {({ route }) => <CodeScreen bookingId={route.params.bookingId} />}
      </PileReservations.Screen>

      <PileReservations.Screen name="Preuve">
        {({ route }) => (
          <PreuveScreen
            collaborationId={route.params.collaborationId}
            // La sélection de média n'existe pas encore : le bouton est là,
            // il ne fait rien. Le dire ici plutôt que de le retirer, parce que
            // l'écran doit continuer de montrer son état.
            onEnvoyer={() => {}}
          />
        )}
      </PileReservations.Screen>
    </PileReservations.Navigator>
  );
}

function OngletsCreateur() {
  const { t } = useI18n();
  return (
    <Onglets.Navigator screenOptions={{ headerShown: false }}>
      <Onglets.Screen name="parcours" options={onglet(t('onglets.fil'), 'lieu')}>
        {({ navigation }) => (
          <ParcoursCreateur
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
      <Onglets.Screen
        name="paliers"
        component={PaliersScreen}
        options={onglet(t('onglets.paliers'), 'paliers')}
      />
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
function CaisseAvecJeton() {
  const { jetonDAcces } = useSession();
  // Sans jeton, l'écran ne peut rien vérifier. Il n'y en a pas tant que la
  // session n'est pas rétablie ; rendre `null` évite un appel voué à un 401.
  return jetonDAcces ? <RedemptionScreen accessToken={jetonDAcces} /> : null;
}


function ParcoursCommerce({ businessId }: { businessId: string }) {
  return (
    <PileCommerce.Navigator screenOptions={{ headerShown: false }}>
      <PileCommerce.Screen name="Journee" initialParams={{ businessId }}>
        {() => <JourneeScreen businessId={businessId} />}
      </PileCommerce.Screen>
      <PileCommerce.Screen name="Caisse">
        {/* `RedemptionScreen` fait partie des écrans écrits avant le client
            d'API : il construit ses requêtes et veut un jeton brut. Le pont est
            nommé ici plutôt que caché dans l'écran, pour qu'il disparaisse avec
            la dette. */}
        {() => <CaisseAvecJeton />}
      </PileCommerce.Screen>
    </PileCommerce.Navigator>
  );
}

function OngletsCommerce() {
  const { t } = useI18n();
  const { businessId, ecranDAttente } = useMonCommerce();

  // Pas de commerce rattaché : un onglet qui répondrait 403 partout ne dit
  // rien. On montre ce qu'il faut faire, et les réglages restent joignables.
  if (businessId === null) {
    return (
      <Onglets.Navigator screenOptions={{ headerShown: false }}>
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
    <Onglets.Navigator screenOptions={{ headerShown: false }}>
      <Onglets.Screen name="journee" options={onglet(t('onglets.journee'), 'calendrier')}>
        {() => <ParcoursCommerce businessId={businessId} />}
      </Onglets.Screen>
      <Onglets.Screen name="publications" options={onglet(t('onglets.publications'), 'image')}>
        {() => <PublicationsScreen businessId={businessId} />}
      </Onglets.Screen>
      <Onglets.Screen name="reporting" options={onglet(t('onglets.reporting'), 'rapport')}>
        {() => <ReportingScreen businessId={businessId} />}
      </Onglets.Screen>
      <Onglets.Screen name="activation" options={onglet(t('onglets.activation'), 'coche')}>
        {() => <ActivationScreen businessId={businessId} onActive={() => {}} />}
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
  return (
    <Onglets.Navigator screenOptions={{ headerShown: false }}>
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

export function Navigation({ role }: { role: 'creator' | 'business_member' | 'admin' }) {
  const { color } = useTheme();

  return (
    <NavigationContainer theme={themeDeNavigation(color)}>
      {role === 'creator' ? (
        <OngletsCreateur />
      ) : role === 'business_member' ? (
        <OngletsCommerce />
      ) : (
        <OngletsAdmin />
      )}
    </NavigationContainer>
  );
}
