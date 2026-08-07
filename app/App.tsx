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
import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from './src/api';
import { I18nProvider } from './src/i18n';
import { AuthScreen } from './src/screens/AuthScreen';
import { SessionProvider, coffreSecurise, themeDuRole, useSession } from './src/session';
import { FrontiereDErreur } from './src/shell/FrontiereDErreur';
import { Navigation } from './src/shell/Navigation';
import { ZoneSure } from './src/shell/ZoneSure';
import { ThemeProvider, useColors } from './src/theme';

/**
 * L'adresse de l'API.
 *
 * Les variables `EXPO_PUBLIC_` sont **inlinées à la compilation** : celle-ci
 * vaut ce qu'elle valait au démarrage du bundler, et modifier `.env` sans le
 * relancer ne change rien.
 *
 * **Son absence est dite, pas rattrapée.** Un repli sur `localhost` marche sur
 * la machine de développement et produit ailleurs des erreurs de connexion que
 * personne ne relie à une variable manquante. Mieux vaut un écran qui nomme la
 * variable et le fichier.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL;

/** Le client compose les chemins complets, préfixe compris. */
const BASE_URL = (API_URL ?? '').replace(/\/api\/v1\/?$/, '');

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
        {/* **La zone sûre est traitée ici, une fois.** Chaque écran qui s'en
            occuperait produirait un oubli quelque part, et l'oubli se voit sur
            un appareil à encoche : le titre passe dessous et se coupe.

            `bottom` est exclu : la barre d'onglets pose son propre décalage, et
            l'ajouter ici la ferait flotter au-dessus du bord. */}
        <ZoneSure>
          <FrontiereDErreur>
            {session.etat === 'connecte' ? (
              <Navigation role={session.utilisateur.role} />
            ) : (
              <AuthScreen motif={session.motif} />
            )}
          </FrontiereDErreur>
        </ZoneSure>
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

/**
 * L'écran de configuration manquante.
 *
 * Volontairement **non traduit** : il s'adresse à qui installe l'application,
 * pas à qui l'utilise, et il doit rester lisible même si le catalogue de
 * traduction n'a pas chargé. Il nomme la variable et le fichier — c'est la
 * seule chose utile à quelqu'un qui le voit.
 */
function ConfigurationManquante() {
  return (
    <View
      testID="ecran-configuration-manquante"
      style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 12 }}
    >
      <Text style={{ fontSize: 18, fontWeight: '600' }}>Configuration incomplète</Text>
      <Text>
        EXPO_PUBLIC_API_URL est absente. Renseignez-la dans app/.env, puis relancez le
        serveur Expo — les variables EXPO_PUBLIC_ sont inlinées à la compilation.
      </Text>
      <Text style={{ fontFamily: 'monospace' }}>
        EXPO_PUBLIC_API_URL=http://localhost:8010/api/v1
      </Text>
    </View>
  );
}

export default function App() {
  // Avant tout fournisseur : sans adresse, la session ne peut rien tenter, et
  // laisser la coquille démarrer produirait l'erreur de connexion qu'on
  // cherche précisément à ne plus afficher.
  if (!API_URL) {
    return (
      <SafeAreaProvider>
        <ConfigurationManquante />
      </SafeAreaProvider>
    );
  }

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
