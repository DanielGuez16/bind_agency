// AsyncStorage n'existe pas hors appareil : la bibliothèque fournit son propre
// double, c'est celui-là qu'il faut brancher plutôt que d'en écrire un.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Sans appareil, aucune langue système à détecter. Les tests qui portent sur la
// détection la contrôlent eux-mêmes ; ailleurs, le repli anglais suffit.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));
