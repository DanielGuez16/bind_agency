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
const dansUneSemaine = new Date(Date.now() + 7 * 86_400_000).toISOString();

const RESERVATIONS = [
  {
    booking_id: 'attente-1',
    status: 'awaiting_business',
    starts_at: dansUneHeure,
    valid_until: dansUneHeure,
    // L'échéance d'accord vaut le délai plein **borné par le créneau** : avec
    // un rendez-vous dans une heure, c'est l'heure du rendez-vous.
    approval_expires_at: dansUneHeure,
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

/**
 * La file que le serveur rendra au prochain montage.
 *
 * Une variable plutôt qu'un filtre figé : certains cas ont besoin d'une demande
 * dont l'échéance est passée, et remonter tout le décor pour une date serait
 * recopier le montage à côté de lui-même.
 */
let fileDuJour: (typeof RESERVATIONS)[number][] = [];

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
          a_trancher: fileDuJour,
        }),
      } as Response;
    },
  });
}

async function monter() {
  const vue = await render(
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

/** Monte l'écran avec une file choisie plutôt qu'avec celle du décor. */
async function monterAvec(file: (typeof RESERVATIONS)[number][]) {
  fileDuJour = file;
  return monter();
}

beforeEach(() => {
  envois.length = 0;
  fileDuJour = RESERVATIONS.filter((r) => r.status === 'awaiting_business');
});

it('met ce qui attend une décision devant le planning', async () => {
  await monter();

  // Une réservation en attente tient une place et bloque une créatrice qui ne
  // peut rien faire d'autre que patienter. La laisser dans l'ordre des heures
  // la ferait découvrir en la cherchant.
  //
  // Vérifié sur **la place** et non plus sur une carte distincte : depuis la
  // campagne 2, la colonne n'a qu'un registre, et ce qui attend se signale par
  // sa section et sa pastille, pas par un relief propre.
  const file = screen.getByTestId('a-trancher');
  expect(file).toContainElement(screen.getByTestId('reservation-attente-1'));
  // Et la confirmée reste dans le planning, pas dans la file.
  expect(file).not.toContainElement(screen.getByTestId('reservation-confirmee-1'));
  expect(screen.getByTestId('planning')).toContainElement(
    screen.getByTestId('reservation-confirmee-1'),
  );
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
  //
  // **`approval_expires_at` suit le créneau, et le décor doit le refléter.** Le
  // serveur borne l'échéance d'accord par `starts_at` : un rendez-vous passé ne
  // peut pas porter une échéance à venir. Ce test reculait les deux autres
  // dates en laissant l'échéance devant, ce qui décrivait une réservation que
  // le serveur ne produit jamais.
  //
  // Il mutait aussi le décor partagé, avec un `finally` pour le remettre — un
  // montage explicite dit la même chose sans laisser de trace entre les tests.
  await monterAvec([
    {
      ...RESERVATIONS[0],
      starts_at: ilYAUneHeure,
      valid_until: ilYAUneHeure,
      approval_expires_at: ilYAUneHeure,
    },
  ]);

  expect(screen.getByTestId('depassee-attente-1')).toBeTruthy();
  expect(screen.queryByTestId('accorder-attente-1')).toBeNull();
  // Refuser reste offert : un commerce qui répond en retard dit quand même
  // ce qu'il en était, et la créatrice lit son motif.
  expect(screen.getByTestId('refuser-attente-1')).toBeTruthy();
});

it('distingue ce qui est derrière de ce qui reste à faire', async () => {
  // Une absence et un rendez-vous de 15 h se lisaient identiques : deux lignes
  // de texte, même poids, même couleur. Le mot d'état porte le sens, la teinte
  // ne fait que l'appuyer — jamais l'inverse.
  RESERVATIONS[1].status = 'no_show';
  try {
    await monter();

    expect(screen.getByTestId('statut-confirmee-1')).toHaveTextContent(
      en.commerce.statut_no_show,
    );
  } finally {
    RESERVATIONS[1].status = 'confirmed';
  }
});

it('donne un vrai état vide à une journée sans rendez-vous', async () => {
  // Une journée vide est une information, pas une page qui n'a pas chargé.
  const vide = new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          jour: '2026-08-09',
          timezone: 'America/New_York',
          debut: '',
          fin: '',
          items: [],
          a_trancher: [],
        }),
      }) as Response,
  });

  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={vide}>
          <JourneeScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );

  // **Le cercle a disparu, le titre reste.** Il ne disait rien et occupait la
  // place de ce qu'on vient lire ; c'est le titre qui porte l'information.
  await waitFor(() => expect(screen.getByTestId('journee-vide')).toBeTruthy());
  expect(screen.getByText(en.commerce.journeeVideTitre)).toBeTruthy();
  expect(screen.queryByTestId('journee-vide-halo')).toBeNull();
});


