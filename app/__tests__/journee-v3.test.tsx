/**
 * La journée du commerce v3 : un écran qui dit ce qu'il attend de vous.
 *
 * **« On ne comprend même pas à quoi sert cette page »** est la remarque la plus
 * grave de la revue, et la seule qui ne se corrige pas en déplaçant des blocs.
 * L'écran s'appelait « Aujourd'hui » et listait des réservations par heure : un
 * inventaire. Il ne disait pas qu'on y décide.
 *
 * **Ce que ces tests éprouvent d'abord est le contour**, parce que c'est la
 * seule chose ici qui puisse être fausse plutôt que laide. Le reste — un titre
 * qui compte, une section qui porte des cartes — se voit à l'œil dès le premier
 * chargement ; une limite mal située se voit le jour où une demande expire sans
 * que rien ne l'ait annoncée. Deux implémentations fausses passeraient un décor
 * recopié de la planche : celle qui compare les jours sur le fuseau de la
 * machine, et celle qui contourne aussi une limite déjà passée.
 */
import { render, screen, waitFor, within } from '@testing-library/react-native';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { JourneeScreen } from '../src/screens/JourneeScreen';
import {
  horairesDuJour,
  jourEnToutesLettres,
  limiteTombeAujourdhui,
} from '../src/screens/journee/entete';
import { ThemeProvider } from '../src/theme';

const RESERVATION = (
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
) => ({
  booking_id: id,
  status,
  starts_at: '2026-08-18T18:30:00Z',
  ends_at: '2026-08-18T19:15:00Z',
  valid_until: '2026-09-18T00:00:00Z',
  approval_expires_at: null,
  creator_id: 'u1',
  creator_first_name: 'Léa',
  creator_last_name: 'M.',
  creator_handle: '@lea.mrl',
  creator_profil_url: null,
  item_name: 'Gel manicure',
  duration_minutes: 45,
  platform: 'instagram',
  content_format: 'story',
  required_mention: '@velanailstudio',
  required_geotag: true,
  contrepartie: null,
  absence_signalable_a: null,
  ...extra,
});

const JOURNEE = {
  jour: '2026-08-18',
  timezone: 'America/New_York',
  debut: '2026-08-18T04:00:00Z',
  fin: '2026-08-19T04:00:00Z',
  items: [],
  a_trancher: [],
};

async function monter(
  journee: Record<string, unknown>,
  activation: Record<string, unknown> | null = null,
) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: (async (url: RequestInfo | URL) => {
      // **La route de reprise répond une liste, pas la journée.** Ce décor
      // répondait le même objet à toutes les routes : c'est un montage qui ne
      // prouve rien, et il a fallu qu'un second appel apparaisse pour que ça
      // se voie. Chaque chemin rend maintenant sa forme.
      if (String(url).includes('/support-access')) {
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      if (String(url).includes('/activation')) {
        return { ok: true, status: 200, json: async () => activation } as Response;
      }
      return { ok: true, status: 200, json: async () => journee } as Response;
    }) as unknown as typeof fetch,
  });
  return await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="merchant">
        <ApiProvider client={api}>
          <JourneeScreen businessId="b1" />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la limite qui tombe aujourd’hui, et le fuseau qui la décide', () => {
  // 18 août, 15 h à New York — c'est-à-dire 19 h en temps universel.
  const maintenant = new Date('2026-08-18T19:00:00Z');

  it('une limite de ce soir, dans le fuseau du salon, la porte', () => {
    expect(
      limiteTombeAujourdhui('2026-08-18T22:00:00Z', 'America/New_York', maintenant),
    ).toBe(true);
  });

  it('mais pas celle qui bascule au lendemain là où se tient le comptoir', () => {
    // **Le cas qui diverge de « compare les jours en temps universel ».**
    // 2 h du matin le 19 en UTC, c'est encore 22 h le 18 à Miami : une garde
    // qui lirait les dates telles quelles répondrait « demain » à quelqu'un qui
    // a jusqu'à ce soir. Et l'inverse existe aussi, plus bas.
    expect(
      limiteTombeAujourdhui('2026-08-19T02:00:00Z', 'America/New_York', maintenant),
    ).toBe(true);
    // 5 h du matin le 19 en UTC : 1 h du matin le 19 à Miami. Demain, vraiment.
    expect(
      limiteTombeAujourdhui('2026-08-19T05:00:00Z', 'America/New_York', maintenant),
    ).toBe(false);
  });

  it('ni celle qui est déjà passée', () => {
    // **Le cas qui diverge de « le jour suffit ».** Une limite dépassée tombe
    // bien aujourd'hui ; il n'y a pourtant plus rien à faire aujourd'hui qui
    // n'aurait pas dû l'être ce matin, et un contour d'appel par-dessus le
    // bandeau de dépassement ferait espérer une action qui n'existe plus.
    expect(
      limiteTombeAujourdhui('2026-08-18T12:00:00Z', 'America/New_York', maintenant),
    ).toBe(false);
  });

  it('ni celle qui n’existe pas', () => {
    expect(limiteTombeAujourdhui(null, 'America/New_York', maintenant)).toBe(false);
    expect(limiteTombeAujourdhui('pas une date', 'America/New_York', maintenant)).toBe(false);
  });
});

