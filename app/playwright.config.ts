/**
 * Tests de bout en bout, dans un vrai navigateur.
 *
 * **Le trou que ce fichier comble.** Jest rend l'application dans un arbre
 * simulé : les doubles y répondent ce qu'on leur fait dire, et rien n'y charge
 * de police, ne joue de vidéo, ni ne mesure une fenêtre. Trois défauts n'ont
 * été trouvés que par l'œil de quelqu'un qui ouvrait l'app — la vidéo
 * d'accueil qui ne démarrait pas, les polices jamais chargées, la barre
 * latérale jamais montée au-delà du seuil. Aucun n'était visible d'un test
 * unitaire, et aucun ne l'aurait jamais été.
 *
 * **Ce qui tourne ici est le build web réel**, exporté par Metro, servi en
 * statique, parlant à une vraie API sur une vraie base. Pas un double.
 *
 * **Un seul navigateur, et c'est Chrome.** Ajouter Firefox et WebKit
 * triplerait la durée pour éprouver le même code : ce qu'on cherche ici n'est
 * pas une différence de moteur, c'est ce que le nôtre fait de notre
 * application. Le jour où un défaut viendra d'un moteur, on ajoutera celui-là.
 *
 * **Chrome et non le Chromium fourni**, parce que ce dernier est la version
 * libre : elle n'embarque pas les codecs propriétaires, et n'a donc pas H.264.
 * La vidéo d'accueil y répond `MEDIA_ELEMENT_ERROR: Format error` — sur une
 * machine de développement elle joue, parce que le système prête son décodeur,
 * et en intégration continue non. Le test aurait mesuré la compilation du
 * navigateur au lieu de notre code. Chrome est aussi ce que les gens ouvrent.
 */
import { defineConfig, devices } from '@playwright/test';

/** Où l'API écoute. La même valeur sert au build et aux tests. */
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8010';
/** Où le build exporté est servi. */
const PORT = Number(process.env.E2E_WEB_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  // Deux minutes : le premier chargement compile un bundle d'un mégaoctet et
  // demi, et la CI n'a pas la machine d'un développeur.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // **Aucune reprise.** Un test de bout en bout qui ne passe qu'à la seconde
  // tentative est un test instable, et le masquer par une reprise le rendrait
  // inutile — c'est précisément l'instabilité qu'on veut voir.
  retries: 0,
  // Un seul worker : les parcours écrivent dans la même base, et deux
  // réservations concurrentes sur le même créneau se disputeraient la place.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // La trace du premier échec, et rien de plus : elle pèse quelques
    // mégaoctets, et en garder une par test remplirait les artefacts.
    trace: 'retain-on-failure',
    video: 'off',
    // Miami. Le fil se calcule autour de cette position, et sans elle il
    // n'affiche rien — ce qui ferait échouer la réservation pour une raison
    // qui n'a rien à voir avec elle.
    geolocation: { longitude: -80.1918, latitude: 25.7617 },
    permissions: ['geolocation'],
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },

  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: {
          args: [
            // Sans lui, Chromium refuse la lecture automatique même en muet,
            // et le test de la vidéo mesurerait la politique du navigateur
            // plutôt que notre code.
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],

  // Le build est produit avant, par la commande de lancement : l'exporter ici
  // rendrait chaque exécution de test dépendante d'un bundler de trois
  // minutes.
  // **`serve` est une devDependency, et l'appel est local.** Il était lancé par
  // `npx --yes serve`, donc téléchargé depuis npm à chaque exécution, sous ce
  // plafond de 120 s. Une lenteur du registre rendait alors la CI rouge sur du
  // code juste, sous « Timed out waiting from config.webServer » — un message
  // qui ne parle ni de npm ni du réseau, et qui accuse la dernière ligne
  // écrite.
  //
  // Mesuré plutôt que supposé : `main`, à un commit dont l'e2e était vert, a
  // échoué deux fois de suite à la relance, puis est repassé vert une heure
  // plus tard sans qu'une ligne bouge. Node est épinglé par `.nvmrc` et `serve`
  // n'avait pas été publié depuis six mois — restait le téléchargement.
  //
  // `npx` sans `--yes` prend maintenant le binaire de `node_modules`, que
  // `setup-node` restaure déjà de son cache. Plus aucun appel au registre au
  // moment des tests.
  webServer: {
    command: `npx serve --no-clipboard --single --listen ${PORT} dist-e2e`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  metadata: { api: API },
});
