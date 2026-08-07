/**
 * Écrans commerce et back office, et leurs quatre états.
 *
 * Même mécanique que pour le créateur, avec ce qui distingue ces deux rôles :
 * le liseré du commerce, la densité, l'absence de montant côté commerce et sa
 * présence — unique — sur l'écran des plans.
 *
 * Les règles éprouvées ici sont celles qu'un écran pressé enfreint : un bouton
 * de décision sans motif, un rejet définitif offert au commerce, un pourcentage
 * sur l'activation, une clôture proposée à qui n'y a pas droit.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider, type Role } from '../src/theme';
import { ActivationScreen } from '../src/screens/ActivationScreen';
import { ArbitrageScreen } from '../src/screens/ArbitrageScreen';
import { JourneeScreen } from '../src/screens/JourneeScreen';
import { PlansScreen } from '../src/screens/PlansScreen';
import { PublicationsScreen } from '../src/screens/PublicationsScreen';
import { ReportingScreen } from '../src/screens/ReportingScreen';
import { ECRANS_COMMERCE } from '../test-support/registre-ecrans';

const coffre = { lire: async () => null, ecrire: async () => {} };

function clientDe(table: Record<string, unknown>): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) => {
      const trouve = Object.entries(table).find(([fragment]) => String(url).includes(fragment));
      if (!trouve) throw new Error(`route non simulée : ${url}`);
      return { ok: true, status: 200, json: async () => trouve[1] } as Response;
    },
  });
}

const clientQuiEchoue = new ApiClient({
  baseUrl: 'https://api.test',
  coffre,
  fetchImpl: async () =>
    ({ ok: false, status: 500, json: async () => ({ detail: 'internal_error' }) }) as Response,
});

const clientQuiNeRepondJamais = new ApiClient({
  baseUrl: 'https://api.test',
  coffre,
  delaiMs: 50,
  fetchImpl: (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
});

async function monter(noeud: ReactElement, client: ApiClient, role: Role = 'merchant') {
  function Cadre({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initialLocale="en">
        <ThemeProvider role={role}>
          <ApiProvider client={client}>{children}</ApiProvider>
        </ThemeProvider>
      </I18nProvider>
    );
  }
  return render(<Cadre>{noeud}</Cadre>);
}

// --------------------------------------------------------------------------
// jeux de données
// --------------------------------------------------------------------------

const JOURNEE = {
  jour: '2026-08-08',
  timezone: 'America/New_York',
  debut: '2026-08-08T04:00:00Z',
  fin: '2026-08-09T04:00:00Z',
  items: [
    {
      booking_id: 'r1',
      status: 'confirmed',
      starts_at: '2026-08-08T14:00:00Z',
      ends_at: '2026-08-08T14:45:00Z',
      valid_until: '2026-08-09T04:00:00Z',
      creator_id: 'u1',
      creator_first_name: 'Rebecca',
      creator_last_name: 'Alvarez',
      creator_handle: 'rebecca.miami',
      item_name: 'Gel nails',
      duration_minutes: 45,
      platform: 'instagram',
      content_format: 'story',
      contrepartie: null,
    },
    {
      booking_id: 'r2',
      status: 'confirmed',
      starts_at: null,
      ends_at: null,
      valid_until: '2026-08-09T04:00:00Z',
      creator_id: 'u2',
      creator_first_name: null,
      creator_last_name: null,
      creator_handle: 'ana.mia',
      item_name: 'Blow dry',
      duration_minutes: null,
      platform: 'instagram',
      content_format: 'post',
      contrepartie: null,
    },
  ],
};

const LIGNE_DE_FILE = {
  collaboration_id: 'k1',
  booking_id: 'r1',
  status: 'submitted',
  required_format: 'story',
  required_mention: '@salon',
  required_geotag: true,
  deadline_at: '2026-08-09T14:00:00Z',
  attempts_count: 2,
  needs_human_review: true,
  created_at: '2026-08-07T09:00:00Z',
  business_id: 'b1',
  business_name: 'Salón Ocean',
  creator_id: 'u1',
  creator_first_name: 'Rebecca',
  creator_last_name: 'Alvarez',
  creator_handle: 'rebecca.miami',
  platform: 'instagram',
  item_name: 'Gel nails',
  dernier_motif: 'mention absente',
  derniere_soumission: null,
};

const ETAPES = [
  { cle: 'address', done: true, blocking: true },
  { cle: 'coordinates', done: true, blocking: true },
  { cle: 'cover_photo', done: false, blocking: false },
  { cle: 'catalog_item', done: false, blocking: false },
  { cle: 'tier_offer', done: false, blocking: false },
  { cle: 'capacity_rule', done: false, blocking: false },
];

const PLAN = {
  plan_id: 'pl1',
  name: 'Essentiel',
  category: 'beauty',
  price_cents: 9900,
  currency: 'USD',
  billing_interval: 'monthly',
  features: {},
  is_active: true,
  subscriptions_count: 12,
  active_subscriptions_count: 10,
  mrr_cents: 99000,
};

const REPORTING = {
  business_id: 'b1',
  currency: 'USD',
  debut: '2026-07-08T04:00:00Z',
  fin: '2026-08-08T04:00:00Z',
  timezone: 'America/New_York',
  reservations: 12,
  consommations: 9,
  annulations: 2,
  absences: 1,
  publications: 7,
  publications_attendues: 2,
  non_honorees: 0,
  valeur_offerte_cents: 72_000,
  portee_approximative: 184_000,
  taux_d_honoration: 0.7778,
  par_palier: [
    {
      tier_id: 'p1',
      platform: 'instagram',
      content_format: 'story',
      publications: 7,
      valeur_offerte_cents: 72_000,
    },
  ],
  par_item: [
    {
      catalog_item_id: 'i1',
      name: 'Gel nails',
      reservations: 12,
      consommations: 9,
      publications: 7,
      valeur_offerte_cents: 72_000,
    },
  ],
};

const ECRANS = [
  {
    nom: 'journee',
    noeud: <JourneeScreen businessId="b1" />,
    role: 'merchant' as Role,
    plein: { '/bookings': JOURNEE },
    vide: { '/bookings': { ...JOURNEE, items: [] } },
  },
  {
    nom: 'publications',
    noeud: <PublicationsScreen businessId="b1" />,
    role: 'merchant' as Role,
    plein: { '/collaborations': [LIGNE_DE_FILE] },
    vide: { '/collaborations': [] },
  },
  {
    nom: 'activation',
    noeud: <ActivationScreen businessId="b1" onActive={jest.fn()} />,
    role: 'merchant' as Role,
    plein: { '/activation': ETAPES },
    // Une liste d'étapes vide n'arrive pas : le serveur en rend toujours six.
    vide: null,
  },
  {
    nom: 'reporting',
    noeud: <ReportingScreen businessId="b1" />,
    role: 'merchant' as Role,
    plein: { '/reporting': REPORTING },
    vide: { '/reporting': { ...REPORTING, reservations: 0 } },
  },
  {
    nom: 'arbitrage',
    noeud: <ArbitrageScreen />,
    role: 'admin' as Role,
    plein: { '/admin/collaborations/review': [LIGNE_DE_FILE] },
    vide: { '/admin/collaborations/review': [] },
  },
  {
    nom: 'plans',
    noeud: <PlansScreen />,
    role: 'admin' as Role,
    plein: { '/admin/plans': [PLAN] },
    vide: { '/admin/plans': [] },
  },
] as const;

// --------------------------------------------------------------------------
// quatre états
// --------------------------------------------------------------------------

describe('quatre états', () => {
  it.each(ECRANS.map((e) => [e.nom, e] as const))('%s · nominal', async (_nom, ecran) => {
    await monter(ecran.noeud, clientDe(ecran.plein), ecran.role);
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());
  });

  it.each(ECRANS.map((e) => [e.nom, e] as const))('%s · chargement', async (_nom, ecran) => {
    await monter(ecran.noeud, clientQuiNeRepondJamais, ecran.role);
    expect(screen.getByTestId('etat-chargement')).toBeTruthy();
  });

  it.each(ECRANS.map((e) => [e.nom, e] as const))('%s · erreur', async (_nom, ecran) => {
    await monter(ecran.noeud, clientQuiEchoue, ecran.role);
    await waitFor(() => expect(screen.getByTestId('etat-erreur')).toBeTruthy());
    expect(screen.getByText(en.common.retry)).toBeTruthy();
    expect(screen.queryByText('internal_error')).toBeNull();
  });

  it.each(ECRANS.filter((e) => e.vide !== null).map((e) => [e.nom, e] as const))(
    '%s · vide',
    async (_nom, ecran) => {
      await monter(ecran.noeud, clientDe(ecran.vide as Record<string, unknown>), ecran.role);
      await waitFor(() => expect(screen.getByTestId('etat-vide')).toBeTruthy());
    },
  );

  it('couvre exactement les écrans commerce déclarés', () => {
    const fichiers: Record<string, string> = {
      journee: 'JourneeScreen.tsx',
      publications: 'PublicationsScreen.tsx',
      activation: 'ActivationScreen.tsx',
      arbitrage: 'ArbitrageScreen.tsx',
      plans: 'PlansScreen.tsx',
      reporting: 'ReportingScreen.tsx',
    };
    expect(ECRANS.map((e) => fichiers[e.nom]).sort()).toEqual([...ECRANS_COMMERCE].sort());
  });
});

// --------------------------------------------------------------------------
// rôle
// --------------------------------------------------------------------------

describe('rôle', () => {
  it('marque les écrans commerce d’un liseré', async () => {
    // Le seul repère qui distingue les deux applications quand un téléphone
    // passe de main en main au comptoir.
    await monter(<JourneeScreen businessId="b1" />, clientDe({ '/bookings': JOURNEE }));
    await waitFor(() => expect(screen.getByTestId('lisere-commerce')).toBeTruthy());
  });

  it('ne le met pas côté créateur', async () => {
    await monter(<PlansScreen />, clientDe({ '/admin/plans': [PLAN] }), 'creator');
    await waitFor(() => expect(screen.getByTestId('ecran-plans')).toBeTruthy());
    expect(screen.queryByTestId('lisere-commerce')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// journée
// --------------------------------------------------------------------------

describe('journée du commerce', () => {
  it('affiche l’heure dans le fuseau du commerce', async () => {
    await monter(<JourneeScreen businessId="b1" />, clientDe({ '/bookings': JOURNEE }));
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());
    // 14:00 UTC = 10:00 à Miami en heure d'été. C'est l'heure du salon qui
    // compte, pas celle du serveur.
    expect(screen.getByText('10:00')).toBeTruthy();
  });

  it('n’invente pas d’heure sur un droit sans créneau', async () => {
    await monter(<JourneeScreen businessId="b1" />, clientDe({ '/bookings': JOURNEE }));
    await waitFor(() => expect(screen.getByTestId('reservation-r2')).toBeTruthy());
    expect(screen.getByText(en.commerce.journeeSansCreneau)).toBeTruthy();
  });

  it('n’affiche aucun montant', async () => {
    // L'écran de journée n'est pas un état de caisse.
    await monter(<JourneeScreen businessId="b1" />, clientDe({ '/bookings': JOURNEE }));
    await waitFor(() => expect(screen.getByTestId('reservation-r1')).toBeTruthy());
    for (const motif of [/\$/, /USD/, /\d+[.,]\d{2}/]) {
      expect(screen.queryByText(motif)).toBeNull();
    }
  });
});

// --------------------------------------------------------------------------
// contrôle des publications
// --------------------------------------------------------------------------

describe('contrôle des publications', () => {
  it('n’offre aucun rejet définitif', async () => {
    // Il n'existe pas de statut de litige : un refus rouvre avec une nouvelle
    // échéance. Un bouton « rejeter » fermerait des dossiers qu'on ne saurait
    // plus rouvrir.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());
    for (const mot of [/reject/i, /refuse/i, /deny/i]) {
      expect(screen.queryByText(mot)).toBeNull();
    }
  });

  it('retire la demande de nouvelle soumission tant qu’aucun motif n’est choisi', async () => {
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());

    expect(screen.queryByTestId('redemander')).toBeNull();
    expect(screen.getByTestId('motif-obligatoire')).toBeTruthy();
    // L'approbation, elle, reste offerte : elle n'exige aucun motif.
    expect(screen.getByTestId('approuver')).toBeTruthy();

    await fireEvent.press(screen.getByText(en.commerce.motifMention));
    expect(screen.getByTestId('redemander')).toBeTruthy();
  });

  it('rappelle la mention attendue et le dernier motif', async () => {
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );
    await waitFor(() => expect(screen.getByTestId('mention-attendue')).toBeTruthy());
    expect(screen.getByTestId('dernier-motif')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// activation
// --------------------------------------------------------------------------

describe('activation', () => {
  it('sépare le bloquant de la visibilité', async () => {
    await monter(<ActivationScreen businessId="b1" onActive={jest.fn()} />, clientDe({ '/activation': ETAPES }));
    await waitFor(() => expect(screen.getByTestId('etape-address')).toBeTruthy());

    expect(screen.getByText(en.commerce.activationBloquant)).toBeTruthy();
    expect(screen.getByText(en.commerce.activationVisibilite)).toBeTruthy();
    // Les six étapes sont rendues, y compris celles qui ne bloquent pas : les
    // taire produirait un commerce « activé » que personne ne voit.
    for (const etape of ETAPES) {
      expect(screen.getByTestId(`etape-${etape.cle}`)).toBeTruthy();
    }
  });

  it('compte les étapes sans pourcentage', async () => {
    // « 2 étapes sur 6 » se comprend ; « 33 % » ne dit pas laquelle manque.
    await monter(<ActivationScreen businessId="b1" onActive={jest.fn()} />, clientDe({ '/activation': ETAPES }));
    await waitFor(() => expect(screen.getByTestId('compte-etapes')).toBeTruthy());
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('offre l’ouverture quand les deux bloquantes sont faites', async () => {
    await monter(<ActivationScreen businessId="b1" onActive={jest.fn()} />, clientDe({ '/activation': ETAPES }));
    await waitFor(() => expect(screen.getByTestId('ouvrir')).toBeTruthy());
  });

  it('retire l’ouverture quand une bloquante manque', async () => {
    // Retirée et non grisée : elle redeviendra possible, mais le griser
    // demanderait de deviner laquelle manque.
    const incomplete = ETAPES.map((e) => (e.cle === 'address' ? { ...e, done: false } : e));
    await monter(
      <ActivationScreen businessId="b1" onActive={jest.fn()} />,
      clientDe({ '/activation': incomplete }),
    );
    await waitFor(() => expect(screen.getByTestId('etape-address')).toBeTruthy());
    expect(screen.queryByTestId('ouvrir')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// arbitrage
// --------------------------------------------------------------------------

describe('arbitrage', () => {
  it('offre l’approbation sans motif, et rien d’autre', async () => {
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [LIGNE_DE_FILE] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    expect(screen.getByLabelText(en.admin.issueApprove)).toBeTruthy();
    expect(screen.queryByLabelText(en.admin.issueResubmit)).toBeNull();
    expect(screen.queryByLabelText(en.admin.issueUnfulfilled)).toBeNull();
  });

  it('ouvre les deux autres issues dès qu’un motif est choisi', async () => {
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [LIGNE_DE_FILE] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    await fireEvent.press(screen.getByText(en.commerce.motifMention));

    expect(screen.getByLabelText(en.admin.issueResubmit)).toBeTruthy();
    // La clôture n'existe que là. Le commerce ne la voit nulle part.
    expect(screen.getByLabelText(en.admin.issueUnfulfilled)).toBeTruthy();
  });

  it('emploie le vocabulaire du commerce pour ce qui est commun', async () => {
    // Un second langage pour l'arbitre obligerait chacun à traduire.
    expect(en.admin.issueApprove).toBe(en.commerce.approuver);
    expect(en.admin.issueResubmit).toBe(en.commerce.redemander);
  });

  it('n’offre la clôture nulle part côté commerce', async () => {
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());
    expect(screen.queryByText(en.admin.issueUnfulfilled)).toBeNull();
  });
});

// --------------------------------------------------------------------------
// plans
// --------------------------------------------------------------------------

describe('plans', () => {
  it('affiche des montants — le seul écran qui le fasse', async () => {
    await monter(<PlansScreen />, clientDe({ '/admin/plans': [PLAN] }), 'admin');
    await waitFor(() => expect(screen.getByTestId('plan-pl1')).toBeTruthy());
    expect(screen.getByText('99.00 USD')).toBeTruthy();
    expect(screen.getByText('990.00 USD')).toBeTruthy();
  });

  it('n’offre aucune modification', async () => {
    // La modification touche la facturation et attend Stripe. Offrir un champ
    // ferait croire à une action qui n'existe pas.
    await monter(<PlansScreen />, clientDe({ '/admin/plans': [PLAN] }), 'admin');
    await waitFor(() => expect(screen.getByTestId('plan-pl1')).toBeTruthy());
    for (const mot of [/edit/i, /save/i, /change/i]) {
      expect(screen.queryByText(mot)).toBeNull();
    }
  });
});


// --------------------------------------------------------------------------
// reporting
// --------------------------------------------------------------------------

describe('reporting', () => {
  it('dit ce que le commerce a donné, jamais ce qu’il a gagné', async () => {
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('valeur-offerte')).toBeTruthy());

    expect(screen.getByText('720.00 USD')).toBeTruthy();
    // Aucun mot de revenu, de chiffre d'affaires ou de gain sur cet écran.
    for (const mot of [/revenue/i, /earned/i, /income/i, /profit/i]) {
      expect(screen.queryByText(mot)).toBeNull();
    }
  });

  it('annonce la portée comme approximative, en toutes lettres', async () => {
    // Le nombre d'abonnés n'est pas le nombre de personnes ayant vu une story.
    // Le rendre sans le dire ferait prendre une approximation pour un résultat.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('note-portee')).toBeTruthy());
    expect(screen.getByText(en.reporting.porteeNote)).toBeTruthy();
  });

  it('écrit le taux inconnu en mots, jamais en zéro pour cent', async () => {
    // Zéro sur zéro n'est pas zéro. Afficher 0 % à un commerce qui n'a encore
    // servi personne serait un reproche pour quelque chose qu'il n'a pas fait.
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({ '/reporting': { ...REPORTING, consommations: 0, taux_d_honoration: null } }),
    );
    await waitFor(() => expect(screen.getByTestId('taux')).toBeTruthy());

    expect(screen.getByText(en.reporting.tauxInconnu)).toBeTruthy();
    expect(screen.queryByText('0 %')).toBeNull();
  });

  it('affiche le taux en pourcentage quand il existe', async () => {
    // Le pendant : sans lui, un écran qui écrirait toujours « rien servi »
    // passerait le test précédent.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('taux')).toBeTruthy());
    expect(screen.getByText('78 %')).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// Snapchat
// --------------------------------------------------------------------------

describe('absence de Snapchat', () => {
  it('ne casse aucun écran qui reçoit la plateforme', async () => {
    // Snapchat existe en base et dans les paliers ; aucune implémentation ne
    // lui répond. Un écran qui recevrait la plateforme et planterait ferait
    // tomber le produit sur une donnée parfaitement légitime.
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({
        '/reporting': {
          ...REPORTING,
          par_palier: [{ ...REPORTING.par_palier[0], platform: 'snapchat' }],
        },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());
    expect(screen.getByTestId('palier-p1')).toBeTruthy();
  });
});
