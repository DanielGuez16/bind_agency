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

// Un lecteur vidéo ne démarre pas hors appareil, et l'accueil en monte un dès
// la première image. Le double rend ce qu'on lui demande de lire — c'est la
// seule chose qu'un test ait à vérifier ici, et `accueil.test.tsx` s'en sert
// pour éprouver le choix d'orientation.
jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source) => ({ source, loop: false, muted: false }),
    VideoView: ({ player, testID }) =>
      require('react').createElement(View, {
        testID,
        accessibilityLabel: player?.source ?? 'aucune',
      }),
  };
});
