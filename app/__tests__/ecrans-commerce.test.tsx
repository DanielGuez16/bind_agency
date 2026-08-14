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

import { ApiClient, ApiProvider, PREFIXE } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider, type Role } from '../src/theme';
import { ActivationScreen } from '../src/screens/ActivationScreen';
import { ArbitrageScreen } from '../src/screens/ArbitrageScreen';
import { AnnuaireScreen } from '../src/screens/AnnuaireScreen';
import { CatalogueScreen } from '../src/screens/CatalogueScreen';
import { HorairesScreen } from '../src/screens/HorairesScreen';
import { JourneeScreen } from '../src/screens/JourneeScreen';
import { PlansScreen } from '../src/screens/PlansScreen';
import { NOTE_MAXIMUM, PublicationsScreen } from '../src/screens/PublicationsScreen';
import { ReportingScreen } from '../src/screens/ReportingScreen';
import { TerrainScreen } from '../src/screens/TerrainScreen';
import { ECRANS_COMMERCE } from '../test-support/registre-ecrans';

const coffre = { lire: async () => null, ecrire: async () => {} };

function clientDe(
  table: Record<string, unknown>,
  /** Ce qui part, pour les tests qui éprouvent le corps envoyé et non le rendu. */
  espion?: (chemin: string, corps: unknown) => void,
): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url, init) => {
      const chemin = String(url);
      if (init?.body) espion?.(chemin, JSON.parse(String(init.body)));
      const trouve = Object.entries(table).find(([fragment]) => chemin.includes(fragment));
      if (!trouve) throw new Error(`route non simulée : ${chemin}`);
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
  delaiMs: 2_000,
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
  // La file à trancher est une liste à part, rendue par le serveur toutes
  // dates confondues. Vide ici : ces tests éprouvent le planning.
  a_trancher: [],
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
  dernier_motif: 'missing_mention',
  tentatives: [
    { motif: 'missing_mention', demandee_le: '2026-08-08T09:00:00Z', par: 'business_member' },
  ],
  // Une soumission réelle : c'est elle que le commerce doit pouvoir regarder.
  derniere_soumission: {
    proof_id: 'p1',
    submitted_at: '2026-08-09T10:00:00Z',
    capture_method: 'upload',
    source_url: 'https://instagram.example/p/xyz',
    media_key: null,
    screenshot_key: 'proofs/upload/2026-08-09/abc',
    platform_published_at: null,
  },
};

/**
 * Un dossier tel que le produit le fabrique, et non tel qu'on l'imagine.
 *
 * `resubmit_requested`, trois tentatives : le drapeau de revue humaine se lève
 * dans la demande de nouvelle soumission, qui laisse le dossier là. Le décor
 * posait `submitted` — un état que le dossier ne traverse qu'ensuite, s'il
 * traverse — et c'est ce qui a laissé passer un arbitrage qui répondait 409 sur
 * deux de ses trois issues.
 */
const DOSSIER_EN_ARBITRAGE = {
  ...LIGNE_DE_FILE,
  status: 'resubmit_requested',
  attempts_count: 3,
  dernier_motif: 'wrong_format',
  tentatives: [
    { motif: 'missing_mention', demandee_le: '2026-08-07T09:00:00Z', par: 'business_member' },
    { motif: 'missing_location', demandee_le: '2026-08-08T09:00:00Z', par: 'business_member' },
    { motif: 'wrong_format', demandee_le: '2026-08-09T09:00:00Z', par: 'business_member' },
  ],
};

/** Le statut accompagne les étapes : c'est lui qui décide de la dernière ligne. */
const vueDActivation = (etapes: unknown[], status = 'onboarding') => ({ status, etapes });

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
  par_semaine: [
    { debut: '2026-08-03', publications: 2 },
    { debut: '2026-07-27', publications: 1 },
  ],
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

const ITEM = {
  id: 'i1',
  business_id: 'b1',
  parent_item_id: null,
  name: 'Gel nails',
  description: null,
  price_cents: 6500,
  duration_minutes: 45,
  requires_booking: true,
  photo_key: null,
  source: 'manual',
  is_available: true,
  is_effectively_available: true,
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
};

const CREATEUR_DE_L_ANNUAIRE = {
  creator_id: 'c1',
  first_name: 'Lea',
  last_name: 'Moreau',
  city: 'Miami',
  bio: 'Nails and skin, Wynwood.',
  comptes: [{ platform: 'instagram', handle: 'lea.mrl', followers: 24_000 }],
  paliers_ouverts: ['story', 'post'],
  audience_totale: 24_000,
};

const PALIER = {
  id: 't1',
  platform: 'instagram',
  content_format: 'story',
  min_followers: 1000,
  min_completed_collabs: 0,
  min_reliability_score: null,
  value_ratio_hint: null,
  display_order: 1,
  is_active: true,
};

const OFFRE = {
  id: 'o1',
  business_id: 'b1',
  tier_id: 't1',
  catalog_item_id: 'i1',
  platform: 'instagram',
  content_format: 'story',
  item_name: 'Gel nails',
  is_active: true,
  is_effectively_offered: true,
  created_at: '2026-08-01T10:00:00Z',
};

const REGLE = {
  id: 'r1',
  business_id: 'b1',
  weekday: 0,
  start_time: '10:00:00',
  end_time: '19:00:00',
  concurrent_slots: 2,
};

