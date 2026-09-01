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
    // Le serveur le calcule sur le créneau, quel que soit le statut : une
    // demande encore en attente en porte une, et l'omettre du décor rendrait la
    // fabrique moins fidèle que le serveur qu'elle imite.
    absence_signalable_a: new Date(Date.now() + 3_600_000 + 20 * 60_000).toISOString(),
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
    // Le rendez-vous est devant nous : l'absence ne se constate pas encore, et
    // l'écran doit dire à partir de quand plutôt que de taire le geste.
    absence_signalable_a: new Date(Date.now() + 3_600_000 + 20 * 60_000).toISOString(),
    item_name: 'Brushing',
    creator_first_name: 'Sofia',
    creator_last_name: null,
    creator_handle: 'sofia.brickell',
  },
];

/**
 * Le planning que le serveur rendra, quand un cas a besoin d'autre chose que le
 * décor. Comme `fileDuJour` : remonter tout le montage pour une heure serait le
 * recopier à côté de lui-même.
 */
const ABSENCE_OUVERTE = {
  booking_id: 'passee-1',
  status: 'confirmed',
  starts_at: ilYAUneHeure,
  valid_until: dansUneHeure,
  // Le délai est écoulé : le geste est ouvert. L'heure vient du serveur, et
  // c'est tout l'objet de ces tests — l'écran ne recopie aucun délai.
  absence_signalable_a: ilYAUneHeure,
  item_name: 'Balayage',
  creator_first_name: 'Camila',
  creator_last_name: null,
  creator_handle: 'camila.wynwood',
};

/**
 * **Le cas qui distingue l'heure du serveur d'un délai recopié.**
 *
 * Le reste du décor posait `absence_signalable_a` à `starts_at + 20 min` — la
 * valeur qu'un écran qui recopierait le réglage calculerait lui-même. Les deux
 * rendaient donc le même verdict, et la mutation qui remplace le champ par un
 * calcul local **passait tous les tests**. Le décor encodait ce qu'il devait
 * éprouver.
 *
 * Ici le créneau a commencé il y a dix minutes et le serveur ouvre l'absence
 * depuis cinq : un délai de vingt recopié dans l'écran la dirait fermée pour dix
 * minutes encore. Les deux lectures se contredisent, et c'est la seule forme qui
 * prouve laquelle l'écran suit.
 */
const DELAI_PLUS_COURT = {
  ...ABSENCE_OUVERTE,
  booking_id: 'delai-court-1',
  starts_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  absence_signalable_a: new Date(Date.now() - 5 * 60_000).toISOString(),
};

/** Un droit sans créneau : il n'y a pas d'heure à laquelle ne pas se présenter. */
const SANS_CRENEAU = {
  ...ABSENCE_OUVERTE,
  booking_id: 'sans-creneau-1',
  starts_at: null,
  absence_signalable_a: null,
};

/**
 * Le jour que le serveur rendra, **calculé et non figé**.
 *
 * Le décor posait `jour: '2026-08-08'` pendant que ses réservations sont
 * relatives à maintenant : la journée annoncée n'a jamais correspondu à ce
 * qu'elle portait. Rien ne le disait tant que l'écran montrait la file entière
 * quel que soit le jour ; depuis que la liste suit le jour qu'on lit, un décor
 * incohérent se voit — et c'est le décor qui avait tort.
 */
const enNewYork = (quand: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    dateStyle: 'short',
  }).format(quand);

const JOUR_DU_DECOR = enNewYork(new Date());

/**
 * Le jour que le serveur annonce **suit la file qu'il rend**.
 *
 * Un cas pose une demande dont le créneau est la semaine prochaine, pour
 * éprouver que c'est l'échéance de réponse et non le créneau qui ferme la
 * décision. Il faut donc que la journée montrée soit celle de ce créneau,
 * sinon le décor demande d'afficher une carte sur un jour qui ne la porte pas.
 */
const jourDeLaFile = () => {
  const premier = fileDuJour.find((r) => r.starts_at);
  return premier?.starts_at ? enNewYork(new Date(premier.starts_at)) : JOUR_DU_DECOR;
};

/**
 * La file que le serveur rendra au prochain montage.
 *
 * Une variable plutôt qu'un filtre figé : certains cas ont besoin d'une demande
 * dont l'échéance est passée, et remonter tout le décor pour une date serait
 * recopier le montage à côté de lui-même.
 */
let fileDuJour: (typeof RESERVATIONS)[number][] = [];