it("dit jusqu'à quand la décision reste possible", async () => {
  /**
   * **Rien ne le disait, et il n'y avait rien à dire.** Aucun délai n'existait
   * côté serveur : une demande posée trois semaines à l'avance pouvait dormir
   * trois semaines en tenant la place. Maintenant qu'il existe, le commerce doit
   * le lire là où il décide — pas dans un écran d'aide que personne n'ouvre.
   */
  await monter();

  expect(screen.getByTestId('echeance-decision-attente-1')).toBeTruthy();
  expect(screen.getByText(en.commerce.decisionAvantAide)).toBeTruthy();
});

it("dit au commerce ce qu'il risque à donner sans contrepartie immédiate", async () => {
  /**
   * **Le moment exact où le doute se pose.** Le commerce s'apprête à donner une
   * prestation contre une promesse. Que le manquement coûte quelque chose est
   * vrai — `unfulfilled` pèse −30 au dossier de la créatrice — et c'était
   * construit sans que rien ne le lui dise.
   */
  await monter();

  expect(screen.getByTestId('garantie-score-attente-1')).toBeTruthy();
  expect(screen.getByText(en.commerce.decisionSiElleNePubliePas)).toBeTruthy();
});

it("ne promet plus rien quand l'échéance est passée", async () => {
  /**
   * **L'autre sens.** Un écran qui afficherait toujours l'échéance et la
   * garantie passerait les deux tests ci-dessus sans rien garantir — et
   * proposerait de décider là où il n'y a plus rien à décider.
   */
  await monterAvec([
    { ...RESERVATIONS[0], starts_at: ilYAUneHeure, approval_expires_at: ilYAUneHeure },
  ]);

  expect(screen.queryByTestId('echeance-decision-attente-1')).toBeNull();
  expect(screen.queryByTestId('garantie-score-attente-1')).toBeNull();
  expect(screen.getByTestId('depassee-attente-1')).toBeTruthy();
});

it("ferme la décision quand le délai est passé, même si le créneau est loin", async () => {
  /**
   * **Le cas qui motive tout le changement, et le seul qui sépare les deux
   * dates.** Un rendez-vous la semaine prochaine, un délai de réponse écoulé
   * depuis une heure. L'écran lisait `starts_at` : il proposait donc encore
   * d'accepter six jours durant, sur une demande que le serveur a déjà fait
   * expirer — un bouton qui part chercher un refus.
   *
   * Sans ce test, remplacer `approval_expires_at` par `starts_at` ne casse
   * rien : dans tous les autres décors les deux dates coïncident.
   */
  await monterAvec([
    {
      ...RESERVATIONS[0],
      starts_at: dansUneSemaine,
      valid_until: dansUneSemaine,
      approval_expires_at: ilYAUneHeure,
    },
  ]);

  expect(screen.getByTestId('depassee-attente-1')).toBeTruthy();
  expect(screen.queryByTestId('accorder-attente-1')).toBeNull();
});
