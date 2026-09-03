/**
 * Quel navigateur, sur quel OS — la fonction pure derrière la correction.
 *
 * **Le défaut trouvé à l'audit.** `Platform.OS === 'web'` ne distingue rien :
 * Safari sur iPhone et Chrome sur un ordinateur de bureau rendent tous deux
 * `'web'`, et le message envoyé décrivait un cadenas de bureau à quelqu'un
 * qui regardait Safari mobile — l'icône qui n'existe pas là où il regarde.
 * C'est exactement ce que Rebecca a reçu.
 *
 * Chaque cas ici est un agent utilisateur réel, pas inventé : copié depuis un
 * appareil ou une documentation de plateforme, jamais une chaîne qui ressemble
 * à ce qu'on imagine qu'un navigateur envoie.
 */
import { plateformeWeb } from '../src/shell/plateformeWeb';

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1';

const FIREFOX_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15';

const SAFARI_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

const CHROME_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Depuis iPadOS 13, Safari s'y présente **littéralement comme ce même Mac**
 * — même agent utilisateur qu'un vrai Mac de bureau sous Safari.
 */
const SAFARI_MAC_OU_IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('plateformeWeb', () => {
  it('reconnaît Safari sur iPhone — le cas de Rebecca', () => {
    expect(plateformeWeb(SAFARI_IPHONE)).toBe('ios_safari');
  });

  it('distingue Chrome et Firefox sur iOS de Safari', () => {
    // Le même moteur WebKit qu'impose Apple, mais un réglage de site
    // ailleurs que l'icône « Aa » de Safari — le message ne doit pas
    // promettre une icône que ce navigateur-ci n'a pas.
    expect(plateformeWeb(CHROME_IPHONE)).toBe('ios_autre');
    expect(plateformeWeb(FIREFOX_IPHONE)).toBe('ios_autre');
  });

  it('reconnaît un iPad par son agent utilisateur direct', () => {
    expect(plateformeWeb(SAFARI_IPAD)).toBe('ios_safari');
  });

  it('reconnaît un iPad qui se présente comme un Mac depuis iPadOS 13', () => {
    // Un vrai Mac de bureau n'a pas d'écran tactile ; c'est le seul signal
    // qui reste pour distinguer les deux une fois l'agent utilisateur
    // identique. `macTactile` porte ce calcul, fait une fois par
    // `plateformeWebCourante` — ici on le donne directement, la fonction
    // reste pure.
    expect(plateformeWeb(SAFARI_MAC_OU_IPAD, true)).toBe('ios_safari');
    expect(plateformeWeb(SAFARI_MAC_OU_IPAD, false)).toBe('desktop');
  });

  it('reconnaît Android', () => {
    expect(plateformeWeb(CHROME_ANDROID)).toBe('android');
  });

  it('retombe sur desktop pour le reste', () => {
    expect(plateformeWeb(CHROME_DESKTOP)).toBe('desktop');
  });
});
