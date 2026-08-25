/**
 * Ce qui fait que l'application s'installe sur un écran d'accueil.
 *
 * **Trois fichiers doivent s'accorder, et rien ne les tient ensemble.** Le
 * manifeste déclare des couleurs et des icônes ; le gabarit HTML déclare le
 * manifeste et pose un fond ; l'écran de chargement peint le sien. Chacun est
 * juste séparément et l'ensemble peut être faux : une icône déclarée en 512 et
 * livrée en 192 s'installe quand même, en flou, et personne ne le voit avant
 * d'avoir un téléphone en main.
 *
 * **Ce que ces tests ne peuvent pas éprouver**, et il faut le dire ici plutôt
 * que le laisser croire : qu'iOS accepte réellement l'installation, et que la
 * barre de Safari ne revienne pas. Cela demande un appareil. Ce qui est
 * éprouvable est que chaque déclaration corresponde au fichier qu'elle nomme,
 * et c'est justement ce qui se casse en silence.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import jetons from '../src/theme/tokens.json';

const PUBLIC = join(__dirname, '..', 'public');

type Manifeste = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

const manifeste: Manifeste = JSON.parse(
  readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'),
);
const gabarit = readFileSync(join(PUBLIC, 'index.html'), 'utf8');

/** Les dimensions d'un PNG, lues dans son en-tête — huit octets, aucune dépendance. */
function dimensions(fichier: string): { largeur: number; hauteur: number } {
  const octets = readFileSync(join(PUBLIC, fichier));
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

describe('le manifeste', () => {
  it('demande le plein écran, sans barre de navigateur', () => {
    // C'est la seule ligne qui distingue un site rangé sur l'écran d'accueil
    // d'une application installée. `browser` et `minimal-ui` gardent la barre.
    expect(manifeste.display).toBe('standalone');
  });

  it('couvre toute l’application, et démarre à la porte', () => {
    // **La portée décide du retour de la barre.** Une navigation hors de
    // `scope` rouvre Safari par-dessus l'application — c'est le mécanisme, et
    // c'est pourquoi la racine est la seule valeur juste ici : le produit sert
    // tous ses écrans depuis la même origine.
    expect(manifeste.scope).toBe('/');
    expect(manifeste.start_url).toBe('/');
  });

  it('porte un nom court, celui qui tient sous l’icône', () => {
    // Onze caractères environ avant que le système coupe. « BIND » y tient.
    expect(manifeste.short_name).toBe('BIND');
    expect(manifeste.short_name.length).toBeLessThanOrEqual(12);
  });

  it('ne prend aucune couleur que les jetons ne déclarent pas', () => {
    // **L'écran de lancement est de l'encre**, comme l'écran de chargement
    // qu'il précède d'un dixième de seconde : c'est ce qui fait qu'on ne voit
    // pas la couture. La teinte du système, elle, est la surface de la page —
    // c'est elle qui touche la barre d'état une fois l'application ouverte.
    expect(manifeste.background_color.toUpperCase()).toBe(jetons.color.bg.inverse);
    expect(manifeste.theme_color.toUpperCase()).toBe(jetons.color.bg.page);
  });

  it('déclare deux tailles pleines et une masquable', () => {
    const parUsage = manifeste.icons.map((i) => `${i.sizes} ${i.purpose}`);
    expect(parUsage).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
  });

  it.each([
    ['/icone-192.png', 192],
    ['/icone-512.png', 512],
    ['/icone-masquable-512.png', 512],
  ])('%s existe et fait bien la taille annoncée', (src, cote) => {
    // **Le cas qui motive ce test.** Une icône déclarée 512 et livrée 192
    // s'installe : le système l'agrandit, et la marque est floue sur l'écran
    // d'accueil. Rien d'autre ne le dit — ni le build, ni le navigateur.
    const fichier = src.replace(/^\//, '');
    expect(existsSync(join(PUBLIC, fichier))).toBe(true);
    expect(dimensions(fichier)).toEqual({ largeur: cote, hauteur: cote });
  });

  it('et chaque icône déclarée est un fichier du dépôt, pas une adresse', () => {
    // Une icône distante ne se charge pas au moment de l'installation hors
    // ligne, et c'est le moment où le système la fixe.
    for (const icone of manifeste.icons) expect(icone.src.startsWith('/')).toBe(true);
  });
});

describe('le gabarit du site', () => {
  it('annonce le manifeste, qu’aucune convention ne trouve', () => {
    // Le favicon et l'icône d'iOS se demandent par convention ; le manifeste,
    // non. Sans cette ligne il n'y a pas d'installation du tout.
    expect(gabarit).toContain('rel="manifest" href="/manifest.webmanifest"');
  });

  it('demande le plein écran à iOS aussi, qui ne lit pas toujours le manifeste', () => {
    // Safari ne lit `display` qu'à partir d'iOS 16.4. Les deux orthographes
    // coexistent : l'ancienne est ignorée là où la nouvelle est comprise.
    expect(gabarit).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(gabarit).toContain('name="mobile-web-app-capable" content="yes"');
  });

  it('laisse la barre d’état opaque, et donc rien sous elle', () => {
    // **`black-translucent` ferait passer la page sous l'heure et la batterie**
    // sans `viewport-fit=cover` ni marges lues dans `env(safe-area-inset-*)`.
    // Ce test tient les deux ensemble : si quelqu'un passe au translucide, il
    // doit aussi poser le `viewport-fit`, et c'est ici qu'il l'apprendra.
    const translucide = gabarit.includes('content="black-translucent"');
    expect(translucide ? gabarit.includes('viewport-fit=cover') : true).toBe(true);
    expect(gabarit).toContain('name="apple-mobile-web-app-status-bar-style"');
  });

  it('pose l’encre sous l’application, pour qu’aucun blanc ne passe avant', () => {
    // **Le premier rendu arrive après le bundle.** Entre l'ouverture et lui, on
    // voit le fond du document : blanc par défaut, c'est-à-dire un éclair blanc
    // à chaque lancement depuis l'écran d'accueil, juste avant un écran de
    // chargement à l'encre. Les trois couleurs doivent coïncider.
    expect(gabarit).toMatch(/background-color:\s*#17140f/i);
    expect(manifeste.background_color.toUpperCase()).toBe('#17140F');
    expect(jetons.color.bg.inverse).toBe('#17140F');
  });

  it('garde ce qu’Expo pose et dont la mise en page dépend', () => {
    // **Ce fichier remplace un gabarit généré**, et ce qu'il oublie disparaît
    // du build. `#root` en colonne pleine hauteur est ce qui donne sa hauteur à
    // l'application entière ; sans lui, tous les écrans se replient sur leur
    // contenu.
    expect(gabarit).toContain('id="root"');
    expect(gabarit).toMatch(/#root\s*\{[^}]*height:\s*100%/);
    expect(gabarit).toMatch(/html,\s*body\s*\{[^}]*height:\s*100%/);
  });
});
