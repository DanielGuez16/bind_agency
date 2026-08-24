/**
 * Ce que le salon a composé, et ce que les créatrices en voient.
 *
 * **« Douze dont trois éteintes n'est pas la même composition que douze
 * visibles, et c'est la moitié qu'on oublie. »** C'était la raison d'être du
 * résumé de composition, sous la table des matières que la v3.1 retire.
 *
 * **Le décor divergent est la gamme.** Une implémentation qui compte tous les
 * articles rend un nombre plausible — treize au lieu de douze — et personne ne
 * le vérifie : le parent d'une gamme ne se réserve pas et ne s'affiche jamais
 * seul. C'est le seul cas où « compter les articles » et « compter les
 * prestations » divergent, et il est écrit en premier.
 */
import type { ItemDuCatalogue } from '../src/api';
import { resumeDuCatalogue } from '../src/screens/catalogue/resume';

function item(extra: Partial<ItemDuCatalogue>): ItemDuCatalogue {
  return {
    id: 'i1',
    parent_item_id: null,
    is_available: true,
    is_effectively_available: true,
    archived_at: null,
    ...extra,
  } as ItemDuCatalogue;
}

describe('le résumé compte des prestations, pas des articles', () => {
  it('le parent d’une gamme n’en est pas une', () => {
    // Il ne se réserve pas et ne s'affiche jamais seul : le compter donnerait
    // « trois prestations » à un salon qui en propose deux.
    const resume = resumeDuCatalogue([
      item({ id: 'gamme' }),
      item({ id: 'v1', parent_item_id: 'gamme' }),
      item({ id: 'v2', parent_item_id: 'gamme' }),
    ]);

    expect(resume).toEqual({ prestations: 2, visibles: 2 });
  });

  it('une éteinte compte comme prestation, pas comme visible', () => {
    const resume = resumeDuCatalogue([
      item({ id: 'a' }),
      item({ id: 'b', is_available: false, is_effectively_available: false }),
      item({ id: 'c' }),
    ]);

    expect(resume).toEqual({ prestations: 3, visibles: 2 });
  });

  it('une variante dont le parent est fermé n’est pas visible, malgré son interrupteur', () => {
    /**
     * **`is_effectively_available` et non `is_available`.** C'est le cas qu'on
     * croit ouvert : la variante porte son propre interrupteur à vrai, son
     * parent est fermé, et elle n'apparaît nulle part. Une implémentation qui
     * lit l'interrupteur propre annonce « visible » ce que personne ne voit.
     */
    const resume = resumeDuCatalogue([
      item({ id: 'gamme', is_available: false, is_effectively_available: false }),
      item({
        id: 'v1',
        parent_item_id: 'gamme',
        is_available: true,
        is_effectively_available: false,
      }),
    ]);

    expect(resume).toEqual({ prestations: 1, visibles: 0 });
  });

  it('une archive ne compte nulle part', () => {
    // Elle n'est plus proposée du tout : la compter ferait grossir un
    // catalogue qu'on vient de réduire.
    const resume = resumeDuCatalogue([
      item({ id: 'a' }),
      item({ id: 'b', archived_at: '2026-08-01T00:00:00Z', is_effectively_available: false }),
    ]);

    expect(resume).toEqual({ prestations: 1, visibles: 1 });
  });

  it('un catalogue vide rend deux zéros, et non un vide', () => {
    expect(resumeDuCatalogue([])).toEqual({ prestations: 0, visibles: 0 });
  });
});
