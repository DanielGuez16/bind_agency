/**
 * La coquille.
 *
 * **L'ordre des fournisseurs n'est pas indifférent.** La langue d'abord — tout
 * le reste en a besoin, y compris l'écran d'erreur global. La session ensuite,
 * qui construit le client d'API. Le thème après, parce qu'il dépend du rôle
 * porté par la session. La frontière d'erreur enveloppe la navigation : elle
 * doit pouvoir s'afficher quand celle-ci tombe, donc elle a besoin de la langue
 * et du thème, mais pas de la navigation.
 *
 * **Le thème suit le rôle, décidé ici et nulle part ailleurs.** Un écran qui
 * choisirait son thème ferait changer l'apparence en cours de navigation.
 *
 * **Trois états, trois rendus.** Rétablissement, anonyme, connecté. Sans le
 * premier, l'écran de connexion clignoterait à chaque ouverture pour quelqu'un
 * de déjà connecté.
 */
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from './src/api';
import { I18nProvider } from './src/i18n';
import { AuthScreen } from './src/screens/AuthScreen';
import { SessionProvider, coffreSecurise, themeDuRole, useSession } from './src/session';
import { FrontiereDErreur } from './src/shell/FrontiereDErreur';
import { Navigation } from './src/shell/Navigation';
import { ThemeProvider, useColors } from './src/theme';

/**
 * L'adresse de l'API.
 *
 * Les variables `EXPO_PUBLIC_` sont inlinées à la compilation : celle-ci vaut
 * ce qu'elle valait au démarrage du bundler. Son absence garde la valeur de
 * développement plutôt que de laisser une chaîne vide produire des erreurs
 * réseau incompréhensibles.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8010/api/v1';

/** Le client compose les chemins complets, préfixe compris. */
const BASE_URL = API_URL.replace(/\/api\/v1\/?$/, '');

function Coquille() {
  const session = useSession();

  if (session.etat === 'retablissement') {
    return <Patience />;
  }

  // Anonyme : le thème créateur, qui est le thème par défaut du produit.
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'creator';

  return (
    <ThemeProvider role={themeDuRole(role)}>
      <ApiProvider client={session.client}>
        <StatusBar style="auto" />
        <FrontiereDErreur>
          {session.etat === 'connecte' ? (
            <Navigation role={session.utilisateur.role} />
          ) : (
            <AuthScreen motif={session.motif} />
          )}
        </FrontiereDErreur>
      </ApiProvider>
    </ThemeProvider>
  );
}

/** Le temps de lire le trousseau. Quelques dizaines de millisecondes. */
function Patience() {
  return (
    <ThemeProvider role="creator">
      <Fond />
    </ThemeProvider>
  );
}

function Fond() {
  const c = useColors();
  return (
    <View
      testID="ecran-retablissement"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c['bg.canvas'],
      }}
    >
      <ActivityIndicator color={c['text.secondary']} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider baseUrl={BASE_URL} coffre={coffreSecurise}>
          <Coquille />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