describe('le jour en toutes lettres', () => {
  it('porte le quantième et le mois, pas seulement le nom du jour', () => {
    // La sous-ligne remplace un titre qui nommait l'écran : « Monday » seul
    // situerait moins que « Today », ce qui serait une régression déguisée.
    // **Mardi, et non lundi.** La planche écrit « Monday 18 August » ; le
    // 18 août 2026 est un mardi. Recopier le libellé de la maquette aurait
    // fait passer une implémentation qui renvoie un jour fixe.
    const rendu = jourEnToutesLettres('2026-08-18', 'en');
    expect(rendu).toMatch(/Tuesday/);
    expect(rendu).toMatch(/18/);
    expect(rendu).toMatch(/August/);
  });

  it('et ne bascule pas d’un jour selon le fuseau de la machine', () => {
    // Une date nue rendue à minuit change de quantième dès qu'un décalage
    // négatif s'applique. Le 1er du mois est le cas qui le révèle.
    expect(jourEnToutesLettres('2026-03-01', 'en')).toMatch(/1 March|March 1/);
  });
});

describe('la barre de titre compte, elle ne nomme plus', () => {
  it('deux demandes en attente : elle le dit', async () => {
    await monter({
      ...JOURNEE,
      a_trancher: [
        RESERVATION('d-1', 'awaiting_business'),
        RESERVATION('d-2', 'awaiting_business'),
      ],
    });
    await waitFor(() => expect(screen.getByTestId('a-trancher')).toBeTruthy());

    expect(
      screen.getByText(en.commerce.journeeDecisions.replace('{{count}}', '2')),
    ).toBeTruthy();
  });

  it('une seule : au singulier, jamais « 1 requests »', async () => {
    // **Le décor qui a trouvé le défaut.** La première version n'avait que deux
    // branches — zéro et « n » — et rendait « 1 requests need your answer » au
    // cas le plus courant de tous.
    await monter({ ...JOURNEE, a_trancher: [RESERVATION('d-1', 'awaiting_business')] });
    await waitFor(() => expect(screen.getByTestId('a-trancher')).toBeTruthy());

    expect(screen.getByText(en.commerce.journeeDecisionUne)).toBeTruthy();
    expect(screen.queryByText(/1 requests/)).toBeNull();
  });

  it('aucune : elle le dit aussi, plutôt que d’écrire zéro', async () => {
    await monter({ ...JOURNEE, items: [RESERVATION('b-1', 'confirmed')] });
    await waitFor(() => expect(screen.getByTestId('planning')).toBeTruthy());

    expect(screen.getByText(en.commerce.journeeRienAAnswer)).toBeTruthy();
    expect(screen.queryByText(/^0 /)).toBeNull();
  });
});

