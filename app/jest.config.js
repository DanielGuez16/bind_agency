/**
 * Le preset jest-expo définit déjà `setupFiles` — deux fichiers indispensables,
 * celui de React Native et celui d'Expo. Déclarer `setupFiles` dans
 * `package.json` les remplace au lieu de s'y ajouter, et casse silencieusement
 * l'environnement. On étend explicitement.
 */
const preset = require('jest-expo/jest-preset');

module.exports = {
  ...preset,
  // **Les tests de bout en bout ne sont pas des tests Jest.** Ils s'invoquent
  // par `npx playwright test`, et Jest qui les ramasse échoue avec un message
  // qui parle de Playwright — ce qui est juste, mais fait tomber la suite
  // entière. Deux dossiers, deux exécuteurs.
  testPathIgnorePatterns: [...(preset.testPathIgnorePatterns ?? []), '<rootDir>/e2e/'],
  setupFiles: [...preset.setupFiles, '<rootDir>/jest.env.js'],
  setupFilesAfterEnv: [...(preset.setupFilesAfterEnv ?? []), '<rootDir>/jest.setup.js'],
};