/** Le planning du jour. Le décor par défaut, sauf quand un cas demande mieux. */
let planningDuJour: unknown[] = [];

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
      // La route de reprise répond une liste. Ce décor rendait la journée à
      // tout le monde — un montage qui ne prouve rien de ce qu'il monte.
      if (chemin.includes('/support-access')) {
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jour: jourDeLaFile(),
          timezone: 'America/New_York',
          debut: '2026-08-08T12:00:00Z',
          fin: '2026-08-09T00:00:00Z',
          items: planningDuJour,
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
  planningDuJour = RESERVATIONS.filter((r) => r.status !== 'awaiting_business');
});

/** Monte l'écran avec un planning choisi. La file reste celle du décor. */
async function monterPlanning(items: unknown[]) {
  planningDuJour = items;
  return monter();
}

it('met ce qui attend une décision devant le planning', async () => {
  await monter();

  // Une réservation en attente tient une place et bloque une créatrice qui ne
  // peut rien faire d'autre que patienter. La laisser dans l'ordre des heures
  // la ferait découvrir en la cherchant.
  //
  // Vérifié sur **la carte** : la v3 rend à la première section un relief que
  // la campagne 2 lui avait retiré. Une demande se soupèse — de quoi il
  // s'agit, avec qui, jusqu'à quand — et les trois faits doivent tenir
  // ensemble ; les deux autres sections se parcourent.
  const file = screen.getByTestId('a-trancher');
  expect(file).toContainElement(screen.getByTestId('demande-attente-1'));
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

    // Les lignes finies ont quitté l'écran à la cinquième reprise : elles
    // s'ouvrent depuis le compte de l'en-tête.

    if (screen.queryByTestId('compte-des-finies')) {

      await fireEvent.press(screen.getByTestId('compte-des-finies'));

    }

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
    fetchImpl: async (url) => {
      // La route de reprise répond une liste, pas la journée : un décor qui
      // rend le même objet partout ne prouve rien de ce qu'il monte.
      if (String(url).includes('/support-access')) {
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jour: jourDeLaFile(),
          timezone: 'America/New_York',
          debut: '',
          fin: '',
          items: [],
          a_trancher: [],
        }),
      } as Response;
    },
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

  // **Une seule phrase depuis la v11.** C'en était deux, et la conséquence
  // était rendue plus grosse que l'échéance qu'elle commente. Le test lisait
  // la seconde ; il lit maintenant la fondue, et vérifie qu'elle porte bien
  // les deux faits — le quand, et ce qu'il arrive après.
  const ligne = screen.getByTestId('limite-attente-1');
  expect(ligne).toBeTruthy();
  const dite = String(ligne.props.children);
  expect(dite).toContain('or the slot reopens');
  expect(dite).toMatch(/\d/);
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

// --------------------------------------------------------------------------
// constater une absence
// --------------------------------------------------------------------------

it("n'ouvre pas l'absence avant l'heure, et dit à partir de quand", async () => {
  // Le décor par défaut porte une réservation confirmée dont le rendez-vous est
  // dans une heure : rien à constater, et l'écran doit le dire plutôt que de
  // taire le geste — un bouton absent sans explication se lit comme une
  // fonction manquante.
  await monter();

  expect(screen.queryByTestId('absence-confirmee-1')).toBeNull();
  // **Et elle dit pourquoi.** Depuis que l'absence attend la fermeture de la
  // fenêtre de recours, l'attente se compte en heures : l'heure seule se
  // lirait comme une lenteur arbitraire, et un commerçant honnête conclurait
  // à un défaut plutôt qu'à une protection.
  expect(screen.getByTestId('absence-pourquoi-confirmee-1')).toBeTruthy();
  expect(screen.getByText(en.commerce.absencePasEncorePourquoi)).toBeTruthy();
  // **Et elle dit quelque chose.** La présence de la ligne ne suffit pas :
  // vidée de son libellé, elle passait le test tout en n'apprenant plus rien —
  // c'est-à-dire en redevenant le bouton absent qu'elle remplace.
  expect(screen.getByText(en.commerce.absencePasEncore)).toBeTruthy();
  expect(screen.getByTestId('absence-pas-encore-confirmee-1')).toBeTruthy();
});

it("n'offre jamais l'absence sur un droit sans créneau", async () => {
  // `SPEC.md` §4.1 : pas d'heure à laquelle ne pas se présenter, donc pas
  // d'absence. Ni le bouton, ni l'heure d'ouverture — il n'y en a pas.
  await monterPlanning([SANS_CRENEAU]);

  expect(screen.queryByTestId('absence-sans-creneau-1')).toBeNull();
  expect(screen.queryByTestId('absence-pas-encore-sans-creneau-1')).toBeNull();
});