const FICHE_PREPAREE = {
  business_id: 'p1',
  name: 'Salon Ocean',
  status: 'draft' as const,
  address: '100 Ocean Drive',
  prepared_at: '2026-08-13T12:00:00Z',
  issued_at: null,
  expires_at: null,
  used_at: null,
  revoked_at: null,
  channel: null,
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
    plein: { '/activation': vueDActivation(ETAPES) },
    // Une liste d'étapes vide n'arrive pas : le serveur en rend toujours six.
    vide: null,
  },
  {
    nom: 'terrain',
    noeud: <TerrainScreen />,
    role: 'merchant' as Role,
    plein: { '/admin/prospects': [FICHE_PREPAREE] },
    vide: { '/admin/prospects': [] },
  },
  {
    nom: 'annuaire',
    noeud: <AnnuaireScreen businessId="b1" />,
    role: 'merchant' as Role,
    plein: { '/creators': [CREATEUR_DE_L_ANNUAIRE] },
    vide: { '/creators': [] },
  },
  {
    nom: 'catalogue',
    noeud: <CatalogueScreen businessId="b1" />,
    role: 'merchant' as Role,
    plein: {
      '/catalog-items': [ITEM],
      '/tier-offers': [OFFRE],
      '/tiers': [PALIER],
      '/photos': [],
    '/menu': [],
      // En dernier : la table est parcourue par sous-chaîne, et
      // « /business/b1 » est contenu dans « /business/b1/catalog-items ».
      '/business/b1': { cover_photo_key: null, menu_url: null },
    },
    vide: {
      '/catalog-items': [],
      '/tier-offers': [],
      '/tiers': [PALIER],
      '/photos': [],
    '/menu': [],
      '/business/b1': { cover_photo_key: null, menu_url: null },
    },
  },
  {
    nom: 'horaires',
    noeud: <HorairesScreen businessId="b1" />,
    role: 'merchant' as Role,
    plein: { '/capacity-rules': [REGLE], '/capacity-exceptions': [] },
    // Jamais vide : les sept jours existent toujours, même sans une règle. Un
    // état vide effacerait la liste au moment où elle sert à la remplir.
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
// composition : catalogue, horaires
// --------------------------------------------------------------------------

describe('catalogue', () => {
  const CATALOGUE = {
    '/catalog-items': [ITEM],
    '/tier-offers': [OFFRE],
    '/tiers': [PALIER],
    '/photos': [],
    '/menu': [],
    // En dernier : la table est parcourue par sous-chaîne, et « /business/b1 »
    // est contenu dans « /business/b1/catalog-items ».
    '/business/b1': { cover_photo_key: null, menu_url: null },
  };

  it('porte la galerie en tête, avant les prestations', async () => {
    // Elle est ce qu'un visiteur voit en premier de la fiche, et un commerce
    // qui compose sa page commence souvent par là. La ranger sous les
    // prestations la ferait chercher.
    await monter(<CatalogueScreen businessId="b1" />, clientDe(CATALOGUE), 'merchant');
    await waitFor(() => expect(screen.getByTestId('galerie-du-commerce')).toBeTruthy());

    expect(screen.getByTestId('ajouter-une-photo')).toBeTruthy();
  });

  it('reste utilisable quand le catalogue est vide mais pas la galerie', async () => {
    // Un commerce qui n'a pas encore composé de prestation peut vouloir
    // commencer par ses photos ; l'état vide lui retirerait la seule chose
    // qu'il peut faire tout de suite.
    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe({
        ...CATALOGUE,
        '/catalog-items': [],
        '/photos': [
          { id: 'p1', storage_key: 'photos/commerces/b1/a.jpg', position: 0, alt_text: null },
        ],
      }),
      'merchant',
    );

    await waitFor(() => expect(screen.getByTestId('photo-p1')).toBeTruthy());
    expect(screen.queryByTestId('etat-vide')).toBeNull();
  });

  it('groupe par palier, et nomme ce qui n’en a aucun', async () => {
    // Une prestation sans offre n'apparaît dans aucun fil. La fondre dans un
    // palier ferait croire l'inverse ; c'est précisément ce que le commerce
    // n'avait aucun moyen de voir.
    const orpheline = { ...ITEM, id: 'i2', name: 'Deep massage' };
    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe({ ...CATALOGUE, '/catalog-items': [ITEM, orpheline] }),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    expect(screen.getByTestId('palier-t1')).toBeTruthy();
    const sansPalier = screen.getByTestId('sans-palier');
    expect(sansPalier).toHaveTextContent(new RegExp(en.composition.sansPalierTitre));
    expect(screen.getByTestId('prestation-i2')).toBeTruthy();
  });

  it('ouvre et ferme par la route de transition, jamais par le correctif', async () => {
    // C'est une transition d'état : elle laisse une trace au journal. Deux
    // chemins pour la même transition finiraient par diverger.
    const envois: { chemin: string; corps: unknown }[] = [];
    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe(CATALOGUE, (chemin, corps) => envois.push({ chemin, corps })),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('ouverture-i1'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].chemin).toContain('/catalog-items/i1/availability');
    expect(envois[0].corps).toEqual({ is_available: false });
  });

  it('dit qu’une prestation est fermée par son parent, et n’offre pas de l’ouvrir', async () => {
    // L'interrupteur de la ligne n'y peut rien : le laisser actif ferait
    // appuyer sur un bouton sans effet.
    const variante = { ...ITEM, is_available: true, is_effectively_available: false };
    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe({ ...CATALOGUE, '/catalog-items': [variante] }),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    expect(screen.getByTestId('ferme-par-parent-i1')).toBeTruthy();
    expect(screen.getByTestId('ouverture-i1').props.accessibilityState.disabled).toBe(true);
  });

  it('publie avec sa durée, et rattache le palier dans le même geste', async () => {
    // Publier puis rattacher en deux temps laisserait une prestation invisible
    // entre les deux, sans que rien ne le dise. Et sans durée, aucun calcul de
    // capacité n'est possible : elle n'ouvrirait jamais un créneau.
    const envois: { chemin: string; corps: unknown }[] = [];
    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe({ ...CATALOGUE, '/catalog-items': [] }, (chemin, corps) =>
        envois.push({ chemin, corps }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('catalogue-vide')).toBeTruthy());

    await fireEvent.press(screen.getByText(en.composition.videAction));
    await fireEvent.changeText(screen.getByTestId('champ-nom'), 'Deep massage');
    await fireEvent.changeText(screen.getByTestId('champ-prix'), '90');
    await fireEvent.press(screen.getByTestId('publier-la-prestation'));

    await waitFor(() => expect(envois).toHaveLength(2));
    expect(envois[0].corps).toMatchObject({ name: 'Deep massage', duration_minutes: 45 });
    expect(envois[1].chemin).toContain('/tier-offers');
  });

  it('écrit la conséquence du palier choisi, pas seulement son nom', async () => {
    // Un palier haut réduit le nombre de créatrices éligibles, et rien ne le
    // disait au moment où le commerce le choisit.
    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe({ ...CATALOGUE, '/catalog-items': [] }),
    );
    await waitFor(() => expect(screen.getByTestId('catalogue-vide')).toBeTruthy());

    await fireEvent.press(screen.getByText(en.composition.videAction));

    expect(screen.getByTestId('consequence-du-palier')).toHaveTextContent(/1,000/);
  });
});

