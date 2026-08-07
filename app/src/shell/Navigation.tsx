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
import { HistoriqueScreen } from '../screens/HistoriqueScreen';
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

export type PileCreateurParams = {
  Fil: undefined;
  Fiche: { businessId: string };
  Creneaux: { fiche: FichePublique; offre: OffreDeLaFiche };
  Code: { bookingId: string };
  Preuve: { collaborationId: string };
};

export type PileCommerceParams = {
  Journee: { businessId: string };
  Caisse: undefined;
};

const PileCreateur = createNativeStackNavigator<PileCreateurParams>();
const PileCommerce = createNativeStackNavigator<PileCommerceParams>();
const Onglets = createBottomTabNavigator();

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
function ParcoursCreateur() {
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
            // Le code remplace l'écran de créneaux plutôt que de s'empiler
            // dessus : revenir en arrière depuis un code réservé n'a pas de
            // sens, la place est prise.
            onReserve={(bookingId) => navigation.replace('Code', { bookingId })}
          />
        )}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Code">
        {({ route }) => <CodeScreen bookingId={route.params.bookingId} />}
      </PileCreateur.Screen>

      <PileCreateur.Screen name="Preuve">
        {({ route }) => (
          <PreuveScreen
            collaborationId={route.params.collaborationId}
            // La sélection de média n'existe pas encore : le bouton est là,
            // il ne fait rien. Le dire ici plutôt que de le retirer, parce que
            // l'écran doit continuer de montrer son état.
            onEnvoyer={() => {}}
          />
        )}
      </PileCreateur.Screen>
    </PileCreateur.Navigator>
  );
}

function OngletsCreateur() {
  const { t } = useI18n();
  return (
    <Onglets.Navigator screenOptions={{ headerShown: false }}>
      <Onglets.Screen
        name="parcours"
        component={ParcoursCreateur}
        options={{ title: t('onglets.fil') }}
      />
      <Onglets.Screen
        name="paliers"
        component={PaliersScreen}
        options={{ title: t('onglets.paliers') }}
      />
      <Onglets.Screen name="reservations" options={{ title: t('onglets.reservations') }}>
        {() => <HistoriqueScreen onOuvrir={() => {}} />}
      </Onglets.Screen>
      <Onglets.Screen
        name="audience"
        component={AudienceScreen}
        options={{ title: t('onglets.audience') }}
      />
      <Onglets.Screen
        name="reglages"
        component={ReglagesScreen}
        options={{ title: t('onglets.reglages') }}
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
        <Onglets.Screen name="attente" options={{ title: t('onglets.journee') }}>
          {() => ecranDAttente}
        </Onglets.Screen>
        <Onglets.Screen
          name="reglages"
          component={ReglagesScreen}
          options={{ title: t('onglets.reglages') }}
        />
      </Onglets.Navigator>
    );
  }

  return (
    <Onglets.Navigator screenOptions={{ headerShown: false }}>
      <Onglets.Screen name="journee" options={{ title: t('onglets.journee') }}>
        {() => <ParcoursCommerce businessId={businessId} />}
      </Onglets.Screen>
      <Onglets.Screen name="publications" options={{ title: t('onglets.publications') }}>
        {() => <PublicationsScreen businessId={businessId} />}
      </Onglets.Screen>
      <Onglets.Screen name="reporting" options={{ title: t('onglets.reporting') }}>
        {() => <ReportingScreen businessId={businessId} />}
      </Onglets.Screen>
      <Onglets.Screen name="activation" options={{ title: t('onglets.activation') }}>
        {() => <ActivationScreen businessId={businessId} onActive={() => {}} />}
      </Onglets.Screen>
      <Onglets.Screen
        name="reglages"
        component={ReglagesScreen}
        options={{ title: t('onglets.reglages') }}
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
        options={{ title: t('onglets.arbitrage') }}
      />
      <Onglets.Screen
        name="plans"
        component={PlansScreen}
        options={{ title: t('onglets.plans') }}
      />
      <Onglets.Screen
        name="reglages"
        component={ReglagesScreen}
        options={{ title: t('onglets.reglages') }}
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
