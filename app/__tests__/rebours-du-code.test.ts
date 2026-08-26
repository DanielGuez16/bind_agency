/**
 * Le compte à rebours du code de retrait repart de la cadence entière.
 *
 * **La rotation est calée sur une horloge globale côté serveur** —
 * `timestamp % rotation` —, donc `seconds_remaining` dit le reste de la fenêtre
 * au moment où la requête atterrit. Une relecture faite à l'expiration rendait
 * 28 quand l'aller-retour durait une seconde et demie : le décompte repartait
 * de 28, puis de 29, puis de 30 selon le réseau.
 *
 * **Le décor fait varier la latence, et c'est tout le test.** Avec une réponse
 * instantanée, chaîner l'échéance et la reprendre du réseau donnent le même
 * nombre — les deux implémentations ne divergent que sous latence.
 */
import { prochaineEcheance } from '../src/screens/CodeScreen';

const CADENCE = { rotation_seconds: 30 };
const T0 = 1_800_000_000_000;

describe('l’échéance du code', () => {
  it('vient du serveur à la première lecture, fenêtre en cours comprise', () => {
    // On ouvre l'écran au milieu d'une fenêtre : il reste 12 s, pas 30. Les
    // afficher serait mentir sur la durée de validité du code montré.
    const echeance = prochaineEcheance(null, { ...CADENCE, seconds_remaining: 12 }, 'b1', T0);

    expect(echeance).toBe(T0 + 12_000);
  });

  it('puis se chaîne, donc repart de la cadence entière malgré la latence', () => {
    const premiere = T0 + 30_000;
    // La relecture atterrit 1,5 s après l'expiration : le serveur, calé sur son
    // horloge, ne rend plus que 28.
    const echeance = prochaineEcheance(
      { bookingId: 'b1', expireA: premiere },
      { ...CADENCE, seconds_remaining: 28 },
      'b1',
      premiere + 1_500,
    );

    expect(echeance).toBe(premiere + 30_000);
    // Ce que l'écran affichera : la cadence moins ce qui a été perdu à
    // attendre, et non 28 — le décompte suivant repartira lui aussi de 30.
    expect(Math.ceil((echeance - (premiere + 1_500)) / 1000)).toBe(29);
  });

  it('mais rend la main au serveur sur une autre réservation', () => {
    // La fenêtre de l'ancienne n'a aucun rapport avec la nouvelle.
    const echeance = prochaineEcheance(
      { bookingId: 'b1', expireA: T0 + 30_000 },
      { ...CADENCE, seconds_remaining: 7 },
      'b2',
      T0,
    );

    expect(echeance).toBe(T0 + 7_000);
  });

  it('et quand la chaîne est déjà dans le passé — écran endormi, appel très lent', () => {
    // La chaîner encore ferait tourner le décompte dans le passé, donc
    // relire en boucle serrée.
    const echeance = prochaineEcheance(
      { bookingId: 'b1', expireA: T0 },
      { ...CADENCE, seconds_remaining: 22 },
      'b1',
      T0 + 120_000,
    );

    expect(echeance).toBe(T0 + 120_000 + 22_000);
  });

  it('et jamais zéro, qui ferait redemander en boucle serrée', () => {
    const echeance = prochaineEcheance(null, { ...CADENCE, seconds_remaining: 0 }, 'b1', T0);

    expect(echeance).toBe(T0 + 1_000);
  });
});