/** Demain à midi dans le fuseau du salon, en jours civils et non en heures. */
function demainMidi(): string {
  const aNewYork = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    dateStyle: 'short',
  }).format(new Date());
  const [a, m, j] = aNewYork.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + 1, 16, 0, 0)).toISOString();
}

describe('la carte de demande porte les trois faits qui décident', () => {
  it('la prestation, le moment, la personne, et la limite', async () => {
    await monter({
      ...JOURNEE,
      a_trancher: [
        RESERVATION('d-1', 'awaiting_business', {
          approval_expires_at: '2026-08-20T22:00:00Z',
          // **Demain chez le salon, calculé.** Le décor portait une date figée
          // à dix jours de l'exécution : le repère y rend la date brute, ce qui
          // est le bon comportement — au-delà d'une semaine il n'y a pas de
          // repère humain — mais éprouve alors le repli et non la règle.
          starts_at: demainMidi(),
        }),
      ],
    });
    await waitFor(() => expect(screen.getByTestId('demande-d-1')).toBeTruthy());

    // **Une colonne, deux graisses, chaque fait une fois.** Le pseudonyme et
    // le moment tiennent sur la même ligne depuis la v8 : la carte portait
    // quatre grammaires typographiques pour trois faits, et l'heure limite y
    // était écrite deux fois parce qu'en mono, isolée d'un verbe, elle ne se
    // lisait pas comme une échéance.
    const carte = within(screen.getByTestId('demande-d-1'));
    expect(carte.getByText('Gel manicure')).toBeTruthy();
    expect(carte.getByText(/@lea\.mrl · /)).toBeTruthy();
    expect(carte.getByTestId('limite-d-1')).toBeTruthy();

    // Et le moment se lit sans calculer : « Aug 30, 2026 at 2:00 PM » demandait
    // de se situer dans un calendrier pour lire un rendez-vous de demain.
    expect(carte.getByText(/· tomorrow at /)).toBeTruthy();
  });

  it('et sans limite servie, la ligne de limite ne s’invente pas', async () => {
    // `approval_expires_at` est nul sur les demandes d'avant la correction
    // serveur. Une ligne « répondez avant — » vaudrait moins que pas de ligne.
    await monter({ ...JOURNEE, a_trancher: [RESERVATION('d-1', 'awaiting_business')] });
    await waitFor(() => expect(screen.getByTestId('demande-d-1')).toBeTruthy());

    expect(screen.queryByTestId('limite-d-1')).toBeNull();
  });
});

describe('les horaires du jour, et ce que « vide » veut dire', () => {
  it('deux plages se lisent d’affilée, sans secondes', () => {
    expect(
      horairesDuJour([
        { debut: '09:00:00', fin: '12:30:00', postes: 2 },
        { debut: '14:00:00', fin: '19:00:00', postes: 2 },
      ]),
    ).toBe('09:00–12:30, 14:00–19:00');
  });

  it('et fermé se dit, au lieu de se taire', () => {
    // **Le cas qui diverge de « rends la chaîne vide ».** Une journée sans
    // réservation ne se lit pas pareil selon qu'on était fermé ou que personne
    // n'est venu, et c'est la question qu'un gérant se pose un jour creux.
    expect(horairesDuJour([])).toBeNull();
  });

});



/**
 * Le salon suspendu, et ce qu'il doit **réellement**.
 *
 * **La phrase et le nombre se contredisaient.** Le bandeau recevait les
 * réservations du jour *plus* la file à trancher, sous une phrase qui dit
 * « les N réservations que vous avez acceptées » — c'est-à-dire qu'il comptait
 * des demandes que le salon n'a justement pas encore acceptées. Le décor
 * ci-dessous les fait diverger : rien d'accepté, trois demandes en attente. La
 * somme dit trois, la vérité dit zéro.
 *
 * Les deux ne se somment d'ailleurs pas : la file vient du serveur et porte des
 * décisions pour après-demain, la journée ne connaît qu'un jour.
 */
