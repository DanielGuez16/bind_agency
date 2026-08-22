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
import {
  delaiAvantLeCreneau,
  porteeDeLAnnulation,
} from '../src/screens/reservations/annulation';

const DANS_UNE_HEURE = new Date(Date.now() + 3600_000).toISOString();
const IL_Y_A_UNE_HEURE = new Date(Date.now() - 3600_000).toISOString();
const DANS_UNE_SEMAINE = new Date(Date.now() + 7 * 86_400_000).toISOString();

function reservation(extra: Partial<ReservationDuCreateur>): ReservationDuCreateur {
  return {
    booking_id: 'r1',
    status: 'confirmed',
    starts_at: DANS_UNE_SEMAINE,
    annulation_sans_frais_jusqu_a: DANS_UNE_HEURE,
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

  it('dans la fenêtre quand l’échéance servie est encore devant', () => {
    expect(
      porteeDeLAnnulation(
        reservation({ status: 'confirmed', annulation_sans_frais_jusqu_a: DANS_UNE_HEURE }),
      ),
    ).toBe('dans-la-fenetre');
  });

  it('passé la fenêtre quand elle est franchie', () => {
    expect(
      porteeDeLAnnulation(
        reservation({ status: 'confirmed', annulation_sans_frais_jusqu_a: IL_Y_A_UNE_HEURE }),
      ),
    ).toBe('passe-la-fenetre');
  });

  it('l’échéance vient du serveur : l’écran ne la recalcule pas de `starts_at`', () => {
    // **Le décor divergent.** Un créneau lointain et une fenêtre déjà close :
    // une implémentation qui déduirait le seuil de `starts_at` — le réglage
    // recopié — dirait « dans la fenêtre ». C'est le cas où les deux
    // divergent, et c'est le seul qui compte.
    expect(
      porteeDeLAnnulation(
        reservation({
          status: 'confirmed',
          starts_at: DANS_UNE_SEMAINE,
          annulation_sans_frais_jusqu_a: IL_Y_A_UNE_HEURE,
        }),
      ),
    ).toBe('passe-la-fenetre');
  });

  it('sans échéance servie sur une confirmée avec créneau : on ne sait pas quand', () => {
    // Se rabattre sur « libre » annoncerait gratuit sur une annulation qui
    // coûte ; nommer une heure qu'on n'a pas serait pire.
    expect(
      porteeDeLAnnulation(
        reservation({ status: 'confirmed', annulation_sans_frais_jusqu_a: null }),
      ),
    ).toBe('sans-echeance');
    const sansLeChamp = {
      status: 'confirmed',
      starts_at: DANS_UNE_SEMAINE,
    } as unknown as ReservationDuCreateur;
    expect(porteeDeLAnnulation(sansLeChamp)).toBe('sans-echeance');
  });

  it('une échéance illisible ne vaut pas « franchie »', () => {
    // Annoncer que la fenêtre s'est fermée sur une date qu'on n'a pas su lire
    // ferait renoncer quelqu'un qui pouvait encore annuler librement.
    expect(
      porteeDeLAnnulation(
        reservation({ status: 'confirmed', annulation_sans_frais_jusqu_a: 'pas une date' }),
      ),
    ).toBe('sans-echeance');
  });

  it.each(['consumed', 'cancelled', 'no_show', 'expired'])(
    'ne propose rien sur une ligne close : %s',
    (statut) => {
      expect(porteeDeLAnnulation(reservation({ status: statut as never }))).toBe('close');
    },
  );
});

/**
 * Le seul nombre que l'écran affiche, et ce n'est pas le coût.
 *
 * **Il dit ce que prévenir donne au salon**, et il est rendu comme un fait :
 * « ça leur laisse trois heures » est vrai à trois heures **et** à cinq
 * minutes, là où « trois heures leur suffisent pour la remplir » devient faux
 * en approchant. Le seuil qui aurait départagé les deux phrases n'existe pas,
 * et l'écrire en dur serait un délai de plus dans le code.
 */
describe('ce que prévenir laisse au salon', () => {
  const MAINTENANT = Date.parse('2026-08-22T14:00:00Z');
  const dans = (ms: number) => new Date(MAINTENANT + ms).toISOString();

  it('rend les heures et les minutes, séparément', () => {
    expect(delaiAvantLeCreneau(dans(3 * 3_600_000 + 26 * 60_000), MAINTENANT)).toEqual({
      heures: 3,
      minutes: 26,
    });
  });

  it('sous l’heure, il n’y a pas d’heures', () => {
    expect(delaiAvantLeCreneau(dans(5 * 60_000), MAINTENANT)).toEqual({
      heures: 0,
      minutes: 5,
    });
  });

  it('un créneau passé ou à l’instant ne laisse rien', () => {
    // Une phrase qui annoncerait un délai négatif ferait douter du reste.
    expect(delaiAvantLeCreneau(dans(-60_000), MAINTENANT)).toBeNull();
    expect(delaiAvantLeCreneau(dans(0), MAINTENANT)).toBeNull();
  });

  it('sans créneau, ou sur une date illisible, il ne laisse rien non plus', () => {
    expect(delaiAvantLeCreneau(null, MAINTENANT)).toBeNull();
    expect(delaiAvantLeCreneau(undefined, MAINTENANT)).toBeNull();
    expect(delaiAvantLeCreneau('pas une date', MAINTENANT)).toBeNull();
  });
});