describe('horaires et capacité', () => {
  it('garde les sept jours, et écrit « fermé » plutôt que de retirer la ligne', async () => {
    // Une ligne absente ne dit pas si le jour est fermé ou si le commerce n'a
    // rien rempli. Les deux se corrigent différemment.
    await monter(
      <HorairesScreen businessId="b1" />,
      clientDe({ '/capacity-rules': [REGLE], '/capacity-exceptions': [] }),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    for (let jour = 0; jour < 7; jour += 1) {
      expect(screen.getByTestId(`jour-${jour}`)).toBeTruthy();
    }
    expect(screen.getByTestId('horaires-0')).toHaveTextContent(/10:00/);
    for (let jour = 1; jour < 7; jour += 1) {
      expect(screen.getByTestId(`ferme-${jour}`)).toHaveTextContent(en.composition.ferme);
    }
  });

  it('crée la règle du jour avec ses horaires et ses postes en une écriture', async () => {
    // Des horaires sans postes n'ouvrent rien, des postes sans horaires
    // n'ouvrent nulle part : la base les porte ensemble.
    const envois: { chemin: string; corps: unknown }[] = [];
    await monter(
      <HorairesScreen businessId="b1" />,
      clientDe({ '/capacity-rules': [REGLE], '/capacity-exceptions': [] }, (chemin, corps) =>
        envois.push({ chemin, corps }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('modifier-2'));
    await fireEvent.press(screen.getByTestId('enregistrer-2'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].corps).toMatchObject({
      weekday: 2,
      start_time: '10:00:00',
      end_time: '19:00:00',
      concurrent_slots: 1,
    });
  });

  it('dit qu’une fermeture n’annule aucune réservation déjà prise', async () => {
    // Un commerce qui croirait annuler en fermant sa journée se tairait auprès
    // de créatrices qui viendront quand même.
    await monter(
      <HorairesScreen businessId="b1" />,
      clientDe({ '/capacity-rules': [REGLE], '/capacity-exceptions': [] }),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    expect(screen.getByText(en.composition.fermerNAnnuleRien)).toBeTruthy();
  });

  it('affiche une date de fermeture sans la faire traverser un fuseau', async () => {
    // `new Date('2026-08-15')` est lu comme minuit UTC : affiché à Miami, le 15
    // devient le 14. Une date de fermeture est une case de calendrier, pas un
    // instant.
    const exception = {
      id: 'e1',
      business_id: 'b1',
      date: '2026-08-15',
      is_closed: true,
      start_time: null,
      end_time: null,
      concurrent_slots: null,
    };
    await monter(
      <HorairesScreen businessId="b1" />,
      clientDe({ '/capacity-rules': [REGLE], '/capacity-exceptions': [exception] }),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    expect(screen.getByTestId('exception-e1')).toHaveTextContent(/15/);
  });
});

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
      annuaire: 'AnnuaireScreen.tsx',
      terrain: 'TerrainScreen.tsx',
  catalogue: 'CatalogueScreen.tsx',
      horaires: 'HorairesScreen.tsx',
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
    //
    // Et l'horloge suit la langue : la journée la forçait sur vingt-quatre
    // heures, à côté d'une échéance qui s'écrivait en AM/PM sur le même écran.
    expect(screen.getByText('10:00 AM')).toBeTruthy();
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

  it('rappelle ce qui était exigé, et le dernier motif', async () => {
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );
    // L'exigence est désormais rendue **à côté de la publication**, pas en
    // ligne isolée : c'est là qu'elle se vérifie.
    await waitFor(() => expect(screen.getByTestId('ce-qui-etait-attendu')).toBeTruthy());
    expect(screen.getByText(new RegExp(LIGNE_DE_FILE.required_mention))).toBeTruthy();
    expect(screen.getByTestId('dernier-motif')).toBeTruthy();
  });

  it('montre ce qu’on demande d’approuver', async () => {
    // Le défaut grave : le commerce voyait un pseudonyme, une prestation,
    // quatre motifs de refus et un bouton — et rien de ce qui avait été publié.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );

    await waitFor(() => expect(screen.getByTestId('preuve-soumise')).toBeTruthy());
  });
});

// --------------------------------------------------------------------------
// activation
// --------------------------------------------------------------------------

describe('activation', () => {
  it('sépare le bloquant de la visibilité', async () => {
    await monter(<ActivationScreen businessId="b1" onActive={jest.fn()} />, clientDe({ '/activation': vueDActivation(ETAPES) }));
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
    await monter(<ActivationScreen businessId="b1" onActive={jest.fn()} />, clientDe({ '/activation': vueDActivation(ETAPES) }));
    await waitFor(() => expect(screen.getByTestId('compte-etapes')).toBeTruthy());
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('offre l’ouverture quand les deux bloquantes sont faites', async () => {
    await monter(<ActivationScreen businessId="b1" onActive={jest.fn()} />, clientDe({ '/activation': vueDActivation(ETAPES) }));
    await waitFor(() => expect(screen.getByTestId('ouvrir')).toBeTruthy());
  });

  it('retire l’ouverture quand une bloquante manque', async () => {
    // Retirée et non grisée : elle redeviendra possible, mais le griser
    // demanderait de deviner laquelle manque.
    const incomplete = ETAPES.map((e) => (e.cle === 'address' ? { ...e, done: false } : e));
    await monter(
      <ActivationScreen businessId="b1" onActive={jest.fn()} />,
      clientDe({ '/activation': vueDActivation(incomplete) }),
    );
    await waitFor(() => expect(screen.getByTestId('etape-address')).toBeTruthy());
    expect(screen.queryByTestId('ouvrir')).toBeNull();
  });

  it('ne propose pas d’ouvrir un commerce déjà ouvert', async () => {
    // L'écran ne lisait que les étapes : six faites, donc « ouvrir mon
    // commerce » — à un salon ouvert depuis des semaines. Les étapes disent ce
    // qui est prêt, pas ce qui a été décidé.
    const toutes = ETAPES.map((e) => ({ ...e, done: true }));
    await monter(
      <ActivationScreen businessId="b1" onActive={jest.fn()} />,
      clientDe({ '/activation': vueDActivation(toutes, 'active') }),
    );

    await waitFor(() => expect(screen.getByTestId('deja-ouvert')).toBeTruthy());
    expect(screen.queryByTestId('ouvrir')).toBeNull();
    // Et la seule action qui reste a du sens : se retirer du fil.
    expect(screen.getByTestId('mettre-en-pause')).toBeTruthy();
  });

  it('dit qu’un commerce ouvert reste invisible s’il manque une étape', async () => {
    // Ouvert et introuvable est le pire des deux : rien ne le signale, et le
    // commerce attend des réservations qui ne peuvent pas venir.
    const sansOffre = ETAPES.map((e) => ({ ...e, done: e.cle !== 'tier_offer' }));
    await monter(
      <ActivationScreen businessId="b1" onActive={jest.fn()} />,
      clientDe({ '/activation': vueDActivation(sansOffre, 'active') }),
    );

    await waitFor(() => expect(screen.getByTestId('deja-ouvert')).toBeTruthy());
    expect(screen.getByText(en.commerce.activationOuvertMaisInvisible)).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// arbitrage
// --------------------------------------------------------------------------

describe('arbitrage', () => {
  /**
   * Le nom accessible d'une issue, tel que la barre le porte.
   *
   * « Approve » seul ne disait pas ce qu'on approuvait : trois boutons
   * identiques d'un dossier à l'autre, et rien pour les distinguer une fois la
   * barre lue hors de son panneau.
   */
  const surLeDossier = (issue: string) =>
    en.admin.issueSurDossier
      .replace('{{issue}}', issue)
      .replace('{{createur}}', DOSSIER_EN_ARBITRAGE.creator_handle)
      .replace('{{prestation}}', DOSSIER_EN_ARBITRAGE.item_name)
      .replace('{{commerce}}', DOSSIER_EN_ARBITRAGE.business_name);

  it('nomme ce sur quoi porte chaque issue', async () => {
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    // Le libellé visible nomme l'objet **et son écart**, et le nom accessible
    // nomme le dossier. Le dernier reproche de ce dossier porte sur le format.
    const bouton = screen.getByLabelText(surLeDossier(en.admin.issueApproveMalgreFormat));
    expect(bouton).toBeTruthy();
    for (const attendu of [
      DOSSIER_EN_ARBITRAGE.creator_handle,
      DOSSIER_EN_ARBITRAGE.item_name,
      DOSSIER_EN_ARBITRAGE.business_name,
    ]) {
      expect(bouton.props.accessibilityLabel).toContain(attendu);
    }
  });

  it('offre l’approbation sans motif, et rien d’autre', async () => {
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    expect(screen.getByLabelText(surLeDossier(en.admin.issueApproveMalgreFormat))).toBeTruthy();
    expect(screen.queryByLabelText(surLeDossier(en.admin.issueResubmit))).toBeNull();
    expect(screen.queryByLabelText(surLeDossier(en.admin.issueUnfulfilled))).toBeNull();
  });

  it('ouvre les deux autres issues dès qu’un motif est choisi', async () => {
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    await fireEvent.press(screen.getByText(en.commerce.motifMention));

    expect(screen.getByLabelText(surLeDossier(en.admin.issueResubmit))).toBeTruthy();
    // La clôture n'existe que là. Le commerce ne la voit nulle part.
    expect(screen.getByLabelText(surLeDossier(en.admin.issueUnfulfilled))).toBeTruthy();
  });

  it('montre ce sur quoi porte la décision, pas seulement un pseudonyme', async () => {
    // C'est l'écran où la décision est la plus lourde, et la seule qui ne se
    // rouvre pas. L'arbitre n'avait ni la publication d'origine, ni l'aperçu
    // archivé : il tranchait sur un nom de prestation.
    await monter(
      <ArbitrageScreen />,
      clientDe({
        '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE],
        // Le chemin complet, préfixe de version compris, tel que le serveur le
        // calcule depuis la route montée. Le décor l'écrivait sans préfixe, ce
        // que le serveur faisait aussi — et l'aperçu tombait sur un 404 en ligne.
        '/proofs/p1/access': { url: `${PREFIXE}/proofs/p1?t=jeton`, expires_in: 300 },
      }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    await waitFor(() => expect(screen.getByTestId('apercu-de-la-preuve')).toBeTruthy());
    expect(screen.getByTestId('ouvrir-la-publication')).toBeTruthy();
  });

  it('écrit le motif dans la langue de l’interface', async () => {
    // Il s'affichait en français au milieu d'un écran anglais : le motif
    // voyageait en texte libre et ressortait tel qu'il avait été écrit.
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    expect(screen.getByTestId('dernier-motif')).toHaveTextContent(
      new RegExp(en.commerce.motifFormat),
    );
    // Et aucun code interne ne transparaît.
    expect(screen.queryByText(/wrong_format/)).toBeNull();
  });

  it('montre les trois tentatives, pas seulement la dernière', async () => {
    // C'est l'historique qui justifie l'escalade : trois fois le même reproche
    // et trois reproches différents n'appellent pas la même décision.
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    const historique = screen.getByTestId('historique');
    for (const motif of [en.commerce.motifMention, en.commerce.motifLieu, en.commerce.motifFormat]) {
      expect(historique).toHaveTextContent(new RegExp(motif));
    }
  });

  it('envoie le code du motif, jamais son libellé traduit', async () => {
    // Le libellé partait dans le journal et devenait illisible pour qui ne
    // parle pas la langue de l'arbitre. C'est ce que le code évite.
    const envois: unknown[] = [];
    await monter(
      <ArbitrageScreen />,
      clientDe(
        { '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE] },
        (chemin, corps) => envois.push({ chemin, corps }),
      ),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    await fireEvent.press(screen.getByText(en.commerce.motifMention));
    await fireEvent.press(screen.getByLabelText(surLeDossier(en.admin.issueResubmit)));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      corps: { issue: 'resubmit', reason: 'missing_mention' },
    });
  });

  it.each([
    ['missing_location', 'issueApproveSansLieu'],
    ['missing_mention', 'issueApproveSansMention'],
    ['wrong_format', 'issueApproveMalgreFormat'],
    ['low_quality', 'issueApproveMalgreQualite'],
  ] as const)('sur %s, le bouton nomme son écart', async (motif, cle) => {
    // **Le défaut de campagne.** « Approve » seul ne disait pas ce qu'on
    // approuvait. Dans une file où l'on tranche vingt dossiers à la chaîne, un
    // verbe seul finit par vouloir dire « suivant » — et c'est la seule
    // décision du produit qui ne se rouvre pas.
    const dossier = {
      ...DOSSIER_EN_ARBITRAGE,
      tentatives: [{ motif, demandee_le: '2026-08-09T09:00:00Z', par: 'business_member' }],
    };
    await monter(<ArbitrageScreen />, clientDe({ '/admin/collaborations/review': [dossier] }), 'admin');
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    expect(screen.getByLabelText(surLeDossier(en.admin[cle]))).toBeTruthy();
    // Et le libellé nu n'est plus offert : c'est lui qu'on pressait sans lire.
    expect(screen.queryByLabelText(surLeDossier(en.admin.issueApprove))).toBeNull();
  });

  it('redevient simple quand il n’y a aucun écart à excuser', async () => {
    // « L'écart n'existe que s'il y en a un. » Annoncer « sans la mention » sur
    // un dossier conforme ferait douter de l'approbation elle-même.
    const dossier = { ...DOSSIER_EN_ARBITRAGE, tentatives: [] };
    await monter(<ArbitrageScreen />, clientDe({ '/admin/collaborations/review': [dossier] }), 'admin');
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    expect(screen.getByLabelText(surLeDossier(en.admin.issueApprove))).toBeTruthy();
  });

  it('désigne la ligne qui manque, et ne prétend rien sur les autres', async () => {
    // L'attendu et le constaté face à face. Le constaté vient du reproche et
    // non d'une lecture automatique : aux niveaux 2 et 3, la preuve ne porte
    // ni auteur, ni format, ni mention, et écrire « conforme » en face d'une
    // ligne que personne n'a vérifiée serait indéfendable devant un salon.
    const dossier = {
      ...DOSSIER_EN_ARBITRAGE,
      tentatives: [
        { motif: 'missing_location', demandee_le: '2026-08-09T09:00:00Z', par: 'business_member' },
      ],
    };
    await monter(<ArbitrageScreen />, clientDe({ '/admin/collaborations/review': [dossier] }), 'admin');
    await waitFor(() => expect(screen.getByTestId('attendu-et-constate')).toBeTruthy());

    expect(screen.getByTestId('manque-lieu')).toBeTruthy();
    expect(screen.queryByTestId('manque-mention')).toBeNull();
    expect(screen.queryByTestId('manque-format')).toBeNull();
    // Et l'écran dit d'où vient le constat, plutôt que de le faire passer pour
    // une vérification de la plateforme.
    expect(screen.getByTestId('constat-humain')).toBeTruthy();
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
    // Deux fois depuis la campagne 2 : sur la ligne du plan, et sur la ligne
    // de total — il n'y a qu'un plan dans ce jeu, les deux coïncident.
    expect(screen.getAllByText('990.00 USD').length).toBeGreaterThan(0);
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
  it('ne montre aucun montant, même quand la réponse en porte un', async () => {
    // **Le défaut relevé par Design.** La page portait « ce que vous avez
    // donné · 4 280,00 USD ». La règle de la carte d'API est qu'aucun montant
    // ne figure dans une réponse destinée aux applications créateur et
    // commerce ; la réponse en porte encore un, et le client l'ignore. Ce n'est
    // pas cosmétique : un salon ne compare pas des euros, il compare ce qu'il a
    // donné à ce qu'il a reçu.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    // Le montant que la réponse porte, sous ses deux écritures possibles.
    expect(screen.queryByText(/720[.,]00/)).toBeNull();
    expect(screen.queryByText(new RegExp(REPORTING.currency))).toBeNull();
    // Aucun mot de revenu, de chiffre d'affaires ou de gain non plus.
    for (const mot of [/revenue/i, /earned/i, /income/i, /profit/i]) {
      expect(screen.queryByText(mot)).toBeNull();
    }
  });

  it('remplace le montant par du temps de fauteuil', async () => {
    // Ce qu'un salon donne réellement, calculé sur la durée des prestations et
    // jamais sur un prix.
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({ '/reporting': { ...REPORTING, temps_de_fauteuil_minutes: 4260 } }),
    );
    await waitFor(() => expect(screen.getByTestId('temps-de-fauteuil')).toBeTruthy());

    expect(screen.getByText(en.reporting.heures.replace('{{heures}}', '71'))).toBeTruthy();
  });

  it('dit que le temps de fauteuil manque, au lieu d’afficher zéro', async () => {
    // Absent n'est pas zéro. « 0 heure donnée » à un salon qui a servi
    // quatre-vingt-huit prestations serait faux, et c'est précisément le
    // chiffre censé le convaincre.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('temps-de-fauteuil')).toBeTruthy());

    expect(screen.getByText(en.reporting.tempsIndisponible)).toBeTruthy();
    expect(screen.queryByText(en.reporting.heures.replace('{{heures}}', '0'))).toBeNull();
  });

  it('commence par la phrase, pas par les chiffres', async () => {
    // C'est celle qu'un salon répète à son associé, et elle contient déjà la
    // réponse ; les chiffres qui la composent servent à la vérifier.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('phrase-du-rapport')).toBeTruthy());

    const phrase = screen.getByTestId('phrase-du-rapport').props.children;
    expect(String(phrase)).toContain(String(REPORTING.consommations));
    expect(String(phrase)).toContain(String(REPORTING.publications));
  });

  it('comble les semaines creuses au lieu de resserrer l’axe', async () => {
    // Un `GROUP BY` ne fabrique pas les vides. Afficher les seules semaines
    // publiées resserrerait l'axe : trois publications en trois mois se
    // liraient comme trois semaines de suite.
    //
    // La longueur n'est plus douze mais celle de l'histoire du commerce
    // (campagne 2). Ce qui reste vrai, et ce qui compte ici, c'est qu'entre la
    // première et la dernière trace **aucune semaine ne manque** : deux lignes
    // en base couvrant deux semaines consécutives donnent deux barres, et
    // quatre au minimum, parce qu'une barre seule n'est pas une évolution.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    expect(screen.getByTestId('graphique-par-semaine')).toBeTruthy();
    const barres = screen.getAllByTestId(/^barre-W\d+$/);
    const numeros = barres.map((b) => Number(String(b.props.testID).slice(6)));
    // Consécutifs, sans trou : c'est la propriété, pas le compte.
    expect(numeros).toEqual(
      Array.from({ length: numeros.length }, (_, i) => numeros[0] + i),
    );
    expect(numeros.length).toBeGreaterThanOrEqual(4);
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

  it('rend le taux en fraction, jamais en pourcentage', async () => {
    // Le pendant : sans lui, un écran qui écrirait toujours « rien servi »
    // passerait le test précédent.
    //
    // Et la fraction plutôt que le pourcentage, parce que les deux ensemble se
    // contredisaient : « 29 % » s'affichait au-dessus de « 2 of 7 », qui vaut
    // 28,57. Un seul calcul, arrondi à l'entier au-dessus de sa propre
    // fraction — aucun arrondi ne peut les réconcilier.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('taux')).toBeTruthy());

    expect(screen.getByText('7 / 9')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('ne contredit jamais sa propre fraction, quel que soit le rapport', async () => {
    // Le cas relevé, à l'identique : 2 sur 7 s'arrondit à 29, la fraction dit
    // 28,57. C'est la forme même du défaut, pas un exemple choisi.
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({
        '/reporting': { ...REPORTING, publications: 2, consommations: 7, taux_d_honoration: 0.2857 },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('taux')).toBeTruthy());

    expect(screen.getByText('2 / 7')).toBeTruthy();
    expect(screen.queryByText('29 %')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
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
    // La barre du palier est là : la plateforme inconnue n'a pas empêché la
    // série de se tracer. C'est le format du contenu qui la colore, pas la
    // plateforme — Snapchat n'y change rien.
    expect(screen.getByTestId('graphique-par-palier')).toBeTruthy();
    expect(
      screen.getByTestId(`barre-${REPORTING.par_palier[0].content_format}`),
    ).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// campagne 2 : l'axe suit la vie du commerce
// --------------------------------------------------------------------------

describe('les rapports, après la campagne 2', () => {
  /** Le lundi d'il y a `n` semaines, en date ISO. */
  function lundiIlYA(n: number): string {
    const jour = new Date();
    jour.setUTCDate(jour.getUTCDate() - ((jour.getUTCDay() + 6) % 7) - n * 7);
    return jour.toISOString().slice(0, 10);
  }

  function reportingDe(semaines: { debut: string; publications: number }[]) {
    return {
      ...REPORTING,
      fin: new Date().toISOString(),
      par_semaine: semaines,
    };
  }

  it('ne dessine pas huit semaines vides à un salon qui vient d’ouvrir', async () => {
    // « Une seule barre visible sur douze. » Ce n'était pas le graphique :
    // c'était un axe qui décrivait une histoire que le commerce n'avait pas.
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({
        '/reporting': reportingDe([
          { debut: lundiIlYA(1), publications: 2 },
          { debut: lundiIlYA(0), publications: 3 },
        ]),
      }),
    );
    await waitFor(() => expect(screen.getByTestId('graphique-par-semaine')).toBeTruthy());

    // Quatre : le plancher, parce qu'une barre seule n'est pas une évolution.
    expect(screen.getAllByTestId(/^barre-W\d+$/)).toHaveLength(4);
  });

  it('ouvre l’axe à mesure que l’histoire s’allonge', async () => {
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({
        '/reporting': reportingDe([
          { debut: lundiIlYA(6), publications: 1 },
          { debut: lundiIlYA(0), publications: 4 },
        ]),
      }),
    );
    await waitFor(() => expect(screen.getByTestId('graphique-par-semaine')).toBeTruthy());

    expect(screen.getAllByTestId(/^barre-W\d+$/)).toHaveLength(7);
  });

  it('s’arrête à douze, au-delà desquelles les étiquettes ne se lisent plus', async () => {
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({
        '/reporting': reportingDe([
          { debut: lundiIlYA(40), publications: 1 },
          { debut: lundiIlYA(0), publications: 4 },
        ]),
      }),
    );
    await waitFor(() => expect(screen.getByTestId('graphique-par-semaine')).toBeTruthy());

    expect(screen.getAllByTestId(/^barre-W\d+$/)).toHaveLength(12);
  });

  it('met en tête les trois chiffres qui répondent à la question', async () => {
    // « Une longue liste de chiffres sans hiérarchie » : le nombre qui dit si
    // ça marche se lisait exactement comme le nombre d'annulations.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('reperes')).toBeTruthy());

    for (const cle of ['publications', 'taux', 'portee']) {
      expect(screen.getByTestId(`repere-${cle}`)).toBeTruthy();
    }
  });

  it('n’écrit aucun de ces trois chiffres deux fois', async () => {
    // Le défaut corrigé sur la journée, à ne pas réintroduire ici : un chiffre
    // en tête **et** dans le détail se lit comme deux mesures différentes.
    await monter(<ReportingScreen businessId="b1" />, clientDe({ '/reporting': REPORTING }));
    await waitFor(() => expect(screen.getByTestId('reperes')).toBeTruthy());

    expect(screen.getAllByTestId('taux')).toHaveLength(1);
    expect(screen.getAllByText(en.reporting.porteeNote)).toHaveLength(1);
    expect(screen.getAllByText(en.reporting.publications)).toHaveLength(1);
  });

  it('dit à un salon sans histoire qu’il n’y a rien à régler', async () => {
    // « Rien dans cette fenêtre » se lisait comme une panne de filtre. Il n'y
    // a pas de fenêtre à corriger : il n'y a pas encore d'histoire.
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({ '/reporting': { ...REPORTING, reservations: 0, par_semaine: [] } }),
    );
    await waitFor(() => expect(screen.getByTestId('reporting-vide')).toBeTruthy());

    expect(screen.getByText(en.reporting.videTitre)).toBeTruthy();
    expect(screen.getByTestId('reporting-vide')).toHaveTextContent(/nothing to set up/i);
  });
});

// --------------------------------------------------------------------------
// la proposition de palier, sur l'écran du catalogue
// --------------------------------------------------------------------------

describe('le conseil de palier', () => {
  /** Trois prix distincts : le minimum pour qu'une distribution existe. */
  const CATALOGUE = [
    { ...ITEM, id: 'bas', name: 'Pose vernis', price_cents: 2_000 },
    { ...ITEM, id: 'milieu', name: 'Manucure', price_cents: 5_000 },
    { ...ITEM, id: 'haut', name: 'Soin complet', price_cents: 12_000 },
  ];
  const TROIS_PALIERS = [
    { ...PALIER, id: 't1', content_format: 'story', min_followers: 1_000 },
    { ...PALIER, id: 't2', content_format: 'post', min_followers: 10_000 },
    { ...PALIER, id: 't3', content_format: 'reel', min_followers: 50_000 },
  ];

  function catalogueDe(offres: Record<string, unknown>[]) {
    return clientDe({
      '/catalog-items': CATALOGUE,
      '/tier-offers': offres,
      '/tiers': TROIS_PALIERS,
      '/photos': [],
    '/menu': [],
      '/business/b1': { cover_photo_key: null, menu_url: null },
    });
  }

  it('propose un palier à la prestation qui n’en a aucun', async () => {
    // C'est là que le conseil vaut le plus : il n'y a rien d'autre à lire.
    await monter(<CatalogueScreen businessId="b1" />, catalogueDe([]), 'merchant');
    await waitFor(() => expect(screen.getByTestId('propose-haut')).toBeTruthy());

    expect(screen.getByTestId('propose-haut')).toHaveTextContent(/REEL/);
    expect(screen.getByTestId('propose-bas')).toHaveTextContent(/STORY/);
  });

  it('se tait quand le commerce suit le conseil', async () => {
    // Un message qui approuve chaque ligne devient un bruit qu'on n'écoute
    // plus, et le jour où il alerte vraiment, il est déjà invisible.
    await monter(
      <CatalogueScreen businessId="b1" />,
      catalogueDe([
        { ...OFFRE, id: 'o1', tier_id: 't3', catalog_item_id: 'haut', content_format: 'reel' },
      ]),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('prestation-haut')).toBeTruthy());

    expect(screen.queryByTestId('conseil-haut')).toBeNull();
    expect(screen.queryByTestId('propose-haut')).toBeNull();
  });

  it('chiffre ce que coûte un palier plus exigeant que le conseil', async () => {
    // « Moins de créatrices » ne se mesure pas. « 50 000 abonnés au lieu de
    // 1 000 » se mesure, et c'est le seul chiffre que le commerce peut peser.
    await monter(
      <CatalogueScreen businessId="b1" />,
      catalogueDe([
        { ...OFFRE, id: 'o1', tier_id: 't3', catalog_item_id: 'bas', content_format: 'reel' },
      ]),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('conseil-bas')).toBeTruthy());

    // Séparés par milliers, comme partout ailleurs : « 50000 » se compte à la
    // main, et c'est un chiffre qu'on lit pour décider.
    const conseil = screen.getByTestId('conseil-bas');
    expect(conseil).toHaveTextContent(/REEL/);
    expect(conseil).toHaveTextContent(/50,000/);
    expect(conseil).toHaveTextContent(/1,000/);
  });

  it('dit l’autre risque quand le palier est plus bas que le conseil', async () => {
    // Une prestation de valeur contre l'engagement le plus léger : ce n'est pas
    // une erreur, mais ce n'est pas la même décision, et elle doit se voir.
    await monter(
      <CatalogueScreen businessId="b1" />,
      catalogueDe([
        { ...OFFRE, id: 'o1', tier_id: 't1', catalog_item_id: 'haut', content_format: 'story' },
      ]),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('conseil-haut')).toBeTruthy());

    expect(screen.getByTestId('conseil-haut')).toHaveTextContent(/lightest commitment/i);
  });

  it('ne compte pas le parent d’une gamme dans la distribution', async () => {
    // Un parent ne se réserve pas et son prix est nul ou décoratif. Le laisser
    // dans la distribution ajouterait un prix bas qui décalerait tous les rangs
    // vers le haut — et le conseil se tromperait sur chaque ligne.
    // Le prix du parent est **décoratif** — « Coloration, à partir de 90 » —
    // et se place au milieu de la gamme. À zéro il se compenserait de
    // lui-même : un prix de plus en bas décale les rangs d'un cran et le
    // diviseur aussi. C'est un parent au milieu qui déplace vraiment une
    // frontière, et c'est le cas qu'il faut éprouver.
    const parent = {
      ...ITEM,
      id: 'gamme',
      name: 'Coloration',
      price_cents: 9_000,
      requires_booking: false,
      duration_minutes: null,
    };
    const variante = { ...CATALOGUE[0], id: 'bas', parent_item_id: 'gamme' };

    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe({
        '/catalog-items': [parent, variante, CATALOGUE[1], CATALOGUE[2]],
        '/tier-offers': [],
        '/tiers': TROIS_PALIERS,
        '/photos': [],
    '/menu': [],
        '/business/b1': { cover_photo_key: null, menu_url: null },
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('propose-haut')).toBeTruthy());

    // Les trois prestations réelles gardent les trois paliers. Avec le parent
    // compté, « bas » et « milieu » glisseraient tous deux sur story.
    expect(screen.getByTestId('propose-bas')).toHaveTextContent(/STORY/);
    expect(screen.getByTestId('propose-milieu')).toHaveTextContent(/POST/);
    expect(screen.getByTestId('propose-haut')).toHaveTextContent(/REEL/);
  });

  it('ne conseille rien sur un catalogue sans distribution', async () => {
    // Deux prix ne font pas une échelle. Conseiller quand même reviendrait à
    // inventer, sur l'écran où le commerce prend ses décisions.
    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe({
        '/catalog-items': CATALOGUE.slice(0, 2),
        '/tier-offers': [],
        '/tiers': TROIS_PALIERS,
        '/photos': [],
    '/menu': [],
        '/business/b1': { cover_photo_key: null, menu_url: null },
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('prestation-bas')).toBeTruthy());

    expect(screen.queryByTestId('propose-bas')).toBeNull();
    expect(screen.queryByTestId('conseil-bas')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// l'annuaire : ce qu'un salon achète, et ce qu'il n'a pas le droit de voir
// --------------------------------------------------------------------------

describe('l’annuaire des créateurs', () => {
  it('ne montre aucun score, et le dit', async () => {
    // Le produit promet à la créatrice, sur son écran, que son score n'est
    // « jamais comparé entre créatrices, jamais montré à un commerce ». Sans la
    // ligne d'explication, un salon cherche une note, ne la trouve pas, et
    // conclut à un oubli — puis la réclame.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': [CREATEUR_DE_L_ANNUAIRE] }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    expect(screen.getByTestId('ce-que-le-palier-dit')).toHaveTextContent(/never show you a rating/i);
    expect(screen.getByTestId('ce-que-le-palier-dit')).toHaveTextContent(/never rank/i);
    // Aucun nombre sur cent nulle part : c'est la forme qu'aurait un score.
    expect(screen.queryByText(/\/\s*100/)).toBeNull();
  });

  it('montre les paliers ouverts, qui portent l’information à sa place', async () => {
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': [CREATEUR_DE_L_ANNUAIRE] }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    const fiche = screen.getByTestId('createur-c1');
    expect(fiche).toHaveTextContent(/STORY/);
    expect(fiche).toHaveTextContent(/POST/);
    expect(fiche).not.toHaveTextContent(/REEL/);
  });

  it('dit qu’aucun palier n’est ouvert sans en faire un reproche', async () => {
    // Une audience qui n'atteint pas le premier seuil n'est pas un manquement,
    // et l'annuaire ne doit pas se lire comme un jugement.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': [{ ...CREATEUR_DE_L_ANNUAIRE, paliers_ouverts: [] }] }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('sans-palier-c1')).toBeTruthy());
  });

  it('explique l’abonnement au lieu de proposer de réessayer', async () => {
    // Un refus de paiement n'est pas une panne : « réessayer » ne mène nulle
    // part, il y a un abonnement à prendre.
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async () =>
        ({
          ok: false,
          status: 402,
          json: async () => ({ detail: 'subscription_required' }),
        }) as Response,
    });
    await monter(<AnnuaireScreen businessId="b1" />, api, 'merchant');

    await waitFor(() => expect(screen.getByTestId('annuaire-sans-abonnement')).toBeTruthy());
    expect(screen.queryByTestId('etat-erreur')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// la note libre, des deux côtés de la décision
// --------------------------------------------------------------------------

/**
 * Le seul message possible entre un salon et un créateur était un code dans une
 * liste fermée de quatre. Un dossier arrivait en arbitrage après trois
 * allers-retours sans qu'aucune phrase n'ait été échangée.
 *
 * **La note ne remplace jamais le motif**, et l'app ne tente pas de l'y faire
 * entrer : le serveur refuse une note seule jusque dans une contrainte de base,
 * et le champ n'apparaît qu'une fois un motif choisi.
 */
describe('la note libre côté commerce', () => {
  const AVEC_NOTE = {
    ...LIGNE_DE_FILE,
    derniere_soumission: {
      ...LIGNE_DE_FILE.derniere_soumission,
      note: 'Le sticker est en haut à droite, la mention est dessous.',
    },
  };

  it('montre ce que la créatrice a écrit, à côté de sa preuve', async () => {
    // Sinon le commerce décide en ayant vu l'image sans avoir lu la phrase,
    // ce qui est exactement la situation qu'on répare.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [AVEC_NOTE] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());

    expect(screen.getByTestId('note-du-createur')).toHaveTextContent(/en haut à droite/);
  });

  it('n’offre pas d’écrire une note avant d’avoir choisi un motif', async () => {
    // Une note ne voyage jamais seule. Offrir la saisie avant le motif ferait
    // écrire une phrase qui serait rejetée par le serveur.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());

    expect(screen.queryByTestId('note')).toBeNull();

    await fireEvent.press(screen.getByText(en.commerce.motifMention));
    expect(screen.getByTestId('note')).toBeTruthy();
  });

  it('envoie la note avec son motif, jamais sans', async () => {
    const envois: unknown[] = [];
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }, (chemin, corps) =>
        envois.push({ chemin, corps }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());

    await fireEvent.press(screen.getByText(en.commerce.motifMention));
    await fireEvent.changeText(screen.getByTestId('note'), '  Le sticker cache la mention.  ');
    await fireEvent.press(screen.getByTestId('redemander'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      // Vidée de ses espaces : une note faite d'un seul retour à la ligne
      // occuperait une place à l'écran sans rien dire.
      corps: { approuve: false, reason: 'missing_mention', note: 'Le sticker cache la mention.' },
    });
  });

  it('n’envoie aucune note sur une approbation, même écrite', async () => {
    // **Le cas réel** : on choisit un motif, on écrit une phrase, puis on
    // change d'avis et on approuve. Approuver n'accepte pas de motif ; la note
    // serait donc seule, et le serveur refuserait l'approbation avec elle —
    // sur le geste le plus banal de l'écran.
    const envois: unknown[] = [];
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }, (chemin, corps) =>
        envois.push({ chemin, corps }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());

    await fireEvent.press(screen.getByText(en.commerce.motifMention));
    await fireEvent.changeText(screen.getByTestId('note'), 'Finalement ça me va.');
    await fireEvent.press(screen.getByTestId('approuver'));

    await waitFor(() => expect(envois).toHaveLength(1));
    const corps = (envois[0] as { corps: Record<string, unknown> }).corps;
    expect(corps.approuve).toBe(true);
    expect(corps.note).toBeUndefined();
    expect(corps.reason).toBeUndefined();
  });

  it('borne la saisie à ce que le serveur accepte', async () => {
    // Recopiée plutôt que demandée ; le test compare les deux valeurs.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());
    await fireEvent.press(screen.getByText(en.commerce.motifMention));

    expect(screen.getByTestId('note').props.maxLength).toBe(NOTE_MAXIMUM);
  });
});

describe('la note libre à l’arbitrage', () => {
  const surLeDossier = (issue: string) =>
    en.admin.issueSurDossier
      .replace('{{issue}}', issue)
      .replace('{{createur}}', DOSSIER_EN_ARBITRAGE.creator_handle)
      .replace('{{prestation}}', DOSSIER_EN_ARBITRAGE.item_name)
      .replace('{{commerce}}', DOSSIER_EN_ARBITRAGE.business_name);

  it('montre les notes de chaque demande, sous leur motif', async () => {
    // C'est la répétition qui justifie l'escalade, et trois fois le même code
    // avec trois explications différentes ne se lit pas comme trois fois la
    // même chose.
    const avecNotes = {
      ...DOSSIER_EN_ARBITRAGE,
      tentatives: [
        {
          motif: 'missing_mention',
          note: 'La mention est absente.',
          demandee_le: '2026-08-07T09:00:00Z',
          par: 'business_member',
        },
        {
          motif: 'missing_mention',
          note: 'Toujours absente, et la story a changé.',
          demandee_le: '2026-08-08T09:00:00Z',
          par: 'business_member',
        },
      ],
    };
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [avecNotes] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    expect(screen.getByTestId('note-tentative-0')).toHaveTextContent(/La mention est absente/);
    expect(screen.getByTestId('note-tentative-1')).toHaveTextContent(/la story a changé/);
  });

  it('envoie la note de l’arbitre avec son motif', async () => {
    const envois: unknown[] = [];
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE] }, (chemin, corps) =>
        envois.push({ chemin, corps }),
      ),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    await fireEvent.press(screen.getByText(en.commerce.motifMention));
    await fireEvent.changeText(screen.getByTestId('note'), 'Trois fois le même reproche.');
    await fireEvent.press(screen.getByLabelText(surLeDossier(en.admin.issueResubmit)));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      corps: {
        issue: 'resubmit',
        reason: 'missing_mention',
        note: 'Trois fois le même reproche.',
      },
    });
  });

  it('n’offre pas la saisie avant qu’un motif soit choisi', async () => {
    await monter(
      <ArbitrageScreen />,
      clientDe({ '/admin/collaborations/review': [DOSSIER_EN_ARBITRAGE] }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('dossier-k1')).toBeTruthy());

    expect(screen.queryByTestId('note')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// deux règles du lot 2, tenues mécaniquement
// --------------------------------------------------------------------------

describe('aucun montant sur un écran de lecture', () => {
  /**
   * Les trois écrans où un montant a le droit de paraître, avec leur raison.
   *
   * Aucun n'est un écran de **lecture** côté commerce. La règle de la carte
   * d'API — aucun montant dans une réponse destinée aux applications créateur
   * et commerce — se traduit ici en une règle que le code peut tenir : ce qui
   * est *lu* ne porte pas de montant, ce qui est *saisi* porte ce que le salon
   * a tapé lui-même.
   */
  const TOLERES: Record<string, string> = {
    'PlansScreen.tsx':
      "seul écran du produit à afficher des montants, et il est du back-office : " +
      "c'est ce que BIND facture, pas ce qu'un salon donne.",
    'CatalogueScreen.tsx':
      "le prix que le salon tape lui-même sur sa propre carte. Il est une donnée " +
      "de reporting interne, jamais un avoir, et jamais montré à une créatrice.",
    'MenuReviewScreen.tsx':
      "la relecture d'une carte importée : les prix extraits se corrigent avant " +
      "de créer les items.",
  };

  const { readdirSync, readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const DOSSIER = join(__dirname, '..', 'src', 'screens');

  it('aucun écran de lecture ne formate un montant', () => {
    const fautifs: string[] = [];
    for (const fichier of readdirSync(DOSSIER).filter((f) => f.endsWith('.tsx'))) {
      if (TOLERES[fichier]) continue;
      readFileSync(join(DOSSIER, fichier), 'utf-8')
        .split('\n')
        .forEach((ligne, index) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
          // Les deux façons d'écrire un montant : la maison — `formatMoney` —
          // et la division à la main, qui est celle que la page de rapports
          // employait.
          if (/formatMoney\s*\(|_cents\s*\/\s*100/.test(ligne)) {
            fautifs.push(`${fichier}:${index + 1} → ${ligne.trim()}`);
          }
        });
    }

    expect(fautifs).toEqual([]);
  });

  it('la garde attrape les deux formes, et rien d’innocent', () => {
    const attrape = (l: string) =>
      /formatMoney\s*\(|_cents\s*\/\s*100/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l);

    expect(attrape('  value={formatMoney(plan.price_cents, plan.currency, locale)}')).toBe(true);
    expect(attrape('  value={`${(vue.valeur_offerte_cents / 100).toFixed(2)} ${vue.currency}`}')).toBe(true);
    expect(attrape('  // formatMoney( est réservé aux plans')).toBe(false);
    expect(attrape('  const minutes = vue.temps_de_fauteuil_minutes / 60;')).toBe(false);
  });

  it('chaque tolérance nomme un écran qui existe et qui s’en sert', () => {
    // Une tolérance qui ne sert plus fait croire que la règle a une exception
    // là où elle n'en a plus.
    for (const [fichier, raison] of Object.entries(TOLERES)) {
      const source = readFileSync(join(DOSSIER, fichier), 'utf-8');
      expect({ fichier, sert: /formatMoney\s*\(|price_cents/.test(source) }).toEqual({
        fichier,
        sert: true,
      });
      expect(raison.length).toBeGreaterThan(40);
    }
  });
});

describe('l’annuaire est en lecture seule', () => {
  it('ne porte aucune action au-delà de la lecture', async () => {
    // **Décision de produit, et non un trou à combler.** Aucune route
    // d'invitation ni de message n'existe, dans aucun sens : le produit circule
    // dans un seul sens, la créatrice choisit et réserve. L'abonnement achète
    // donc de la *visibilité*, pas du contact — et il ne faut surtout pas de
    // bouton qui n'existe pas derrière.
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const source = readFileSync(
      join(__dirname, '..', 'src', 'screens', 'AnnuaireScreen.tsx'),
      'utf-8',
    );

    for (const interdit of [/<Button/, /onPress/, /accessibilityRole="button"/]) {
      expect({ interdit: String(interdit), present: interdit.test(source) }).toEqual({
        interdit: String(interdit),
        present: false,
      });
    }
  });

  it('et l’API ne lui en offre aucune', () => {
    // La garde précédente regarde l'écran ; celle-ci regarde ce qu'il pourrait
    // appeler. Un client qui exposerait « inviter » ou « contacter » ferait de
    // la lecture seule une discipline, et une discipline finit par céder.
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const routes = readFileSync(join(__dirname, '..', 'src', 'api', 'routes.ts'), 'utf-8');

    for (const interdit of ['invite', 'contact', 'message']) {
      expect({ interdit, present: routes.includes(interdit) }).toEqual({
        interdit,
        present: false,
      });
    }
  });
});

describe('la journée se coupe par ce qu’elle demande', () => {
  const RESERVATION = (id: string, status: string) => ({
    ...JOURNEE.items[0],
    booking_id: id,
    status,
  });

  it('sépare ce qui attend, ce qui est servi et ce qui est clos', async () => {
    // **Le tri par statut mélangeait deux choses.** Une absence à constater et
    // une prestation servie la veille se lisaient dans la même colonne, au même
    // poids. Un statut ne devient une section que s'il change ce que la
    // vendeuse doit faire.
    const journee = {
      ...JOURNEE,
      a_trancher: [],
      items: [
        RESERVATION('b-attendue', 'confirmed'),
        RESERVATION('b-servie', 'consumed'),
        RESERVATION('b-close', 'no_show'),
      ],
    };
    await monter(<JourneeScreen businessId="b1" />, clientDe({ '/bookings': journee }));
    await waitFor(() => expect(screen.getByTestId('planning')).toBeTruthy());

    expect(screen.getByTestId('servies')).toBeTruthy();
    expect(screen.getByTestId('closes')).toBeTruthy();

    // Et chaque ligne est dans la bonne : c'est le rangement qui est le test,
    // pas la présence des trois titres.
    expect(screen.getByTestId('planning')).toContainElement(screen.getByTestId('ligne-b-attendue'));
    expect(screen.getByTestId('servies')).toContainElement(screen.getByTestId('ligne-b-servie'));
    expect(screen.getByTestId('closes')).toContainElement(screen.getByTestId('ligne-b-close'));
  });

  it('n’ouvre pas une section vide', async () => {
    // Un titre « 0 servie » est une ligne de plus à lire chaque matin pour
    // apprendre qu'il n'y a rien à lire.
    const journee = {
      ...JOURNEE,
      a_trancher: [],
      items: [RESERVATION('b-attendue', 'confirmed')],
    };
    await monter(<JourneeScreen businessId="b1" />, clientDe({ '/bookings': journee }));
    await waitFor(() => expect(screen.getByTestId('planning')).toBeTruthy());

    expect(screen.queryByTestId('servies')).toBeNull();
    expect(screen.queryByTestId('closes')).toBeNull();
  });
});

describe('le mode terrain dit son avancement sans l’écrire', () => {
  it('un segment par champ rempli, et zéro n’est pas une absence de filet', async () => {
    // **Debout, à une main, entre deux clientes.** Le filet segmenté remplace
    // le compteur « 2 sur 3 » : on voit où l'on en est sans lire. Il compte ce
    // qui est **rempli**, pas ce qui est obligatoire — la fiche part avec le
    // nom seul, et une fiche à trois champs vaut mieux qu'une fiche
    // abandonnée.
    await monter(<TerrainScreen />, clientDe({ '/admin/prospects': [FICHE_PREPAREE] }), 'merchant');
    await waitFor(() => expect(screen.getByTestId('formulaire-de-fiche')).toBeTruthy());

    const segment = (i: number) =>
      screen.getByTestId(`avancement-de-la-fiche-segment-${i}`).props.style.backgroundColor;

    // Rien de saisi : trois segments, aucun franchi. Le filet existe quand
    // même — un parcours à zéro pour cent n'est pas l'absence de parcours.
    expect(screen.getByTestId('avancement-de-la-fiche')).toBeTruthy();
    const eteint = segment(0);

    await fireEvent.changeText(screen.getByTestId('champ-nom'), 'Studio Lume');
    await waitFor(() => expect(segment(0)).not.toBe(eteint));
    // Et seul le premier bouge : deux segments allumés pour un champ rempli
    // feraient de la progression une décoration.
    expect(segment(1)).toBe(eteint);
    expect(segment(2)).toBe(eteint);
  });
});