describe('le salon suspendu ne compte que ce qu’il a accepté', () => {
  const SUSPENDU = {
    status: 'suspended',
    en_ligne_depuis: null,
    etapes: [{ cle: 'address', done: true, blocking: true }],
  };

  it('trois demandes en attente et rien d’accepté : il n’annonce aucun dû', async () => {
    await monter(
      {
        ...JOURNEE,
        items: [],
        a_trancher: [
          RESERVATION('d-1', 'awaiting_business'),
          RESERVATION('d-2', 'awaiting_business'),
          RESERVATION('d-3', 'awaiting_business'),
        ],
      },
      SUSPENDU,
    );

    const bandeau = await screen.findByTestId('bandeau-suspendu');
    expect(within(bandeau).getByText(en.commerce.suspenduRienAujourdhui)).toBeTruthy();
  });

  it('une réservation acceptée aujourd’hui : c’est elle qu’il annonce', async () => {
    await monter(
      {
        ...JOURNEE,
        items: [RESERVATION('b-1', 'confirmed')],
        a_trancher: [RESERVATION('d-1', 'awaiting_business')],
      },
      SUSPENDU,
    );

    const bandeau = await screen.findByTestId('bandeau-suspendu');
    expect(
      within(bandeau).getByText(en.commerce.suspenduAHonorer.replace('{{count}}', '1')),
    ).toBeTruthy();
  });
});


/**
 * Les deux motifs ne disent pas la même sortie.
 *
 * **C'est là tout l'intérêt du champ** : une pause se lève par le salon
 * lui-même, une grâce en payant. Un bandeau qui rendrait la même phrase aux
 * deux ne vaudrait pas le champ qu'il lit — et le salon écrirait au support
 * pour demander comment il en sort.
 */
describe('pourquoi le salon est dehors, à l’écran', () => {
  const SUSPENDU = (motif: string) => ({
    status: 'suspended',
    en_ligne_depuis: null,
    etapes: [{ cle: 'address', done: true, blocking: true }],
    suspension_motif: motif,
    suspendu_depuis: '2026-08-20T14:00:00Z',
  });

  it('une pause volontaire ne s’annonce pas comme une sanction', async () => {
    await monter(JOURNEE, SUSPENDU('paused_by_business'));
    const bandeau = await screen.findByTestId('bandeau-suspendu');
    expect(within(bandeau).getByText(en.commerce.suspenduTitrePause)).toBeTruthy();
    expect(within(bandeau).getByText(en.commerce.suspenduPause)).toBeTruthy();
  });

  it('une grâce expirée dit qu’on en sort en payant', async () => {
    await monter(JOURNEE, SUSPENDU('grace_expired'));
    const bandeau = await screen.findByTestId('bandeau-suspendu');
    expect(within(bandeau).getByText(en.commerce.suspenduTitreGrace)).toBeTruthy();
    expect(within(bandeau).getByText(en.commerce.suspenduGrace)).toBeTruthy();
  });
});


/**
 * Le bandeau sur une journée vide, qui est la seule qu'il aura.
 *
 * **Les deux états qu'il annonce vident la journée par construction** : un
 * salon pas encore publié n'est dans aucun fil et ne reçoit rien. Le bandeau ne
 * vivait que dans les enfants de l'écran, donc jamais dans l'état vide — « il
 * reste deux points avant que les créatrices vous voient » ne s'affichait
 * jamais au salon qui n'était précisément pas publié.
 *
 * Le décor diverge de celui qui passait : journée vide **et** salon non publié.
 * Avec une journée pleine, les deux implémentations rendent la même chose.
 */
it('un salon pas encore publié le lit sur une journée vide', async () => {
  await monter(JOURNEE, {
    status: 'draft',
    en_ligne_depuis: null,
    etapes: [
      { cle: 'address', done: true, blocking: true },
      { cle: 'cover_photo', done: false, blocking: true },
    ],
  });

  expect(await screen.findByTestId('journee-vide')).toBeTruthy();
  expect(screen.getByTestId('bandeau-mise-en-ligne')).toBeTruthy();
});
