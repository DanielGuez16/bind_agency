/**
 * Les trois règles que Design a tranchées, et qui ne sont pas décoratives.
 *
 * Chacune existe parce que sans elle deux choses de l'écran se confondent. Ce
 * sont donc des tests d'identité, pas de mise en page : ils disent « ces deux
 * choses doivent rester distinctes », et c'est ce qui se perd en premier quand
 * quelqu'un uniformise.
 */
import { CYCLE } from '../src/screens/mur/cycle';
import {
  accentDe,
  CORPS_OU_LA_PRESTATION_TOMBE,
  HAUTEURS,
  porteLApercuDeGalerie,
  typographieDe,
  voileDe,
  VOILE,
} from '../src/screens/mur/regles';

describe('le texte descend avec le format', () => {
  it.each([
    ['heros', 28],
    ['herosGalerie', 28],
    ['bande', 22],
    ['duo', 19],
    ['triptyque', 15],
  ] as const)('%s porte un nom de %i', (format, corps) => {
    expect(typographieDe(format).nom).toBe(corps);
  });

  it('et la prestation tombe au plus petit, pour que le nom reste seul', () => {
    // « Un triptyque ne porte jamais trois lignes. » À 158 points, un quartier,
    // un nom et une prestation empilés ne laissent plus voir l'image.
    expect(typographieDe('triptyque')).toEqual({ nom: 15, avecPrestation: false });
    expect(typographieDe('duo').avecPrestation).toBe(true);
  });

  it('le seuil est celui du plus petit format, pas un nombre en l’air', () => {
    // Le sens inverse : si quelqu'un descendait le duo à 15, il perdrait sa
    // prestation sans qu'on ait rien décidé. Le seuil et l'échelle sont liés.
    expect(CORPS_OU_LA_PRESTATION_TOMBE).toBe(typographieDe('triptyque').nom);
  });

  it('l’échelle suit la largeur laissée au texte, pas la hauteur du bloc', () => {
    // **C'est ce qui surprend en lisant les valeurs**, et ce test existe pour
    // que la surprise ne passe pas pour une erreur : la bande fait 150 de haut
    // et porte 22, le duo en fait 238 et ne porte que 19. La bande est large de
    // tout l'écran ; le duo le coupe en deux.
    //
    // L'ordre est donc : salons de front d'abord, hauteur pour départager.
    const porteurs = CYCLE.filter((position) => position.salons > 0);
    const parPlace = [...porteurs].sort(
      (a, b) => a.salons - b.salons || b.hauteur - a.hauteur,
    );

    let precedent = Infinity;
    for (const position of parPlace) {
      const corps = typographieDe(
        position.format as Exclude<typeof position.format, 'respiration'>,
      ).nom;
      expect({ format: position.format, decroit: corps <= precedent }).toEqual({
        format: position.format,
        decroit: true,
      });
      precedent = corps;
    }

    // Et le sens inverse, nommé : trier par hauteur seule **ne** donne pas
    // l'échelle. Si un jour c'était le cas, la règle aurait changé.
    const parHauteur = [...porteurs].sort((a, b) => b.hauteur - a.hauteur);
    expect(parHauteur.map((p) => p.format)).not.toEqual(parPlace.map((p) => p.format));
  });

  it('la respiration ne se voit pas demander une typographie de nom', () => {
    // Elle ne porte aucun salon. Rendre 15 par défaut donnerait un nom sur un
    // panneau qui n'en a pas — un défaut silencieux plutôt qu'une erreur.
    expect(() => typographieDe('respiration')).toThrow(/respiration/i);
  });
});

describe('une seule chose orange par photo', () => {
  it('la distance porte l’orange quand il n’y a pas de reel', () => {
    expect(accentDe('story')).toEqual({ badgeEnOrange: false, distanceEnOrange: true });
    expect(accentDe('post')).toEqual({ badgeEnOrange: false, distanceEnOrange: true });
  });

  it('et le badge le prend quand il y en a un, la distance s’efface', () => {
    expect(accentDe('reel')).toEqual({ badgeEnOrange: true, distanceEnOrange: false });
  });

  it('jamais les deux, quel que soit le format de contenu', () => {
    // **Le sens qui compte.** Deux aplats de marque sur la même image se
    // disputent l'œil, et la photo cesse d'avoir un point d'entrée. C'est la
    // règle du bloc accentué transposée : un mur en porterait vingt sans borne.
    for (const contenu of ['story', 'post', 'reel', 'inconnu']) {
      const accent = accentDe(contenu);
      expect({ contenu, deux: accent.badgeEnOrange && accent.distanceEnOrange }).toEqual({
        contenu,
        deux: false,
      });
      // Et jamais zéro non plus : la photo garde un point d'entrée.
      expect({ contenu, aucun: !accent.badgeEnOrange && !accent.distanceEnOrange }).toEqual({
        contenu,
        aucun: false,
      });
    }
  });
});

describe('le voile de la bande est à l’horizontale, et lui seul', () => {
  it('la bande prend le voile de gauche', () => {
    // C'est le seul format assez court pour que le texte doive vivre à côté de
    // l'image plutôt que dessous : à 150 points, un voile du bas mangerait la
    // moitié de la hauteur pour loger deux lignes.
    expect(voileDe('bande')).toBe('gauche');
    expect(HAUTEURS.bande).toBe(150);
  });

  it.each(['heros', 'herosGalerie', 'duo', 'triptyque'] as const)(
    '%s garde le voile du bas',
    (format) => {
      expect(voileDe(format)).toBe('bas');
    },
  );

  it('et la bande est bien le plus court des formats porteurs', () => {
    // Si un format devenait plus court qu'elle sans prendre le voile
    // horizontal, la règle ne s'appliquerait plus à ce qu'elle vise.
    const porteurs = CYCLE.filter((position) => position.salons > 0);
    const plusCourt = porteurs.reduce((a, b) => (a.hauteur <= b.hauteur ? a : b));
    expect(plusCourt.format).toBe('bande');
  });

  it('les deux voiles vont dans des sens opposés, du plein vers le vide', () => {
    // Un voile qui partirait du vide vers le plein éclaircirait le texte au
    // lieu de le poser.
    expect(VOILE.bas[0]).toBeLessThan(VOILE.bas[2]);
    expect(VOILE.gauche[0]).toBeGreaterThan(VOILE.gauche[2]);
  });
});

describe('l’aperçu de galerie distingue les deux héros', () => {
  it('la position 4 le porte, la position 1 non', () => {
    // **Sans lui, les deux héros se confondraient** — 520 et 470, l'œil ne
    // fait pas la différence, et le cycle donnerait l'impression de répéter un
    // format au lieu d'en tenir six.
    expect(porteLApercuDeGalerie('herosGalerie')).toBe(true);
    expect(porteLApercuDeGalerie('heros')).toBe(false);
  });

  it('et aucun autre format ne le porte', () => {
    for (const position of CYCLE) {
      expect({
        format: position.format,
        apercu: porteLApercuDeGalerie(position.format),
      }).toEqual({ format: position.format, apercu: position.format === 'herosGalerie' });
    }
  });

  it('les deux héros restent assez proches pour que la règle serve', () => {
    // Le sens inverse : si l'écart des hauteurs devenait franc, l'aperçu ne
    // serait plus ce qui les distingue et la règle perdrait sa raison — il
    // faudrait alors la rediscuter, pas la garder par habitude.
    const ecart = Math.abs(HAUTEURS.heros - HAUTEURS.herosGalerie);
    expect(ecart).toBeLessThan(HAUTEURS.heros * 0.2);
  });
});
