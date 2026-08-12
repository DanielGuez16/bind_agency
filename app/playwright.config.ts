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
 * **Un seul navigateur, Chromium.** Ajouter Firefox et WebKit triplerait la
 * durée pour éprouver le même code : ce qu'on cherche ici n'est pas une
 * différence de moteur, c'est ce que le nôtre fait de notre application. Le
 * jour où un défaut viendra d'un moteur, on ajoutera celui-là.
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
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
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
  webServer: {
    command: `npx --yes serve --no-clipboard --single --listen ${PORT} dist-e2e`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  metadata: { api: API },
});
