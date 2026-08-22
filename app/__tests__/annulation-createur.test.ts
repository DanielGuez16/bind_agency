/**
 * Ce qu'une annulation coûte, et ce qui le décide.
 *
 * **Le premier cas est celui qui diverge.** L'implémentation qu'on redoute est
 * « il y a un créneau et il approche, donc ça peut coûter » : elle est
 * plausible, elle suit l'intuition, et elle est fausse. `no_show` n'est
 * atteignable que depuis `confirmed`. Une réservation que le salon n'a pas
 * encore acceptée, à une heure du rendez-vous, reste libre — c'est le seul
 * décor où les deux implémentations rendent un verdict différent, et il est
 * écrit en premier pour cette raison.
 */
import type { ReservationDuCreateur } from '../src/api';
import { porteeDeLAnnulation } from '../src/screens/reservations/annulation';

const DANS_UNE_HEURE = new Date(Date.now() + 3600_000).toISOString();
const DANS_UNE_SEMAINE = new Date(Date.now() + 7 * 86_400_000).toISOString();

function reservation(extra: Partial<ReservationDuCreateur>): ReservationDuCreateur {
  return {
    booking_id: 'r1',
    status: 'confirmed',
    starts_at: DANS_UNE_SEMAINE,
    ...extra,
  } as unknown as ReservationDuCreateur;
}

describe('la portée d’une annulation', () => {
  it('reste libre quand le salon n’a pas encore accepté, même à une heure du rendez-vous', () => {
    expect(
      porteeDeLAnnulation(
        reservation({ status: 'awaiting_business', starts_at: DANS_UNE_HEURE }),
      ),
    ).toBe('libre');
  });

  it('reste libre sur une place seulement tenue', () => {
    expect(
      porteeDeLAnnulation(reservation({ status: 'held', starts_at: DANS_UNE_HEURE })),
    ).toBe('libre');
  });

  it('reste libre sur une confirmée sans créneau : rien à manquer', () => {
    expect(
      porteeDeLAnnulation(reservation({ status: 'confirmed', starts_at: null })),
    ).toBe('libre');
  });

  it('peut coûter sur une confirmée avec créneau, quelle que soit sa distance', () => {
    // Loin comme près : l'écran ne connaît pas le seuil, et prétendre le
    // connaître serait recopier un réglage.
    expect(
      porteeDeLAnnulation(reservation({ status: 'confirmed', starts_at: DANS_UNE_SEMAINE })),
    ).toBe('peut-couter');
    expect(
      porteeDeLAnnulation(reservation({ status: 'confirmed', starts_at: DANS_UNE_HEURE })),
    ).toBe('peut-couter');
  });

  it.each(['consumed', 'cancelled', 'no_show', 'expired'])(
    'ne propose rien sur une ligne close : %s',
    (statut) => {
      expect(porteeDeLAnnulation(reservation({ status: statut as never }))).toBe('close');
    },
  );
});
