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
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider, useApi } from './src/api';
import { I18nProvider } from './src/i18n';
import { AuthScreen } from './src/screens/AuthScreen';
import { PriseEnMainScreen } from './src/screens/PriseEnMainScreen';
import { SessionProvider, coffreSecurise, themeDuRole, useSession } from './src/session';
import { FrontiereDErreur } from './src/shell/FrontiereDErreur';
import { prenomDe } from './src/components';
import { BienvenueScreen } from './src/screens/BienvenueScreen';
import { Navigation } from './src/shell/Navigation';
import { adresseDeLApi } from './src/shell/adresseDeLApi';
import { jetonDePriseEnMain, oublierLeJeton } from './src/shell/jetonDePriseEnMain';
import { GabaritProvider } from './src/shell/gabarit';
import { useNotificationsPush } from './src/shell/useNotificationsPush';
import { ZoneSure } from './src/shell/ZoneSure';
import { ThemeProvider, policesAcharger, useColors } from './src/theme';

/**
 * L'adresse de l'API, déduite du serveur qui a servi le bundle.
 *
 * Voir `adresseDeLApi` : le téléphone vient de télécharger son code depuis la
 * machine de développement, laquelle héberge aussi l'API. La redemander à la
 * main ouvrait deux façons de se tromper — `localhost`, qui désigne le
 * téléphone, et une adresse d'hier après un changement de réseau.
 */
const API_URL = adresseDeLApi();

/** Le client compose les chemins complets, préfixe compris. */
const BASE_URL = (API_URL ?? '').replace(/\/api\/v1\/?$/, '');

function Coquille() {
  const session = useSession();
  /**
   * **Le jeton, lu une seule fois à l'ouverture.**
   *
   * Relu à chaque rendu, il ferait revenir l'écran de prise en main par-dessus
   * l'application du gérant qui vient de s'y connecter. `useState` avec une
   * fonction d'initialisation est ce qui le fige au premier rendu.
   */
  const [jetonDeReprise, setJetonDeReprise] = useState(jetonDePriseEnMain);

  if (session.etat === 'retablissement') {
    return <Patience />;
  }

  // Anonyme : le thème créateur, qui est le thème par défaut du produit.
  const role = session.etat === 'connecte' ? session.utilisateur.role : 'creator';

  return (
    <ThemeProvider role={themeDuRole(role)}>
      <ApiProvider client={session.client}>
        {/* **L'autorisation se demande une fois connecté, jamais avant.** Une
            autorisation réclamée sur le premier écran se refuse, et une fois
            refusée elle ne se redemande plus — la position l'a appris à nos
            dépens. Ici, il y a des réservations à suivre : la demande a un
            sens. */}
        <JetonDeNotification actif={session.etat === 'connecte'} />
        <StatusBar style="auto" />
        {/* **La zone sûre est traitée ici, une fois.** Chaque écran qui s'en
            occuperait produirait un oubli quelque part, et l'oubli se voit sur
            un appareil à encoche : le titre passe dessous et se coupe.

            `bottom` est exclu : la barre d'onglets pose son propre décalage, et
            l'ajouter ici la ferait flotter au-dessus du bord. */}
        <ZoneSure>
          {/* La mesure vient **sous** la zone sûre : ce que la coquille a
              vraiment à sa disposition, encoches déduites. */}
          <GabaritProvider>
            <FrontiereDErreur>
            {jetonDeReprise ? (
              /* **Avant la porte d'authentification, et c'est le point.** Le
                 gérant arrive par un lien et n'a pas de compte : lui montrer
                 un écran de connexion serait lui demander ce que le lien
                 existe pour lui éviter. */
              <PriseEnMainScreen
                jeton={jetonDeReprise}
                onTermine={() => {
                  oublierLeJeton();
                  setJetonDeReprise(null);
                }}
              />
            ) : session.etat !== 'connecte' ? (
              <AuthScreen motif={session.motif} />
            ) : session.vientDeSInscrire ? (
              // **Une fois, juste après l'inscription.** Le fil et les paliers
              // portent le même message de façon durable ; celui-ci arrive
              // avant qu'on ait pu croire le produit cassé.
              <BienvenueScreen onPlusTard={session.accueilVu} onRattache={session.accueilVu} />
            ) : (
              <Navigation
                role={session.utilisateur.role}
                prenom={prenomDe(session.utilisateur.email)}
              />
            )}
            </FrontiereDErreur>
          </GabaritProvider>
        </ZoneSure>
      </ApiProvider>
    </ThemeProvider>
  );
}

/**
 * Réaffirme le jeton de ce terminal auprès du serveur.
 *
 * Un composant sans rendu plutôt qu'un appel dans `Sous` : le hook a besoin du
 * client d'API, que seul un enfant de `ApiProvider` peut lire.
 */
function JetonDeNotification({ actif }: { actif: boolean }) {
  const { api } = useApi();
  useNotificationsPush(api, actif);
  return null;
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
        backgroundColor: c['bg.page'],
      }}
    >
      <ActivityIndicator color={c['ink.soft']} />
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
      <Text style={{ fontSize: 18, fontWeight: '600' }}>Adresse de l'API introuvable</Text>
      <Text>
        Aucun serveur de développement Expo n'a été détecté, et EXPO_PUBLIC_API_URL n'est pas
        renseignée. Dans une application compilée, cette variable est le seul chemin :
        renseignez-la dans app/.env, puis relancez le serveur — les variables EXPO_PUBLIC_ sont
        inlinées à la compilation.
      </Text>
      <Text style={{ fontFamily: 'monospace' }}>
        EXPO_PUBLIC_API_URL=http://192.168.1.20:8010/api/v1
      </Text>
    </View>
  );
}

export default function App() {
  /**
   * Les fontes du système, avant le premier texte.
   *
   * **Elles n'étaient pas chargées du tout** : les jetons nommaient trois
   * familles, `Texte` les demandait, et aucun fichier n'existait dans le dépôt.
   * Tout le produit rendait donc en police système.
   *
   * **On attend qu'elles soient là avant de rendre.** Rendre en système puis
   * basculer ferait sauter chaque ligne de l'écran d'accueil au premier
   * affichage — le décalage se voit d'autant plus que Grotesk et SF Pro n'ont
   * ni la même chasse ni la même hauteur d'x.
   *
   * **Un échec de chargement ne bloque pas l'application.** `useFonts` rend
   * l'erreur plutôt que de lever ; on démarre alors en police système, ce qui
   * est laid mais utilisable. Une application qui refuse de s'ouvrir parce
   * qu'une fonte manque serait un défaut plus grave que celui qu'on corrige.
   */
  const [policesPretes, echecDesPolices] = useFonts(policesAcharger());

  if (!policesPretes && !echecDesPolices) {
    return (
      <SafeAreaProvider>
        <Patience />
      </SafeAreaProvider>
    );
  }

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
