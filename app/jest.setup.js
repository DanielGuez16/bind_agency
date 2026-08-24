/**
 * La marge des attentes asynchrones, et pourquoi elle est là.
 *
 * **Le symptôme :** un fichier rouge par-ci par-là sur la suite complète,
 * jamais le même, jamais reproductible en isolation, toujours un `waitFor` qui
 * expire — jamais une assertion fausse. Deux conversations l'ont vu, sur deux
 * ensembles de fichiers **sans aucun recoupement** : quatre d'un côté, deux de
 * l'autre. C'est ce qui tranche — si c'était une fuite, ce serait toujours les
 * mêmes.
 *
 * **Mesuré :** douze passages de la suite entière, un seul rouge, deux fichiers
 * dedans, et leurs durées gonflées — dix-neuf et trente et une secondes là où
 * ils en mettent une. Ce n'est pas un test qui bloque, c'est toute l'exécution
 * qui ralentit, et le défaut d'usine d'une seconde ne survit pas à ça.
 *
 * **Ce que ça ne coûte pas :** `waitFor` rend la main dès que la condition
 * tient. Une suite verte ne met pas une milliseconde de plus ; seul un test qui
 * échoue vraiment met quatre secondes de plus à le dire, une fois.
 *
 * **Et pourquoi pas plus haut :** au-delà, un test réellement bloqué se
 * confondrait avec un test lent, ce qui est le défaut qu'on vient de retirer,
 * dans l'autre sens.
 */
const { configure } = require('@testing-library/react-native');

configure({ asyncUtilTimeout: 5_000 });

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
  // `useEvent` s'abonne au lecteur : un double sans émetteur fait lever le
  // rendu. Il ne diffuse rien — la vidéo ne joue pas en test, et c'est le cas
  // qu'on veut éprouver, celui où l'affiche reste en place.
  const emetteur = {
    addListener: () => ({ remove: () => {} }),
    removeListener: () => {},
    removeAllListeners: () => {},
  };
  return {
    useVideoPlayer: (source) => ({
      source,
      loop: false,
      muted: false,
      playing: false,
      play: () => {},
      ...emetteur,
    }),
    VideoView: ({ player, testID }) =>
      require('react').createElement(View, {
        testID,
        accessibilityLabel: player?.source ?? 'aucune',
      }),
  };
});

/**
 * Chaque test part d'un appareil sans cache.
 *
 * **Le cache des réponses est de l'état d'appareil, et il survit à un test.**
 * `AsyncStorage` est simulé par un objet de module, partagé par tous les tests
 * d'un même fichier : le premier qui charge un fil range sa réponse, et le
 * suivant — celui qui vérifie l'état de chargement — trouve des données et ne
 * voit jamais son écran de chargement. Cinq tests sont tombés d'un coup à
 * l'arrivée du cache, tous pour cette raison, et aucun ne parlait de cache.
 *
 * Vider avant chaque test rend ce que le produit fait à l'installation : un
 * appareil neuf. Un test qui veut éprouver le cache l'écrit lui-même, ce qui
 * est aussi la seule façon de savoir ce qu'il y met.
 */
beforeEach(async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await (AsyncStorage.default ?? AsyncStorage).clear();
});