it("ouvre l'absence sur l'heure que le serveur donne, jamais sur un délai recopié", async () => {
  await monterPlanning([ABSENCE_OUVERTE]);

  expect(screen.getByTestId('absence-passee-1')).toBeTruthy();
  expect(screen.queryByTestId('absence-pas-encore-passee-1')).toBeNull();
});

it('marque absent par sa propre route, et non par celle du désistement', async () => {
  await monterPlanning([ABSENCE_OUVERTE]);

  await act(async () => {
    await fireEvent.press(screen.getByTestId('absence-passee-1'));
  });
  await act(async () => {
    await fireEvent.changeText(
      screen.getByTestId('absence-passee-1-champ'),
      'ne s’est pas présentée',
    );
  });
  // Premier appui : il arme. Second : il envoie.
  await act(async () => {
    await fireEvent.press(screen.getByTestId('absence-passee-1-valider'));
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('absence-passee-1-confirmer'));
  });

  await waitFor(() => expect(envois).toHaveLength(1));
  expect(envois[0].chemin).toContain('/bookings/passee-1/no-show');
  expect(envois[0].chemin).not.toContain('cancel-by-business');
  // Détouré, jamais reformulé : la créatrice le lit, et il motive une pénalité.
  expect(envois[0].corps).toEqual({ reason: 'ne s’est pas présentée' });
});

/**
 * **Le test qui garde la confirmation.**
 *
 * Une confirmation décorative — un second bouton qui envoie au premier appui —
 * passerait tous les tests ci-dessus sans rien confirmer du tout. Celui-ci
 * s'arrête après le premier appui et vérifie que **rien n'est parti**. C'est la
 * seule forme qui distingue une confirmation d'un libellé.
 */
it("n'envoie rien au premier appui : l'absence est irréversible, elle se confirme", async () => {
  await monterPlanning([ABSENCE_OUVERTE]);

  await act(async () => {
    await fireEvent.press(screen.getByTestId('absence-passee-1'));
  });
  await act(async () => {
    await fireEvent.changeText(screen.getByTestId('absence-passee-1-champ'), 'absente');
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('absence-passee-1-valider'));
  });

  expect(envois).toHaveLength(0);
  // Et la conséquence est annoncée avant le second appui, pas après.
  expect(screen.getByTestId('absence-passee-1-avertissement')).toBeTruthy();
  expect(screen.getByTestId('absence-passee-1-confirmer')).toBeTruthy();
});

/**
 * Le désistement, lui, n'a rien d'irréversible et ne se confirme pas.
 *
 * Sans ce test, poser la confirmation sur les deux gestes — ce qui est le
 * réflexe — ajouterait un appui à l'action qu'on veut justement facile.
 */
it('ne demande aucune confirmation pour se désister', async () => {
  await monter();

  await act(async () => {
    await fireEvent.press(screen.getByTestId('desister-confirmee-1'));
  });
  await act(async () => {
    await fireEvent.changeText(screen.getByTestId('desister-confirmee-1-champ'), 'fermeture');
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('desister-confirmee-1-valider'));
  });

  await waitFor(() => expect(envois).toHaveLength(1));
  expect(screen.queryByTestId('desister-confirmee-1-avertissement')).toBeNull();
});

/**
 * **La garde du champ contre le délai recopié.**
 *
 * Écrite après coup : la mutation qui remplace `absence_signalable_a` par
 * `starts_at + 20 min` survivait à tous les tests ci-dessus, parce que le décor
 * posait précisément cette valeur. Un test qui ne peut pas distinguer les deux
 * lectures ne prouve rien de celle qui est suivie.
 */
it("suit l'heure du serveur, même quand elle contredit le délai d'usage", async () => {
  await monterPlanning([DELAI_PLUS_COURT]);

  // Le serveur ouvre depuis cinq minutes ; vingt minutes après le créneau, ce
  // serait fermé pour dix minutes encore.
  expect(screen.getByTestId('absence-delai-court-1')).toBeTruthy();
  expect(screen.queryByTestId('absence-pas-encore-delai-court-1')).toBeNull();
});

/** Le même écart, dans l'autre sens : le serveur ferme là où le délai ouvrirait. */
it("respecte une heure d'ouverture plus tardive que le délai d'usage", async () => {
  await monterPlanning([
    {
      ...ABSENCE_OUVERTE,
      booking_id: 'delai-long-1',
      // Le créneau est passé depuis une heure — un délai de vingt minutes
      // recopié ouvrirait le geste — mais le serveur ne l'ouvre que dans dix.
      starts_at: new Date(Date.now() - 3_600_000).toISOString(),
      absence_signalable_a: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
  ]);

  expect(screen.queryByTestId('absence-delai-long-1')).toBeNull();
  expect(screen.getByTestId('absence-pas-encore-delai-long-1')).toBeTruthy();
});
