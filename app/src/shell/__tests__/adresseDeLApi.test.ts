/**
 * La déduction de l'adresse de l'API.
 *
 * Chaque cas correspond à un échec observé, pas à une branche du code : une
 * adresse fausse ne se voit qu'à l'exécution, sous un « Network request
 * failed » qui ne dit ni où ni pourquoi.
 */
/**
 * `expo-constants` expose `expoConfig` en accesseur non redéfinissable : le
 * module entier se remplace, sinon `defineProperty` refuse.
 */
const mockConstants: { expoConfig: unknown; expoGoConfig: unknown } = {
  expoConfig: null,
  expoGoConfig: null,
};
jest.mock('expo-constants', () => ({ __esModule: true, default: mockConstants }));

/**
 * Recharge le module sous une plateforme donnée.
 *
 * `resetModules` rend aussi un `react-native` neuf : poser `Platform.OS` sur
 * l'exemplaire importé en haut de fichier ne se voit pas depuis le module
 * rechargé, et le test du web passait sur la branche de l'appareil.
 */
const relire = (os: 'ios' | 'web' = 'ios') => {
  jest.resetModules();
  (require('react-native') as typeof import('react-native')).Platform.OS = os;
  return require('../adresseDeLApi') as typeof import('../adresseDeLApi');
};

function poserHostUri(valeur: string | null) {
  mockConstants.expoConfig = valeur === null ? null : { hostUri: valeur };
  mockConstants.expoGoConfig = null;
}

const variables = { ...process.env };

beforeEach(() => {
  process.env = { ...variables };
  delete process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_API_PORT;
  poserHostUri(null);
});

afterEach(() => {
  process.env = variables;
});

describe('sur un appareil', () => {
  it("prend l'adresse de la machine qui a servi le bundle, pas le téléphone", () => {
    poserHostUri('192.168.4.54:8081');
    // Le port du bundler est remplacé par celui de l'API : rien dans l'un ne
    // dit l'autre.
    expect(relire().adresseDeLApi()).toBe('http://192.168.4.54:8010/api/v1');
  });

  it('garde une IPv6 entière', () => {
    poserHostUri('[fe80::1]:8081');
    // Couper au premier deux-points rendrait `http://[fe80` : injoignable, et
    // le message d'erreur ne parlerait que de réseau.
    expect(relire().adresseDeLApi()).toBe('http://[fe80::1]:8010/api/v1');
  });

  it('lit `debuggerHost` quand Expo Go ne remplit pas `hostUri`', () => {
    mockConstants.expoConfig = null;
    mockConstants.expoGoConfig = { debuggerHost: '10.0.0.7:8081' };
    expect(relire().adresseDeLApi()).toBe('http://10.0.0.7:8010/api/v1');
  });

  it("ignore l'origine de la page, même si un paquet tiers en pose une", () => {
    poserHostUri('192.168.4.54:8081');
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: 'localhost' },
      configurable: true,
    });
    try {
      // `localhost` depuis un téléphone désigne le téléphone.
      expect(relire().adresseDeLApi()).toBe('http://192.168.4.54:8010/api/v1');
    } finally {
      delete (globalThis as { location?: unknown }).location;
    }
  });
});

describe('sur le web', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: 'localhost' },
      configurable: true,
    });
  });

  afterEach(() => delete (globalThis as { location?: unknown }).location);

  it("prend l'origine de la page, là où `hostUri` est nul", () => {
    // Vérifié dans un navigateur : sans cette branche, l'écran de connexion
    // était remplacé par « Adresse de l'API introuvable ».
    poserHostUri(null);
    expect(relire('web').adresseDeLApi()).toBe('http://localhost:8010/api/v1');
  });
});

describe('la variable de configuration', () => {
  it("l'emporte sur la déduction", () => {
    poserHostUri('192.168.4.54:8081');
    process.env.EXPO_PUBLIC_API_URL = 'https://api.exemple.test/api/v1';
    expect(relire().adresseDeLApi()).toBe('https://api.exemple.test/api/v1');
  });

  it("vide, laisse la déduction faire — sinon un `.env` à moitié rempli casse tout", () => {
    poserHostUri('192.168.4.54:8081');
    process.env.EXPO_PUBLIC_API_URL = '   ';
    expect(relire().adresseDeLApi()).toBe('http://192.168.4.54:8010/api/v1');
  });

  it('déplace le port sans toucher à la déduction de l’hôte', () => {
    poserHostUri('192.168.4.54:8081');
    process.env.EXPO_PUBLIC_API_PORT = '9000';
    expect(relire().adresseDeLApi()).toBe('http://192.168.4.54:9000/api/v1');
  });
});

it("sans rien pour déduire, rend `null` plutôt que de replier sur localhost", () => {
  // Un repli marcherait sur la machine de développement et produirait
  // ailleurs exactement l'échec qu'on cherche à supprimer. `null` fait
  // afficher un écran qui nomme la variable.
  poserHostUri(null);
  expect(relire().adresseDeLApi()).toBeNull();
});

describe("l'origine annoncée dans les réglages", () => {
  it('nomme les trois cas', () => {
    poserHostUri(null);
    expect(relire().origineDeLAdresse()).toBe('aucune');

    poserHostUri('192.168.4.54:8081');
    expect(relire().origineDeLAdresse()).toBe('serveur de développement');

    process.env.EXPO_PUBLIC_API_URL = 'https://api.exemple.test/api/v1';
    expect(relire().origineDeLAdresse()).toBe('configuration');
  });
});
