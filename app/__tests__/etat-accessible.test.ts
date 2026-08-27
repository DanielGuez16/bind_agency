/**
 * L'état d'un contrôle arrive-t-il au DOM.
 *
 * **Le décor porte sur ce qui est rendu, pas sur ce qui est écrit.** C'est toute
 * la leçon du défaut qui a motivé cette fonction : les tests du cœur lisaient
 * `props.accessibilityState` — la valeur telle qu'écrite — et passaient des deux
 * côtés d'un état que le web n'annonçait à personne.
 */
import { etatAccessible } from '../src/components/etatAccessible';

describe('l’état accessible', () => {
  it('pose les deux : l’objet pour le natif, l’attribut pour le web', () => {
    // Sans `aria-checked`, cette version de React Native Web ne rend rien :
    // `createDOMProps` ne lit pas `accessibilityState`.
    expect(etatAccessible({ checked: true })).toEqual({
      accessibilityState: { checked: true },
      'aria-checked': true,
    });
  });

  it('et porte `false` aussi, qui est une réponse', () => {
    // **Le cas qui diverge d'une implémentation par valeur vraie.** « Non
    // coché » n'est pas « pas de case » : un lecteur d'écran doit pouvoir dire
    // que le cœur est vide, sinon l'absence d'annonce se confond avec l'absence
    // de contrôle.
    expect(etatAccessible({ checked: false })['aria-checked']).toBe(false);
    expect(etatAccessible({ selected: false })['aria-selected']).toBe(false);
  });

  it('traduit les cinq états, et chacun sur son attribut', () => {
    const rendu = etatAccessible({
      checked: true,
      selected: false,
      expanded: true,
      disabled: false,
      busy: true,
    });

    expect(rendu['aria-checked']).toBe(true);
    expect(rendu['aria-selected']).toBe(false);
    expect(rendu['aria-expanded']).toBe(true);
    expect(rendu['aria-disabled']).toBe(false);
    expect(rendu['aria-busy']).toBe(true);
  });

  it('mais n’invente aucun attribut pour un état non déclaré', () => {
    // Un `aria-checked` vide sur un bouton qui n'est pas un interrupteur se fait
    // annoncer par certains lecteurs. Une clé absente ne doit rien produire.
    const rendu = etatAccessible({ selected: true });

    expect('aria-checked' in rendu).toBe(false);
    expect('aria-expanded' in rendu).toBe(false);
    expect(Object.keys(rendu).sort()).toEqual(['accessibilityState', 'aria-selected']);
  });
});
