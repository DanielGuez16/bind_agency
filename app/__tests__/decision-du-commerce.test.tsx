/**
 * La journée du comptoir, quand le commerce doit trancher.
 *
 * **Deux actions qui se ressemblent et ne se valent pas.** Se désister d'une
 * réservation acceptée ne pénalise personne ; constater une absence inscrit un
 * événement négatif au dossier de la créatrice. Elles passent par deux routes
 * distinctes, et ce fichier vérifie que l'écran appelle la bonne — la confusion
 * ne se verrait nulle part ailleurs qu'au score de quelqu'un, des semaines plus
 * tard.
 *
 * **Un motif obligatoire se vérifie sur l'écran, pas seulement au serveur.** Un
 * champ qu'on peut valider vide fait partir une requête pour recevoir un 422 :
 * l'écran doit refuser avant, et retirer le bouton plutôt que le griser.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { JourneeScreen } from '../src/screens/JourneeScreen';

const coffre = { lire: async () => null, ecrire: async () => {} };

/** Ce que l'app a envoyé : chemin et corps, dans l'ordre. */
const envois: { chemin: string; corps: unknown }[] = [];

/**
 * Les heures sont **relatives à maintenant**, pas écrites en dur.
 *
 * Une date figée finit par passer, et le jour où elle passe c'est l'écran qui
 * paraît cassé : il refusait d'offrir l'accord parce que le rendez-vous était
 * derrière nous, ce qui est exactement le bon comportement.
 */
const dansUneHeure = new Date(Date.now() + 3_600_000).toISOString();
const ilYAUneHeure = new Date(Date.now() - 3_600_000).toISOString();

const RESERVATIONS = [
  {
    booking_id: 'attente-1',
    status: 'awaiting_business',
    starts_at: dansUneHeure,
    valid_until: dansUneHeure,
    item_name: 'Gel manicure',
    creator_first_name: 'Rebecca',
    creator_last_name: null,
    creator_handle: 'rebecca.miami',
  },
  {
    booking_id: 'confirmee-1',
    status: 'confirmed',
    starts_at: dansUneHeure,
    valid_until: dansUneHeure,
    item_name: 'Brushing',
    creator_first_name: 'Sofia',
    creator_last_name: null,
    creator_handle: 'sofia.brickell',
  },
];

function client() {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, init) => {
      const chemin = String(url);
      if (init?.method && init.method !== 'GET') {
        envois.push({ chemin, corps: JSON.parse(String(init.body ?? '{}')) });
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jour: '2026-08-08',
          timezone: 'America/New_York',
          debut: '2026-08-08T12:00:00Z',
          fin: '2026-08-09T00:00:00Z',
          items: RESERVATIONS.filter((r) => r.status !== 'awaiting_business'),
          // La file vient du serveur, toutes dates confondues.
          a_trancher: RESERVATIONS.filter((r) => r.status === 'awaiting_business'),
        }),
      } as Response;
    },
  });
}

async function monter() {
  const vue = render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={client()}>
          <JourneeScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('a-trancher')).toBeTruthy());
  return vue;
}

beforeEach(() => {
  envois.length = 0;
});

it('met ce qui attend une décision devant le planning', async () => {
  await monter();

  // Une réservation en attente tient une place et bloque une créatrice qui ne
  // peut rien faire d'autre que patienter. La laisser dans l'ordre des heures
  // la ferait découvrir en la cherchant.
  expect(screen.getByTestId('decision-attente-1')).toBeTruthy();
  // Et la confirmée reste dans le planning, pas dans le bloc de décision.
  expect(screen.queryByTestId('decision-confirmee-1')).toBeNull();
  expect(screen.getByTestId('reservation-confirmee-1')).toBeTruthy();
});

it('accorde sans demander de motif', async () => {
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('accorder-attente-1'));
  });

  await waitFor(() => expect(envois).toHaveLength(1));
  expect(envois[0].chemin).toContain('/bookings/attente-1/approve');
  // Il n'y a rien à justifier à dire oui.
  expect(envois[0].corps).toEqual({});
});

it('ne laisse pas refuser sans motif lisible', async () => {
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('refuser-attente-1'));
  });
  // Le bouton d'envoi est **absent**, pas grisé : un bouton grisé demande de
  // deviner ce qui le débloque.
  expect(screen.queryByTestId('refuser-attente-1-valider')).toBeNull();

  await act(async () => {
    await fireEvent.changeText(screen.getByTestId('refuser-attente-1-champ'), 'no');
  });
  expect(screen.queryByTestId('refuser-attente-1-valider')).toBeNull();
  expect(envois).toHaveLength(0);

  await act(async () => {
    await fireEvent.changeText(
      screen.getByTestId('refuser-attente-1-champ'),
      'planning complet ce jour-là',
    );
  });
  expect(screen.getByTestId('refuser-attente-1-valider')).toBeTruthy();
});

it('refuse avec le motif saisi, tel quel', async () => {
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('refuser-attente-1'));
  });
  await act(async () => {
    await fireEvent.changeText(
      screen.getByTestId('refuser-attente-1-champ'),
      '  technicienne absente  ',
    );
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('refuser-attente-1-valider'));
  });

  await waitFor(() => expect(envois).toHaveLength(1));
  expect(envois[0].chemin).toContain('/bookings/attente-1/decline');
  // Détouré, jamais reformulé : c'est la créatrice qui le lit.
  expect(envois[0].corps).toEqual({ reason: 'technicienne absente' });
});

it('se désiste par la route qui ne pénalise pas', async () => {
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('desister-confirmee-1'));
  });
  await act(async () => {
    await fireEvent.changeText(
      screen.getByTestId('desister-confirmee-1-champ'),
      'fermeture imprévue',
    );
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('desister-confirmee-1-valider'));
  });

  await waitFor(() => expect(envois).toHaveLength(1));
  // **Jamais `/no-show`.** L'une des deux inscrit un événement négatif au
  // dossier de la créatrice, l'autre non.
  expect(envois[0].chemin).toContain('/bookings/confirmee-1/cancel-by-business');
  expect(envois[0].chemin).not.toContain('no-show');
});

it('traduit le statut au lieu d’afficher son code', async () => {
  await monter();

  // `awaiting_business` affiché tel quel se lisait comme une chaîne oubliée,
  // parce que c'en était une.
  expect(screen.getByText(new RegExp(en.commerce.statut_confirmed))).toBeTruthy();
  expect(screen.queryByText(/awaiting_business/)).toBeNull();
});

it('ne propose plus d’accepter une demande dont l’heure est passée', async () => {
  // Il est 11 h 35, la demande porte sur 10 h 45. Accepter produirait une
  // réservation confirmée pour un rendez-vous qui n'aura pas lieu, et un code
  // de retrait pour un créneau écoulé.
  RESERVATIONS[0].starts_at = ilYAUneHeure;
  RESERVATIONS[0].valid_until = ilYAUneHeure;
  try {
    await monter();

    expect(screen.getByTestId('depassee-attente-1')).toBeTruthy();
    expect(screen.queryByTestId('accorder-attente-1')).toBeNull();
    // Refuser reste offert : un commerce qui répond en retard dit quand même
    // ce qu'il en était, et la créatrice lit son motif.
    expect(screen.getByTestId('refuser-attente-1')).toBeTruthy();
  } finally {
    RESERVATIONS[0].starts_at = dansUneHeure;
    RESERVATIONS[0].valid_until = dansUneHeure;
  }
});
