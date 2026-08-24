/**
 * L'exception du jour : un geste replié, un état déplié.
 *
 * **Le composant n'avait aucun test de comportement.** Sa règle de calcul en
 * avait un — `placesDuJour`, éprouvée à part — mais rien ne disait ce qu'il
 * rend, et la carte a donc pu occuper la tête de l'écran le plus ouvert du
 * produit tous les jours sans que rien ne le signale.
 *
 * Ce qu'il faut tenir est la distinction, celle que le bandeau de mise en ligne
 * applique déjà : un geste disparaît une fois rendu accessible, un état non
 * résolu reste. Un jour fermé ou des places coupées sont un état — le gérant
 * doit le voir sans le chercher, sans quoi il se demande pourquoi sa journée
 * est vide. Une journée qui suit la semaine type est le cas normal, et le cas
 * normal n'occupe rien.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { ExceptionDuJour } from '../src/screens/journee/ExceptionDuJour';
import { ThemeProvider } from '../src/theme';

const coffre = { lire: async () => null, ecrire: async () => {} };

/**
 * Un mardi, choisi pour lui-même.
 *
 * La date est nue et lue à midi UTC par la règle : une date figée est ici sans
 * danger, puisque c'est le **jour de la semaine** qui compte et qu'il ne change
 * pas avec le calendrier. Ce qui changerait le verdict serait un fuseau, et la
 * règle le neutralise déjà.
 */
const MARDI = '2026-08-18';
const REGLE = { weekday: 2, concurrent_slots: 3 };

function clientDe(exceptions: unknown[]) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) => {
      const chemin = String(url);
      const corps = chemin.includes('capacity-exceptions') ? exceptions : [REGLE];
      return { ok: true, status: 200, json: async () => corps } as Response;
    },
  });
}

function monter(exceptions: unknown[] = [], postesEffectifs: number | null = 3) {
  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={clientDe(exceptions)}>
          <ExceptionDuJour
            businessId="b1"
            jour={MARDI}
            postesEffectifs={postesEffectifs}
            onFait={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('quand rien n’est posé', () => {
  it('ne montre qu’un geste, pas une carte', async () => {
    // Cinq lignes et deux contrôles en tête de l'écran du matin, tous les
    // jours, pour une question qu'on se pose rarement.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ajuster-aujourdhui')).toBeTruthy());

    expect(screen.queryByTestId('exception-du-jour')).toBeNull();
    expect(screen.queryByTestId('places-du-jour')).toBeNull();
    expect(screen.queryByTestId('fermer-aujourdhui')).toBeNull();
  });

  it('et la carte vient à la demande', async () => {
    // Le geste reste **atteignable en un appui** : l'exception se décide en
    // marchant, souvent le matin même. La replier ne doit pas l'éloigner.
    await monter();
    await waitFor(() => expect(screen.getByTestId('ajuster-aujourdhui')).toBeTruthy());

    await act(async () => {
      await fireEvent.press(screen.getByTestId('ajuster-aujourdhui'));
    });

    expect(screen.getByTestId('exception-du-jour')).toBeTruthy();
    expect(screen.getByTestId('places-du-jour')).toBeTruthy();
    expect(screen.getByTestId('fermer-aujourdhui')).toBeTruthy();
  });
});

describe('quand une exception est posée', () => {
  it('la carte est là sans qu’on la demande : c’est un état', async () => {
    // **Le cas qui fait diverger les deux implémentations.** Replier toujours
    // passerait les deux tests du dessus tout aussi bien ; c'est ici qu'un
    // gérant se demanderait pourquoi sa journée est vide.
    await monter([{ id: 'e1', date: MARDI, concurrent_slots: 1, is_closed: false }], 1);
    await waitFor(() => expect(screen.getByTestId('exception-du-jour')).toBeTruthy());

    expect(screen.queryByTestId('ajuster-aujourdhui')).toBeNull();
    expect(screen.getByTestId('places-du-jour')).toBeTruthy();
  });

  it('et un jour fermé se voit sans être cherché', async () => {
    await monter([{ id: 'e1', date: MARDI, concurrent_slots: 0, is_closed: true }], 0);
    await waitFor(() => expect(screen.getByTestId('exception-du-jour')).toBeTruthy());

    expect(screen.getByTestId('ferme-aujourdhui')).toBeTruthy();
    expect(screen.queryByTestId('ajuster-aujourdhui')).toBeNull();
  });

  it('même quand elle rend le compte de la semaine', async () => {
    // **`exceptionId`, et non une comparaison de nombres.** Un salon peut poser
    // une exception qui rend trois places là où la semaine en prévoit trois —
    // il l'a posée, elle existe, et la replier la rendrait introuvable. Une
    // implémentation qui comparerait `places` à `dansLaSemaine` replierait ici.
    await monter([{ id: 'e1', date: MARDI, concurrent_slots: 3, is_closed: false }], 3);
    await waitFor(() => expect(screen.getByTestId('exception-du-jour')).toBeTruthy());

    expect(screen.queryByTestId('ajuster-aujourdhui')).toBeNull();
  });
});
