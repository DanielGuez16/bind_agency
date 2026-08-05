/**
 * Le preset jest-expo définit déjà `setupFiles` — deux fichiers indispensables,
 * celui de React Native et celui d'Expo. Déclarer `setupFiles` dans
 * `package.json` les remplace au lieu de s'y ajouter, et casse silencieusement
 * l'environnement. On étend explicitement.
 */
const preset = require('jest-expo/jest-preset');

module.exports = {
  ...preset,
  setupFiles: [...preset.setupFiles, '<rootDir>/jest.env.js'],
  setupFilesAfterEnv: [...(preset.setupFilesAfterEnv ?? []), '<rootDir>/jest.setup.js'],
};
