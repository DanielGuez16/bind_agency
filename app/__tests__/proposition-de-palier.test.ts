/**
 * La proposition de palier : une règle, pas une mise en page.
 *
 * La plateforme situe une prestation à partir de son prix **et de sa place dans
 * son catalogue** — un soin à 90 dollars est haut de gamme chez un barbier et
 * courant dans un spa. Le commerce garde la main ; l'écran lui dit seulement ce
 * qu'il risque en s'écartant.
 *
 * Rien n'est écrit en base. Ce qui est éprouvé ici, ce sont les trois façons
 * dont un conseil peut mentir : proposer sans distribution à lire, séparer deux
 * prix identiques, et se tromper de sens sur l'écart.
 */
import {
  PRIX_MINIMUM_POUR_PROPOSER,
  ecartAuConseil,
  motDuPalier,
  palierRetenu,
  propositionsDuCatalogue,
} from '../src/screens/propositionDePalier';

const prix = (id: string, price_cents: number) => ({ id, price_cents });

describe('la proposition', () => {
  it('situe chaque prestation par son rang, pas par une somme absolue', () => {
    const proposees = propositionsDuCatalogue([
      prix('a', 2_000),
      prix('b', 5_000),
      prix('c', 12_000),
    ]);

    expect(proposees.get('a')).toBe('story');
    expect(proposees.get('b')).toBe('post');
    expect(proposees.get('c')).toBe('reel');
  });

  it('donne le même palier à deux prix identiques', () => {
    // Sans cette précaution, deux manucures à 45 dollars tomberaient de part et
    // d'autre d'une frontière selon leur ordre d'arrivée en base — et le
    // commerce lirait deux conseils contradictoires sur deux lignes identiques.
    const proposees = propositionsDuCatalogue([
      prix('a', 4_500),
      prix('b', 4_500),
      prix('c', 9_000),
      prix('d', 1_000),
    ]);

    expect(proposees.get('a')).toBe(proposees.get('b'));
  });

  it('ne propose rien sous trois prix distincts', () => {
    // Il n'y a pas de distribution à lire dans deux prix, et conseiller quand
    // même reviendrait à inventer.
    expect(propositionsDuCatalogue([prix('a', 1_000), prix('b', 9_000)]).size).toBe(0);
    // Ni dans dix lignes au même tarif : le nombre de lignes ne fait pas une
    // échelle, c'est le nombre de prix **différents** qui la fait.
    const memePrix = Array.from({ length: 10 }, (_, i) => prix(String(i), 5_000));
    expect(propositionsDuCatalogue(memePrix).size).toBe(0);
    expect(PRIX_MINIMUM_POUR_PROPOSER).toBe(3);
  });

  it('couvre les trois paliers sur un catalogue réaliste', () => {
    // Le défaut qu'on ne voit pas : un découpage qui tasserait tout le
    // catalogue sur un ou deux paliers laisserait le troisième sans emploi.
    const catalogue = [1_500, 2_500, 3_500, 4_500, 6_000, 8_000, 12_000, 20_000].map((p, i) =>
      prix(String(i), p),
    );
    const obtenus = new Set(propositionsDuCatalogue(catalogue).values());

    expect([...obtenus].sort()).toEqual(['post', 'reel', 'story']);
  });

  it('met la prestation la plus chère au palier le plus exigeant', () => {
    const catalogue = [1_000, 2_000, 3_000, 4_000, 90_000].map((p, i) => prix(String(i), p));
    expect(propositionsDuCatalogue(catalogue).get('4')).toBe('reel');
    expect(propositionsDuCatalogue(catalogue).get('0')).toBe('story');
  });
});

describe('l’écart au conseil', () => {
  it('nomme le sens de l’écart, qui ne dit pas la même chose des deux côtés', () => {
    // Un palier trop haut coûte des créatrices ; un palier trop bas donne de la
    // valeur contre peu d'engagement. Confondre les deux rendrait le message
    // inutile dans un cas sur deux.
    expect(ecartAuConseil('story', 'reel')).toEqual({
      forme: 'plus-exigeant',
      propose: 'story',
      retenu: 'reel',
    });
    expect(ecartAuConseil('reel', 'story')).toEqual({
      forme: 'moins-exigeant',
      propose: 'reel',
      retenu: 'story',
    });
  });

  it('se tait quand il n’y a rien à comparer', () => {
    expect(ecartAuConseil('post', 'post')).toEqual({ forme: 'conforme' });
    expect(ecartAuConseil(undefined, 'post')).toEqual({ forme: 'sans-avis' });
    expect(ecartAuConseil('post', undefined)).toEqual({ forme: 'sans-avis' });
  });
});

describe('le palier retenu', () => {
  it('prend le plus exigeant quand une prestation en porte plusieurs', () => {
    // C'est lui qui fixe la barre d'entrée, donc le nombre de créatrices
    // concernées — la seule chose que l'écart cherche à mesurer.
    expect(palierRetenu(['story', 'reel', 'post'])).toBe('reel');
    expect(palierRetenu(['story'])).toBe('story');
    expect(palierRetenu([])).toBeUndefined();
  });
});

describe('le mot du palier', () => {
  it('vient des jetons, et n’est jamais abrégé', () => {
    // Une seconde table finirait par dire autre chose que le badge posé juste
    // à côté.
    expect(motDuPalier('post', 'en')).toBe('POST');
    expect(motDuPalier('post', 'es')).toBe('PUBLICACIÓN');
    expect(motDuPalier('post', 'de')).toBe('POST');
  });
});
