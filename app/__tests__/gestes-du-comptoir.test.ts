/**
 * Quels états appellent un geste au comptoir.
 *
 * **Le décor énumère les sept états, pas les deux qu'on avait en tête.** La
 * carte écrivait `status !== 'consumed'` — une liste noire d'un seul élément —
 * et un test qui n'aurait vérifié que `consumed` et `awaiting_business` aurait
 * passé le défaut : les quatre autres états terminaux tombaient dans le bloc
 * « accorder / refuser », et le salon lisait ces deux boutons sur une
 * réservation annulée ou dont l'absence était constatée.
 */
import { aDesGestes } from '../src/screens/JourneeScreen';

const TOUS = [
  'held',
  'awaiting_business',
  'confirmed',
  'consumed',
  'cancelled',
  'no_show',
  'expired',
] as const;

describe('les gestes du comptoir', () => {
  it('sont offerts sur les deux états qui en appellent, et sur eux seuls', () => {
    const avec = TOUS.filter((status) => aDesGestes(status as never));

    expect(avec).toEqual(['awaiting_business', 'confirmed']);
  });

  it('et jamais sur un état terminal, quel qu’il soit', () => {
    // Nommés un par un : c'est la liste que la version fautive laissait passer,
    // `consumed` excepté. Un `expect(avec).toEqual` seul dirait la même chose
    // aujourd'hui et ne dirait pas *lesquels* le jour où il tombe.
    for (const fini of ['consumed', 'cancelled', 'no_show', 'expired', 'held'] as const) {
      expect(aDesGestes(fini as never)).toBe(false);
    }
  });
});
