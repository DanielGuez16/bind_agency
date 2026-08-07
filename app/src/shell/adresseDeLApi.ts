/**
 * Où joindre l'API.
 *
 * **Elle se déduit du serveur qui sert déjà le bundle.** Le téléphone vient de
 * télécharger son code depuis la machine de développement : cette machine a
 * forcément une adresse joignable, et c'est la même que celle de l'API. La
 * demander une seconde fois dans un fichier, à la main, ouvrait deux façons de
 * se tromper — écrire `localhost`, qui désigne le téléphone lui-même, ou
 * laisser une adresse d'hier après un changement de réseau. Les deux se
 * présentent à l'identique : « Network request failed », sans rien dire de la
 * cause.
 *
 * **`EXPO_PUBLIC_API_URL` reste maîtresse quand elle est posée.** Elle sert aux
 * cas que la déduction ne couvre pas : une API sur une autre machine, un
 * tunnel, un environnement distant. Ce n'est plus la voie normale.
 *
 * **Le port ne se déduit pas.** Le bundler écoute sur 8081, l'API sur 8010 :
 * rien dans l'un ne dit l'autre. Il vient de la configuration, avec la valeur
 * du dépôt par défaut.
 *
 * **Aucune adresse trouvée reste une erreur explicite.** Un repli sur
 * `localhost` marcherait sur la machine de développement et produirait ailleurs
 * exactement l'échec qu'on cherche à supprimer.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Le port de l'API. Celui du dépôt, changeable par configuration. */
const PORT = process.env.EXPO_PUBLIC_API_PORT ?? '8010';

/**
 * L'hôte du serveur de développement Expo, sans son port.
 *
 * Deux sources, parce qu'aucune ne couvre les deux plateformes.
 *
 * Sur le web, `hostUri` est nul — vérifié dans un navigateur, l'écran d'erreur
 * s'affichait à la place de la connexion. Mais la page sait d'où elle vient :
 * `location.hostname` **est** le serveur qui a servi le bundle. C'est la source
 * la plus sûre des deux, on la prend d'abord.
 *
 * Sur un appareil, il n'y a pas de `location`, et `hostUri` vaut
 * `192.168.4.54:8081` — l'adresse de la machine de développement, joignable par
 * construction puisque le téléphone vient d'y télécharger son code.
 *
 * Les deux manquent dans une application compilée, où il n'y a pas de serveur
 * de développement : là, `EXPO_PUBLIC_API_URL` est le seul chemin.
 */
function hoteDuBundler(): string | null {
  // Nommer la plateforme plutôt que de tester l'absence de `location` : React
  // Native ne la définit pas aujourd'hui, mais un paquet tiers qui la
  // polyfillerait ferait pointer le téléphone vers lui-même.
  if (Platform.OS === 'web') return globalThis.location?.hostname || null;

  const brut =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    null;
  if (!brut) return null;

  // `192.168.4.54:8081` → `192.168.4.54`. Une IPv6 entre crochets est rendue
  // telle quelle : y couper au premier deux-points la tronquerait.
  const hote = brut.startsWith('[') ? brut.slice(0, brut.indexOf(']') + 1) : brut.split(':')[0];
  return hote || null;
}

/** L'adresse complète de l'API, préfixe compris, ou `null` si introuvable. */
export function adresseDeLApi(): string | null {
  const declaree = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (declaree) return declaree;

  const hote = hoteDuBundler();
  return hote ? `http://${hote}:${PORT}/api/v1` : null;
}

/** D'où vient l'adresse. Affiché dans les réglages, pour que le doute se lève. */
export function origineDeLAdresse(): 'configuration' | 'serveur de développement' | 'aucune' {
  if (process.env.EXPO_PUBLIC_API_URL?.trim()) return 'configuration';
  return hoteDuBundler() ? 'serveur de développement' : 'aucune';
}
