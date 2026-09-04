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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider, PREFIXE } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { nomDuCreateur } from '../src/screens/nomDuCreateur';
import { couleurs, ThemeProvider, type Role } from '../src/theme';
import { ArbitrageScreen } from '../src/screens/ArbitrageScreen';
import { AbonnementScreen } from '../src/screens/AbonnementScreen';
import { AnnuaireScreen } from '../src/screens/AnnuaireScreen';
import { CreatriceScreen } from '../src/screens/CreatriceScreen';
import { CatalogueScreen } from '../src/screens/CatalogueScreen';
import { HorairesScreen } from '../src/screens/HorairesScreen';
import { LieuScreen } from '../src/screens/LieuScreen';
import { JourneeScreen } from '../src/screens/JourneeScreen';
import { PlansScreen } from '../src/screens/PlansScreen';
import { NOTE_MAXIMUM, PublicationsScreen } from '../src/screens/PublicationsScreen';
import { ReportingScreen } from '../src/screens/ReportingScreen';
import { CommercesScreen } from '../src/screens/CommercesScreen';
import { CreateursAdminScreen } from '../src/screens/CreateursAdminScreen';
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
      absence_signalable_a: '2026-08-08T14:20:00Z',
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
      // Un droit sans créneau : pas d'heure à laquelle ne pas se présenter,
      // donc aucune absence à constater. `SPEC.md` §4.1.
      absence_signalable_a: null,
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
  // **Faux, et c'est le cas courant.** Il valait `true`, si bien que tous les
  // tests de décision du commerce s'exerçaient sur un dossier **qu'un arbitre
  // a en main** — c'est-à-dire précisément celui où le salon ne doit plus
  // décider. Le montage encodait le défaut.
  needs_human_review: false,
  created_at: '2026-08-07T09:00:00Z',
  business_id: 'b1',
  business_name: 'Salón Ocean',
  creator_id: 'u1',
  creator_first_name: 'Rebecca',
  creator_last_name: 'Alvarez',
  creator_handle: 'rebecca.miami',
  // Servi par le serveur sur chaque ligne : le poser ici plutôt que de le
  // laisser absent, sinon le cas courant s'éprouve sur `undefined` et non sur
  // ce que la file rend vraiment.
  creator_partie: false,
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
  // **Gardés dans le décor alors que la route ne les sert plus** (#201), et
  // c'est délibéré : le test qui refuse « Moreau » à l'écran doit continuer
  // d'avoir quelque chose à refuser. Les retirer d'ici le rendrait vert sans
  // rien éprouver, et le jour où quelqu'un remet le nom civil dans la réponse,
  // c'est cet écran qu'il faut voir tomber.
  first_name: 'Lea',
  last_name: 'Moreau',
  city: 'Miami',
  bio: 'Nails and skin, Wynwood.',
  // Servi par `CreateurVuRead` comme une liste, jamais absent. Le décor le
  // porte donc aussi : un montage sans lui éprouverait une forme que le
  // serveur n'envoie pas, et laisserait passer une fiche qui tombe sur la
  // vraie réponse. C'est exactement ce qui est arrivé ici, et seule la suite
  // complète l'a dit — la fiche lit ce champ depuis qu'elle le montre.
  interets: ['ongles', 'soin_du_visage'],
  comptes: [
    {
      platform: 'instagram',
      handle: 'lea.mrl',
      followers: 24_000,
      avatar_key: 'photos/creatrices/lea.jpg',
      profil_url: 'https://instagram.com/lea.mrl',
    },
  ],
  paliers_ouverts: ['story', 'post'],
  // Les trois champs de la v3 : ce qu'elle ouvre **ici**, et à quelle distance.
  peut_reserver_ici: true,
  palier_accessible: { tier_id: 't1', platform: 'instagram', content_format: 'story' },
  distance_metres: 320,
  audience_totale: 24_000,
};

/**
 * L'annuaire tel que la route le rend : une **enveloppe**, jamais une liste.
 *
 * La portée par défaut est plausible et non ronde — 41 sur 128 — pour qu'un
 * test qui lit un chiffre lise celui qu'il attend et non un zéro qui passerait
 * pour n'importe quoi. Le gain est vide par défaut : la phrase du
 * contre-factuel ne se rend que là où un test l'installe.
 */
function annuaireDe(
  createurs: unknown[],
  portee: Partial<{
    createurs: number;
    peuvent_reserver: number;
    rayon_metres: number;
    gains_par_palier: unknown[];
  }> = {},
) {
  return {
    total: createurs.length,
    portee: {
      createurs: 128,
      peuvent_reserver: 41,
      rayon_metres: 15_000,
      gains_par_palier: [],
      ...portee,
    },
    createurs,
  };
}

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
    // La liste des salons du support. Elle vit dans le registre commerce avec
    // les autres écrans d'administration — arbitrage, plans, terrain.
    nom: 'createurs',
    noeud: <CreateursAdminScreen />,
    role: 'admin' as Role,
    plein: {
      '/admin/creators': {
        items: [
          {
            creator_id: 'c1',
            city: 'Miami',
            reseaux: [
              {
                platform: 'instagram',
                handle: 'lea.miami',
                followers: 12400,
                avatar_key: 'avatars/lea.jpg',
                profil_url: 'https://instagram.com/lea.miami',
              },
            ],
            audience_totale: 12400,
            reliability_score: '86.00',
            tier: { tier_id: 'p1', platform: 'instagram', content_format: 'post' },
          },
        ],
        total: 1,
        arrivees_cette_semaine: 1,
        fiabilite_mediane: '86.00',
        createurs_avec_score: 1,
        peut_reserver: 1,
      },
    },
    vide: {
      '/admin/creators': {
        items: [],
        total: 0,
        arrivees_cette_semaine: 0,
        fiabilite_mediane: null,
        createurs_avec_score: 0,
        peut_reserver: 0,
      },
    },
  },
  {
    nom: 'commerces',
    noeud: <CommercesScreen />,
    role: 'admin' as Role,
    plein: {
      // **Une enveloppe, plus une liste nue** : la route porte le total de la
      // recherche, sans lequel « 4 sur 742 » ne s'écrit pas.
      '/admin/businesses': {
        items: [
          {
            business_id: 'b1',
            name: 'Vela Nail Studio',
            category: 'beauty',
            neighborhood: 'wynwood',
            status: 'active',
            reprise_en_cours: false,
            created_at: '2026-03-14T15:00:00Z',
          },
        ],
        total: 1,
      },
    },
    vide: { '/admin/businesses': { items: [], total: 0 } },
  },
  {
    nom: 'terrain',
    noeud: <TerrainScreen />,
    role: 'merchant' as Role,
    plein: { '/admin/prospects': [FICHE_PREPAREE] },
    vide: { '/admin/prospects': [] },
  },
  {
    nom: 'abonnement',
    noeud: <AbonnementScreen businessId="b1" />,
    role: 'merchant' as Role,
    plein: {
      '/subscription': { id: 'a1', plan_id: 'p1', status: 'active', current_period_end: null, checkout_url: null },
      '/plans': [
        { id: 'p1', name: 'Studio', price_cents: 9_900, currency: 'EUR', billing_interval: 'monthly', features: {} },
      ],
    },
    // **Jamais vide.** Un commerce sans abonnement est le cas que cet écran
    // existe pour traiter, pas une absence de contenu.
    vide: null,
  },
  {
    nom: 'annuaire',
    noeud: <AnnuaireScreen businessId="b1" />,
    role: 'merchant' as Role,
    plein: { '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE]) },
    // Aucune créatrice autour : la carte de portée se tait, l'état vide parle.
    vide: { '/creators': annuaireDe([], { createurs: 0, peuvent_reserver: 0 }) },
  },
  {
    nom: 'creatrice',
    noeud: <CreatriceScreen businessId="b1" creatorId="c1" onRetour={() => {}} />,
    role: 'merchant' as Role,
    plein: { '/creators/c1': CREATEUR_DE_L_ANNUAIRE },
    // **Jamais vide.** Une fiche existe ou n'existe pas : le serveur répond 404
    // et c'est l'état d'erreur qui le dit. Un état vide laisserait croire à une
    // fiche sans contenu, ce qui n'arrive pas.
    vide: null,
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
    // Le lieu : galerie, carte et horaires, en une requête. Jamais vide — un
    // lieu sans photo est un lieu à composer, et chaque bloc dit lui-même ce
    // qui lui manque ; un vide global effacerait les trois endroits où agir.
    nom: 'lieu',
    noeud: <LieuScreen businessId="b1" />,
    role: 'merchant' as Role,
    // **L'ordre compte** : le double prend la première entrée qui correspond,
    // et `/business/b1` mord sur toutes les routes du commerce. Le préfixe va
    // donc en dernier, après ce qu'il contient.
    plein: {
      '/photos': [],
      '/menu': [],
      '/catalog-items': [],
      '/capacity-rules': [REGLE],
      '/capacity-exceptions': [],
      '/business/b1': { cover_photo_key: null, menu_url: null },
    },
    vide: null,
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

  it('le lieu porte les trois blocs, dont les horaires', async () => {
    /**
     * **La conséquence la moins évidente de la découpe.** Des heures
     * d'ouverture décrivent un endroit, pas une prestation : « Your week »
     * quitte la page de l'offre. Sans cette garde, les retirer du lieu ne
     * casse rien — c'est ce qu'une mutation a montré, et c'est le trou qu'elle
     * a nommé.
     *
     * **Les trois sont repliées à l'ouverture**, depuis que la campagne a dit
     * « trop de choses d'un coup » : on les ouvre une par une, et c'est aussi
     * ce que ce test éprouve maintenant — trois en-têtes, trois contenus.
     */
    await monter(
      <LieuScreen businessId="b1" />,
      clientDe({
        '/photos': [],
        '/menu': [],
        // **Une prestation qui laisse un choix, et c'est elle qui ouvre la
        // section de la carte.** Sans elle, la carte ne se compose plus du
        // tout : le décor d'avant — catalogue vide, aucune page, aucun lien —
        // décrivait un commerce qui n'a rien à faire choisir, donc rien à
        // faire lire. Il rendait ce test vert sur une section qui n'a plus
        // lieu d'être.
        '/catalog-items': [{ ...ITEM, leaves_choice: true }],
        '/capacity-rules': [REGLE],
        '/capacity-exceptions': [],
        '/business/b1': { cover_photo_key: null, menu_url: null },
      }),
      'merchant',
    );

    // Les trois en-têtes sont là d'emblée, et rien d'autre.
    await waitFor(() => expect(screen.getByTestId('section-photos-entete')).toBeTruthy());
    expect(screen.queryByTestId('galerie-du-commerce')).toBeNull();

    await fireEvent.press(screen.getByTestId('section-photos-entete'));
    expect(screen.getByTestId('galerie-du-commerce')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('section-carte-entete'));
    expect(screen.getByTestId('carte-du-commerce')).toBeTruthy();
    // **Une seule ouverte à la fois** : c'est ce qui borne la hauteur, et sans
    // cette ligne trois sections dépliables rendraient le même écran qu'avant.
    expect(screen.queryByTestId('galerie-du-commerce')).toBeNull();

    await fireEvent.press(screen.getByTestId('section-horaires-entete'));
    // Les sept jours, qui sont ce que les horaires rendent.
    expect(screen.getByTestId('semaine')).toBeTruthy();
  });

  it('la carte ne se demande qu’à qui a quelque chose à faire choisir', async () => {
    /**
     * **Le critère est le drapeau de la prestation, jamais la catégorie du
     * commerce.** Un spa à formules a besoin d'une carte ; un salon dont
     * chaque prestation est nommée et fixe n'en a aucun usage, et lui en
     * réclamer une crée une tâche qui ne se termine jamais.
     *
     * **Les deux sens, sur le même décor à un champ près.** C'est la seule
     * façon de le prouver : un test qui ne montrerait que le cas vide passerait
     * aussi bien sur une section retirée pour de bon.
     */
    await monter(
      <LieuScreen businessId="b1" />,
      clientDe({
        '/photos': [],
        '/menu': [],
        '/catalog-items': [{ ...ITEM, leaves_choice: false }],
        '/capacity-rules': [REGLE],
        '/capacity-exceptions': [],
        '/business/b1': { cover_photo_key: null, menu_url: null },
      }),
      'merchant',
    );

    await waitFor(() => expect(screen.getByTestId('section-photos-entete')).toBeTruthy());
    expect(screen.queryByTestId('section-carte-entete')).toBeNull();
    // Les deux autres restent : ce n'est pas l'écran qui a disparu.
    expect(screen.getByTestId('section-horaires-entete')).toBeTruthy();
  });

  it('n’a plus la galerie : elle décrit le lieu', async () => {
    // **La découpe par objet.** La galerie, la carte et les horaires décrivent
    // l'endroit ; ce qui reste ici décrit ce qu'on y fait. Les deux tests qui
    // vivaient ici sont partis avec elle, sur `LieuScreen`.
    await monter(<CatalogueScreen businessId="b1" />, clientDe(CATALOGUE), 'merchant');
    await waitFor(() => expect(screen.getByTestId('ecran-catalogue')).toBeTruthy());

    expect(screen.queryByTestId('galerie-du-commerce')).toBeNull();
    expect(screen.queryByTestId('carte-du-commerce')).toBeNull();
  });

  it('et son état vide dit « aucune prestation », plus « rien du tout »', async () => {
    // Tant que la galerie vivait ici, un commerce qui avait déposé ses photos
    // n'était pas devant un écran vide et la condition portait les trois.
    // Maintenant que l'écran ne parle que de prestations, le vide redevient ce
    // qu'il dit.
    await monter(
      <CatalogueScreen businessId="b1" />,
      clientDe({ ...CATALOGUE, '/catalog-items': [] }),
      'merchant',
    );

    await waitFor(() => expect(screen.getByTestId('etat-vide')).toBeTruthy());
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
    // **La capacité a quitté la ligne avec la v13.** L'exposer sur chaque jour
    // demandait de tenir deux idées par rangée ; elle se règle en ouvrant le
    // jour, où la phrase peut être entière. La colonne part donc avec elle.
    expect(screen.queryByTestId('postes-0')).toBeNull();
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

    /**
     * **La mise en garde a suivi l'action, et c'est ce qu'on éprouve ici.**
     *
     * Elle se tenait sous la table en permanence ; l'ajout d'une date étant
     * devenu la dernière rangée de cette table, elle vit dans le panneau que
     * la rangée ouvre — donc devant celui qui est en train de fermer un jour,
     * plutôt qu'au-dessus de tous ceux qui n'en ferment pas.
     *
     * Le décor l'exige dans les deux sens : absente tant que la rangée n'est
     * pas ouverte, présente une fois qu'elle l'est. Une implémentation qui
     * l'aurait laissée en permanence passerait la seconde moitié seule.
     */
    expect(screen.queryByText(en.composition.fermerNAnnuleRien)).toBeNull();

    await fireEvent.press(screen.getByTestId('ajouter-une-date'));

    expect(screen.getByText(en.composition.fermerNAnnuleRien)).toBeTruthy();
    expect(screen.getByTestId('fermer-cette-date')).toBeTruthy();
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

  it('dit les heures d’une exception qui ouvre, plutôt que « fermé » sur les deux', async () => {
    /**
     * **Le décor porte les deux cas, parce qu'un seul ne prouve rien.**
     *
     * L'écran écrivait « fermé » sur toute exception, sans regarder
     * `is_closed`, `start_time` ni `end_time` — trois champs servis depuis
     * toujours. Une journée qui ouvrait à 14 h se lisait fermée, et le salon
     * refusait des créatrices qu'il avait décidé d'accueillir.
     *
     * Avec une seule exception fermée au décor, l'implémentation fautive rend
     * exactement le même verdict que la bonne. Il en faut donc une de chaque,
     * et c'est celle qui ouvre qui les sépare.
     */
    const fermee = {
      id: 'e1',
      business_id: 'b1',
      date: '2026-08-15',
      is_closed: true,
      start_time: null,
      end_time: null,
      concurrent_slots: null,
    };
    const reduite = {
      id: 'e2',
      business_id: 'b1',
      date: '2026-08-22',
      is_closed: false,
      start_time: '14:00:00',
      end_time: '19:00:00',
      concurrent_slots: 1,
    };
    await monter(
      <HorairesScreen businessId="b1" />,
      clientDe({ '/capacity-rules': [REGLE], '/capacity-exceptions': [fermee, reduite] }),
    );
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());

    expect(screen.getByTestId('exception-e1')).toHaveTextContent(
      new RegExp(en.composition.fermeToutLeJour),
    );
    expect(screen.getByTestId('exception-e2')).toHaveTextContent(/14:00.*19:00/);
    expect(screen.getByTestId('exception-e2')).not.toHaveTextContent(
      new RegExp(en.composition.fermeToutLeJour),
    );
  });

  it('compose les deux tables avec la même rangée', async () => {
    /**
     * **Troisième signalement de divergence, donc on éprouve la cause.**
     *
     * Les deux tables décrivaient chacune leur rangée, avec les mêmes six
     * mesures recopiées de part et d'autre. Chaque planche qui en corrigeait
     * une laissait l'autre derrière, et la divergence revenait par un autre
     * chiffre — hauteur, puis intervalle, puis filet.
     *
     * On ne compare donc pas des valeurs attendues, qu'il faudrait tenir à
     * jour ici aussi : **on compare les deux rangées entre elles.** Ce test
     * reste vrai quand la planche suivante change la hauteur, et rouge le jour
     * où l'une des deux tables change sans l'autre — c'est exactement la faute
     * qu'il doit attraper.
     */
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

    const forme = (testID: string) => {
      const plat = StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<
        string,
        unknown
      >;
      return {
        minHeight: plat.minHeight,
        paddingHorizontal: plat.paddingHorizontal,
        gap: plat.gap,
        borderBottomWidth: plat.borderBottomWidth,
        borderBottomColor: plat.borderBottomColor,
        alignItems: plat.alignItems,
      };
    };

    expect(forme('exception-e1')).toEqual(forme(`modifier-${REGLE.weekday}`));
    // Et la rangée d'ajout est de la même table, pas un bouton posé dessous.
    expect(forme('ajouter-une-date')).toEqual(forme('exception-e1'));
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
      abonnement: 'AbonnementScreen.tsx',
      annuaire: 'AnnuaireScreen.tsx',
      creatrice: 'CreatriceScreen.tsx',
      terrain: 'TerrainScreen.tsx',
      commerces: 'CommercesScreen.tsx',
      createurs: 'CreateursAdminScreen.tsx',
      catalogue: 'CatalogueScreen.tsx',
      horaires: 'HorairesScreen.tsx',
      lieu: 'LieuScreen.tsx',
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

    // **Et l'adresse d'origine avec.** L'aperçu est une archive ; la
    // publication se vérifie chez la plateforme, et sans le lien le commerce
    // approuve sur une image qu'il ne peut pas recouper.
    expect(screen.getByTestId('ouvrir-la-publication')).toBeTruthy();
  });

  it('dit qu’une créatrice est partie, au lieu d’une ligne sans personne', async () => {
    // Les trois champs de nom sont nuls après anonymisation, et la chaîne de
    // `??` finissait sur une chaîne vide : une contrepartie sans créatrice, que
    // le commerce lit comme une panne. La divergence est écrite ici : le même
    // dossier avec `creator_partie: false` et des noms nuls resterait vide, et
    // c'est bien le booléen qu'on éprouve, pas l'absence de nom.
    const partie = {
      ...LIGNE_DE_FILE,
      creator_first_name: null,
      creator_last_name: null,
      creator_handle: null,
      creator_partie: true,
    };

    await monter(<PublicationsScreen businessId="b1" />, clientDe({ '/collaborations': [partie] }));

    await waitFor(() =>
      expect(screen.getByTestId('createur-k1')).toHaveTextContent(en.commerce.creatricePartie),
    );
  });

  it('range les onglets dans l’ordre de l’usage, et ne genre personne', async () => {
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [LIGNE_DE_FILE] }),
    );

    const onglets = await screen.findByTestId('onglets');
    // Ce qui demande un geste, ce qui est réglé, ce qui n'attend personne.
    const libelles = within(onglets)
      .getAllByRole('tab')
      .map((tab) => within(tab).getByText(/./).props.children);
    expect(libelles).toEqual([
      en.commerce.filtreAControler,
      en.commerce.filtreApprouvee,
      en.commerce.filtreAttendue,
    ]);

    // « Awaiting her post » supposait le genre de toute créatrice sur un écran
    // que lisent quatre salons. L'espagnol était déjà neutre.
    expect(en.commerce.filtreAttendue).not.toMatch(/\bher\b|\bhis\b/i);
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

    await fireEvent.press(screen.getByTestId('motif-missing_mention'));

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
    // Même raison qu'à l'envoi : `Photo` expose son image interne sous
    // `<testID>-image`, ce qu'une `Image` posée à la main ne produit pas.
    expect(screen.getByTestId('apercu-de-la-preuve-image')).toBeTruthy();
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

    await fireEvent.press(screen.getByTestId('motif-missing_mention'));
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
    expect(screen.getByText('$99.00')).toBeTruthy();
    // Deux fois depuis la campagne 2 : sur la ligne du plan, et sur la ligne
    // de total — il n'y a qu'un plan dans ce jeu, les deux coïncident.
    expect(screen.getAllByText('$990.00').length).toBeGreaterThan(0);
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

  describe('qui paie ce plan', () => {
    it('écrit la date connue, et « date unknown » pour l’abonnement sans date', async () => {
      /**
       * **La route `GET /admin/plans/{id}/businesses` levait à chaque appel**
       * — `Subscription.created_at` n'existe pas, la vraie colonne est
       * `started_at`. L'écran avalait l'échec (`.catch(() => [])`) et
       * affichait « aucun abonné », ce qui est faux dès qu'un plan en a un.
       *
       * **Deux abonnés qui divergent sur le seul champ éprouvé.** L'un porte
       * une date, l'autre non — le cas réel d'un abonnement antérieur à la
       * colonne. Avec un seul abonné, un écran qui écrirait toujours une date
       * ou toujours « inconnu » rendrait le même verdict.
       */
      await monter(
        <PlansScreen />,
        clientDe({
          '/admin/plans/pl1/businesses': [
            {
              business_id: 'b1',
              name: 'Ocean Beauty Studio',
              neighborhood: null,
              category: 'beauty',
              status: 'active',
              since: '2026-03-01T00:00:00Z',
            },
            {
              business_id: 'b2',
              name: 'Bayside Play Loft',
              neighborhood: null,
              category: 'beauty',
              status: 'active',
              since: null,
            },
          ],
          '/admin/plans': [PLAN],
        }),
        'admin',
      );
      await waitFor(() => expect(screen.getByTestId('plan-pl1')).toBeTruthy());
      await fireEvent.press(screen.getByTestId('plan-pl1'));
      await waitFor(() => expect(screen.getByTestId('abonne-b1')).toBeTruthy());

      expect(screen.getByTestId('abonne-b1')).toHaveTextContent(/2026/);
      expect(screen.getByTestId('abonne-b2')).toHaveTextContent(new RegExp(en.admin.abonneDepuisInconnu));
      expect(screen.getByTestId('abonne-b2')).not.toHaveTextContent(/2026/);
    });

    it('affiche un vrai message d’erreur, pas un panneau vide qui ment', async () => {
      /**
       * **Le décor qui distingue l'ancien comportement du nouveau.** Une
       * panne sur la route des abonnés doit se voir — l'ancien `.catch`
       * rendait exactement le même panneau qu'un plan sans preneur, et c'est
       * précisément la confusion qu'on éprouve ici.
       */
      const client = new ApiClient({
        baseUrl: 'https://api.test',
        coffre,
        fetchImpl: async (url) => {
          const chemin = String(url);
          if (chemin.includes('/admin/plans/pl1/businesses')) {
            return { ok: false, status: 500, json: async () => ({ detail: 'internal_error' }) } as Response;
          }
          if (chemin.includes('/admin/plans')) {
            return { ok: true, status: 200, json: async () => [PLAN] } as Response;
          }
          throw new Error(`route non simulée : ${chemin}`);
        },
      });

      await monter(<PlansScreen />, client, 'admin');
      await waitFor(() => expect(screen.getByTestId('plan-pl1')).toBeTruthy());
      await fireEvent.press(screen.getByTestId('plan-pl1'));

      await waitFor(() => expect(screen.getByTestId('abonnes-echec')).toBeTruthy());
      // Et surtout pas le panneau « aucun abonné », qui dirait le contraire
      // de ce qui s'est produit.
      expect(screen.queryByTestId('abonnes-vide')).toBeNull();
      expect(screen.getByText(en.common.retry)).toBeTruthy();
    });
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

  it('change de nature quand il n’y a rien à rapporter', async () => {
    // **« Rien à régler » était la mauvaise phrase**, et c'est la décision de
    // la v3 : un salon sans histoire n'a pas besoin d'un rapport vide, il a
    // besoin de savoir pourquoi rien ne s'est passé et quoi faire. Il y a donc
    // bien quelque chose à régler, et l'écran le liste.
    await monter(
      <ReportingScreen businessId="b1" />,
      clientDe({
        '/reporting': { ...REPORTING, reservations: 0, par_semaine: [] },
        // **Un décor où chacun des quatre points a une réponse.** Deux
        // prestations ouvertes dont une sans photo, un seul format offert, et
        // cinq jours d'ouverture sur sept : les quatre lignes disent alors
        // quelque chose de différent, ce qu'un décor vide ne prouverait pas.
        '/catalog-items': [
          { ...ITEM, id: 'i1', photo_key: 'a.jpg', is_effectively_available: true },
          { ...ITEM, id: 'i2', photo_key: null, is_effectively_available: true },
        ],
        '/tier-offers': [
          {
            id: 'o1',
            business_id: 'b1',
            tier_id: 't1',
            catalog_item_id: 'i1',
            platform: 'instagram',
            content_format: 'story',
            item_name: 'Gel manicure',
            is_active: true,
            is_effectively_offered: true,
            created_at: '2026-08-01T00:00:00Z',
          },
        ],
        '/capacity-rules': [0, 1, 2, 3, 4].map((weekday) => ({
          id: `r${weekday}`,
          business_id: 'b1',
          weekday,
          start_time: '09:00',
          end_time: '19:00',
          concurrent_slots: 1,
        })),
      }),
    );
    await waitFor(() => expect(screen.getByTestId('premiers-pas')).toBeTruthy());

    expect(screen.getByText(en.reporting.videTitre)).toBeTruthy();
    // Les quatre points sont là, et le sélecteur de période n'y est pas : il
    // n'y a aucune période à comparer.
    for (const cle of ['catalogue', 'photos', 'paliers', 'horaires']) {
      expect(screen.getByTestId(`pas-${cle}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('fenetre')).toBeNull();
  });

});

// --------------------------------------------------------------------------
// la proposition de palier, sur l'écran du catalogue
// --------------------------------------------------------------------------

describe('le conseil de palier', () => {
  /** Trois durées distinctes : le minimum pour qu'une distribution existe. */
  const CATALOGUE = [
    { ...ITEM, id: 'bas', name: 'Pose vernis', duration_minutes: 20 },
    { ...ITEM, id: 'milieu', name: 'Manucure', duration_minutes: 45 },
    { ...ITEM, id: 'haut', name: 'Soin complet', duration_minutes: 120 },
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

  it('montre l’écart en deux badges avant de l’expliquer', async () => {
    // **« Tu refais tout » disait autre chose.** Il ne manquait pas un écran :
    // il manquait la conséquence, chiffrée, à côté du choix. Deux badges reliés
    // par un chevron — d'où la plateforme partait, où le salon est allé — parce
    // qu'une phrase seule oblige à reconstituer la comparaison de tête, à
    // l'endroit précis où le choix se fait.
    await monter(
      <CatalogueScreen businessId="b1" />,
      // La prestation la moins chère, poussée au palier le plus exigeant.
      catalogueDe([
        { ...OFFRE, id: 'o1', tier_id: 't3', catalog_item_id: 'bas', content_format: 'reel' },
      ]),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('ecart-bas')).toBeTruthy());

    const ecart = within(screen.getByTestId('ecart-bas'));
    expect(ecart.getByTestId('badge-propose-bas')).toHaveTextContent(/STORY/);
    expect(ecart.getByTestId('badge-retenu-bas')).toHaveTextContent(/REEL/);
  });

  it('et l’avertissement porte son glyphe, jamais l’ambre de la marque', async () => {
    // Dans ce système l'ambre **est** la marque : un avertissement en ambre se
    // lit comme une mise en avant. Le glyphe est alors son seul marqueur, et
    // c'est la règle du système — pas un choix d'écran.
    await monter(
      <CatalogueScreen businessId="b1" />,
      catalogueDe([
        { ...OFFRE, id: 'o1', tier_id: 't3', catalog_item_id: 'bas', content_format: 'reel' },
      ]),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('avertissement-bas')).toBeTruthy());

    // **Sur l'avertissement seul, et c'est ce qui rend la garde juste.** Ma
    // première version lisait tout le bloc `conseil-`, badges compris : le
    // badge REEL porte l'aplat de marque, l'assertion tombait sur lui et
    // n'aurait jamais rien dit de l'avertissement.
    const rendu = JSON.stringify(screen.getByTestId('avertissement-bas').toJSON());
    expect(rendu).not.toContain('#F39120');
    // Le glyphe est obligatoire : c'est le seul marqueur qui reste à un
    // avertissement sans teinte.
    expect(rendu).toContain('RNSVGPath');
    // Et le chiffre reste : « moins de créatrices » ne se mesure pas.
    expect(screen.getByTestId('avertissement-bas')).toHaveTextContent(/50,?000/);
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
  it('ne montre aucun score, et n’en parle pas non plus', async () => {
    // **Un renversement, et il est délibéré.** L'écran portait une ligne qui
    // expliquait l'absence de note. Écrire « nous ne vous montrons pas la
    // note » apprend qu'une note existe, et installe un salon à la chercher
    // ailleurs — chez la créatrice, ou en la réclamant. Le silence est le seul
    // endroit du produit où l'on préfère taire une absence.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE]) }),
      'merchant',
    );
    // Rendu d'abord : sans cette attente, un écran qui n'affiche rien du tout
    // passerait toutes les assertions d'absence qui suivent.
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    // Ni le nombre, ni le mot. La forme d'un score — « 87 / 100 » — et le
    // vocabulaire qui l'annonce, y compris pour le nier.
    expect(screen.queryByText(/\/\s*100/)).toBeNull();
    expect(screen.queryByText(/rating|score|rank/i)).toBeNull();

    // Et la divergence qui donne sa valeur au test : l'écran **parle** bien, il
    // ne se tait pas partout. La ligne situe la créatrice, ce qu'aucune note ne
    // ferait — c'est la seule chose qu'elle dit d'elle.
    expect(screen.getByTestId('ville-c1')).toBeTruthy();
  });

  it('commence par le compte, avant toute liste', async () => {
    // La décision de la v3 : à deux mille créatrices un salon ne cherche pas,
    // il ne connaît aucun nom. Le chiffre est ce qu'il répétera à son associé.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE]) }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('portee-du-salon')).toBeTruthy());

    expect(screen.getByTestId('peuvent-reserver')).toHaveTextContent(/^41$/);
    // **« 128 » ne se dit jamais seul.** Les créatrices sans position ne sont
    // comptées nulle part : le nombre est celui de celles dont on peut affirmer
    // qu'elles sont dans le rayon. Le rayon est donc dans la phrase, et il vient
    // du serveur — la planche écrit 15 km, la configuration en dit 10.
    expect(screen.getByTestId('portee-du-salon')).toHaveTextContent(/of 128 within 15 km/);
  });

  it('compose le contre-factuel comme un total, jamais comme le gain seul', async () => {
    // **La faute que ce test existe pour attraper.** `createurs_en_plus` est ce
    // que l'ouverture *ajoute* — 62 — et la phrase annonce où l'on arriverait,
    // 41 + 62 = 103. Rendre le gain tel quel afficherait « porterait ce chiffre
    // à 62 », c'est-à-dire moins que ce qu'on a déjà : une phrase qui passe la
    // relecture et se voit en démonstration.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE], {
          gains_par_palier: [
            { tier_id: 't9', platform: 'instagram', content_format: 'post', createurs_en_plus: 62 },
          ],
        }),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('gain-de-palier')).toBeTruthy());

    expect(screen.getByTestId('gain-de-palier')).toHaveTextContent(/\b103\b/);
    expect(screen.getByTestId('gain-de-palier')).not.toHaveTextContent(/\b62\b/);
  });

  it('propose le palier qui rapporte le plus, et un seul', async () => {
    // La planche montre une phrase, pas une liste de paliers à comparer. Deux
    // gains dans la réponse : celui qui se dit est le plus grand.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE], {
          gains_par_palier: [
            { tier_id: 't1', platform: 'instagram', content_format: 'reel', createurs_en_plus: 9 },
            { tier_id: 't2', platform: 'instagram', content_format: 'post', createurs_en_plus: 62 },
          ],
        }),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('gain-de-palier')).toBeTruthy());

    expect(screen.getByTestId('gain-de-palier')).toHaveTextContent(/\b103\b/);
    expect(screen.getByTestId('gain-de-palier')).not.toHaveTextContent(/\b50\b/);
  });

  it('ne propose rien quand aucun palier fermé n’ajouterait personne', async () => {
    // Un gain nul ne se propose pas : « ouvrir le post porterait ce chiffre à
    // 41 » invite à un geste qui ne change rien, et fait douter du reste.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE], {
          gains_par_palier: [
            { tier_id: 't1', platform: 'instagram', content_format: 'reel', createurs_en_plus: 0 },
          ],
        }),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('portee-du-salon')).toBeTruthy());

    expect(screen.queryByTestId('gain-de-palier')).toBeNull();
  });

  it('parle du salon quand rien n’est ouvert, et n’accuse personne', async () => {
    // **Le champ a changé de sens (#213) et la phrase suivait l'ancien.**
    // `paliers_ouverts` répondait « elle se qualifie quelque part » : une liste
    // vide ne pouvait venir que de son audience. Elle répond maintenant « elle
    // peut réserver ce que *vous* avez ouvert », et le vide a deux causes — son
    // audience, ou des paliers que ce salon n'a pas ouverts. « No tier open
    // right now » désignait donc la créatrice là où le salon pouvait être en
    // cause, sur un écran où le produit se donne du mal à ne rien reprocher.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([
          {
            ...CREATEUR_DE_L_ANNUAIRE,
            // Les trois disent la même chose, comme le serveur les rend : un
            // décor qui n'en changerait qu'un éprouverait un état impossible.
            paliers_ouverts: [],
            peut_reserver_ici: false,
            palier_accessible: null,
          },
        ]),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    // **Dit dans le libellé de la ligne depuis la v13.** La grille est passée
    // en lignes de 76 : une phrase par rangée y ferait trois lignes de texte
    // pour six créatrices. Elle reste dite, et se place du côté du salon.
    expect(screen.getByTestId('createur-c1').props.accessibilityLabel).toContain(
      en.annuaire.aucunPalier,
    );

    // Les deux phrases se placent du côté du salon. C'est l'assertion qui
    // tombe si l'on revient à « No tier open right now » : elle est vraie de la
    // nouvelle formulation et fausse de l'ancienne, là où vérifier la seule
    // présence du nœud aurait passé dans les deux cas.
    expect(en.annuaire.aucunPalier).toMatch(/\byou\b|\byour\b/i);
    expect(en.annuaire.paliersOuverts).toMatch(/\byou\b|\byour\b/i);
  });

  it('titre la fiche du pseudonyme, et jamais du nom civil', async () => {
    // **La divergence est dans la fabrique** : la créatrice a un pseudonyme
    // *et* un nom civil. Un décor qui n'aurait que l'un des deux laisserait
    // passer l'implémentation inverse. Ce que le salon reconnaît est le compte
    // qu'il ira voir ; l'identité d'état civil de cent vingt-huit personnes n'a
    // rien à faire sur un écran d'abonné qui ne les a jamais rencontrées.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE]) }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    expect(screen.getByText('lea.mrl')).toBeTruthy();
    expect(screen.queryByText(/Moreau/)).toBeNull();
    expect(screen.queryByText(/Lea Moreau/)).toBeNull();
  });

  it('mène à la fiche de la créatrice, et non plus hors du produit', async () => {
    // **Le renversement du 2026-09-04.** La rangée était une ancre vers
    // Instagram : le seul geste de l'écran sortait du produit, avant toute
    // décision, et ce que l'abonnement achète restait derrière. Elle ouvre la
    // fiche ; le lien sortant y a déménagé.
    //
    // L'assertion porte sur l'identifiant transmis et pas seulement sur le fait
    // qu'on ait navigué : une rangée qui ouvrirait toujours la même créatrice —
    // le premier de la liste, une constante — passerait un test qui se
    // contenterait de compter les appels.
    const ouvertes: string[] = [];
    await monter(
      <AnnuaireScreen
        businessId="b1"
        onOuvrirLaCreatrice={(creatorId) => ouvertes.push(creatorId)}
      />,
      clientDe({
        '/creators': annuaireDe([
          CREATEUR_DE_L_ANNUAIRE,
          { ...CREATEUR_DE_L_ANNUAIRE, creator_id: 'c2' },
        ]),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c2')).toBeTruthy());

    // **Un bouton et non un lien.** Le rôle de lien promettait ce qu'une ancre
    // offre — clic milieu, nouvel onglet, copier l'adresse — et cette rangée ne
    // mène plus hors du produit.
    expect(screen.getByTestId('createur-c2').props.accessibilityRole).toBe('button');

    await fireEvent.press(screen.getByTestId('createur-c2'));
    expect(ouvertes).toEqual(['c2']);
  });

  it('n’ouvre plus le profil public depuis la rangée', async () => {
    // **L'autre sens, et il ne se déduit pas du précédent.** Une rangée qui
    // ferait les deux — naviguer *et* garder son ancre sortante — passerait le
    // test ci-dessus sans rien avoir déménagé, et le salon continuerait de
    // partir chez Instagram d'un clic milieu.
    await monter(
      <AnnuaireScreen businessId="b1" onOuvrirLaCreatrice={() => {}} />,
      clientDe({ '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE]) }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    const rangee = screen.getByTestId('createur-c1');
    expect(rangee.props.accessibilityRole).not.toBe('link');
    expect(rangee.props.href).toBeUndefined();
  });

  it('montre le portrait, et garde son cadre quand il n’y en a pas', async () => {
    // `avatar_key` était servi et jeté par le type de l'app : l'annuaire rendait
    // des fiches sans visage. Le cadre vide n'est pas un cas limite — la même
    // clé sert l'aperçu flouté au salon sans abonnement, et les photos déposées
    // avant cet aperçu répondront 404 plutôt que de retomber sur l'original.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE]) }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    expect(screen.getByTestId('portrait-c1')).toBeTruthy();
    // **La vignette, et c'est la fin de l'adresse.** « Contient la clé » ne
    // suffit pas — l'original et la vignette contiennent tous deux la clé, et
    // une assertion faible laisserait passer l'un pour l'autre. La terminaison
    // est ce qui les distingue, et elle reste ce que ce test regarde.
    //
    // **Ce qu'elle attend a changé, et pas par confort.** La clé partait nue
    // parce qu'un aperçu flouté ne se resuffixe pas ; c'était vrai de ce
    // cas-là seulement, et l'autre le payait. `Image` décode avant de réduire,
    // donc vingt portraits d'origine tenaient leur pleine taille en mémoire
    // dans des cadres de 132 points.
    expect(String(screen.getByTestId('photo-c1-image').props.source.uri)).toMatch(
      /photos\/creatrices\/lea\.jpg@vignette$/,
    );
  });

  it('sert une clé d’aperçu sans la resuffixer', async () => {
    // Sans abonnement, `avatar_key` porte déjà l'aperçu flouté — suffixe
    // `@apercu`, produit par le serveur. Y ajouter `@vignette` ne rendrait
    // rien, et le cadre vide se serait confondu avec le 404 prévu pour les
    // photos d'avant l'aperçu : le défaut se serait caché derrière un cas
    // limite légitime.
    const floutee = {
      ...CREATEUR_DE_L_ANNUAIRE,
      comptes: [
        { ...CREATEUR_DE_L_ANNUAIRE.comptes[0], avatar_key: 'photos/creatrices/lea.jpg@apercu' },
      ],
    };

    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': annuaireDe([floutee]) }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    expect(String(screen.getByTestId('photo-c1-image').props.source.uri)).toMatch(/@apercu$/);
  });

  it('garde le cadre du portrait quand la photo manque', async () => {
    // La divergence : sans clé, le cadre reste et **aucune** image n'est
    // montée. Une balise pointant sur une adresse vide rendrait un carré cassé
    // plutôt qu'un aplat, et c'est ce qu'un 404 produirait à grande échelle.
    const sansPhoto = {
      ...CREATEUR_DE_L_ANNUAIRE,
      comptes: [{ ...CREATEUR_DE_L_ANNUAIRE.comptes[0], avatar_key: null }],
    };

    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': annuaireDe([sansPhoto]) }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    expect(screen.getByTestId('portrait-c1')).toBeTruthy();
    // L'image manque, **la zone reste** : c'est exactement ce que ce test
    // veut dire par « garde le cadre », et c'est maintenant vrai à deux
    // niveaux — le cadre du portrait, et l'aplat qui tient sa hauteur.
    expect(screen.queryByTestId('photo-c1-image')).toBeNull();
    expect(screen.getByTestId('photo-c1')).toBeTruthy();
  });

  it('dit ce que le salon peut en faire, jamais le palier de la créatrice', async () => {
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': annuaireDe([CREATEUR_DE_L_ANNUAIRE]) }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    // **Le mot du système de paliers ne traverse pas vers le commerce.**
    // La carte portait un badge marqué « STORY » : la valeur désignait le
    // catalogue du salon — le meilleur palier qu'elle ouvre **ici** — mais le
    // mot désignait une personne, et c'est ainsi qu'il a été lu en campagne.
    // La phrase dit maintenant ce que le salon peut en faire, ce qui est aussi
    // le premier critère du tri.
    // **Dit, et non peint.** La v13 passe la grille en lignes : l'anneau
    // d'encre porte le critère à l'œil, et le libellé le dit en toutes lettres
    // — un état qui ne reposerait que sur la couleur ne se lit pas.
    expect(screen.getByTestId('createur-c1').props.accessibilityLabel).toContain(
      en.annuaire.paliersOuverts,
    );

    // **Le décor porte un palier accessible**, sinon ce test passerait sur une
    // fiche qui n'en a jamais eu et n'éprouverait rien : c'est le cas où les
    // deux implémentations divergent.
    expect(CREATEUR_DE_L_ANNUAIRE.palier_accessible).not.toBeNull();
    for (const mot of [/STORY/, /POST/, /REEL/]) {
      expect(screen.getByTestId('createur-c1')).not.toHaveTextContent(mot);
    }
  });

  it('dit qu’aucun palier n’est ouvert sans en faire un reproche', async () => {
    // Une audience qui n'atteint pas le premier seuil n'est pas un manquement,
    // et l'annuaire ne doit pas se lire comme un jugement.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([
          {
            ...CREATEUR_DE_L_ANNUAIRE,
            // Les trois disent la même chose, comme le serveur les rend : un
            // décor qui n'en changerait qu'un éprouverait un état impossible.
            paliers_ouverts: [],
            peut_reserver_ici: false,
            palier_accessible: null,
          },
        ]),
      }),
      'merchant',
    );
    await waitFor(() =>
      expect(screen.getByTestId('createur-c1').props.accessibilityLabel).toContain(
        en.annuaire.aucunPalier,
      ),
    );
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

  it('replie les notes, et les ouvre à la demande', async () => {
    // **Elles existent, et elles sont repliées.** Un arbitre qui les lit toutes
    // avant de regarder la preuve juge une correspondance au lieu d'un fait —
    // il se met à arbitrer la politesse. Ce qui est lisible et décisif est la
    // répétition du motif, pas le ton des explications.
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

    // Repliées : la garde vaut dans les deux sens, sinon un écran qui les
    // afficherait toujours passerait la moitié qui compte.
    expect(screen.queryByTestId('note-tentative-0')).toBeNull();

    await fireEvent.press(screen.getByTestId('lire-les-notes'));

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

    await fireEvent.press(screen.getByTestId('motif-missing_mention'));
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
      "la relecture d'une carte importée transporte le prix lu jusqu'au serveur, " +
      "sans jamais le montrer ni le faire saisir. Il n'y est plus un champ.",
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

    // **Trois gestes, et un seul est interdit.** La règle n'a jamais porté sur
    // le mot « bouton » : elle porte sur le fait d'*agir sur une créatrice*
    // dans BIND — inviter, contacter, écrire. Il faut donc les distinguer :
    //
    //   1. **sortir** — aller voir son travail chez elle, hors du produit ;
    //   2. **ouvrir une fiche** — rester dedans, sur une lecture ;
    //   3. **agir sur elle** — le seul que la règle refuse.
    //
    // La version d'avant n'en connaissait que deux, et exigeait que tout
    // `onPress` soit un `Linking.openURL`. C'était juste tant que sortir était
    // le seul geste ; ça a cessé de l'être le jour où la rangée a mené à une
    // fiche. Une garde qui ne connaît que deux cas force à exempter le
    // troisième — et une garde exemptée ne garde plus rien.
    //
    // Elle avait déjà été élargie une fois, de « pas d'`onPress` » à « pas
    // d'`onPress` qui ne sorte pas » : la même correction, un cran plus tôt.
    // **Deux contrôles nommés, et aucun ne porte sur une créatrice.**
    //
    // Le premier mène aux offres : le mur intercepte le refus d'abonnement,
    // explique qu'il en manque un, et s'arrête là. Ce bouton vit dans la
    // branche du refus, qui rend **zéro créatrice** par construction — il ne
    // peut donc pas agir sur l'une d'elles.
    //
    // Le second charge la page suivante. Il porte un rôle de bouton, et c'est
    // juste : c'est un contrôle. Ce que la règle interdit est d'agir sur une
    // créatrice — inviter, contacter, écrire — et lire la suite n'est aucun des
    // trois. La garde vérifie plus bas qu'il appelle bien une lecture.
    //
    // Les deux sont retirés du texte examiné **par leur nom**, jamais par une
    // dispense sur le fichier : une garde exemptée ne garde plus rien.
    const lisibles = source
      .replace(/<Button[\s\S]*?testID="voir-les-plans"[\s\S]*?\/>/, '')
      .replace(/<Pressable[\s\S]*?testID="voir-plus"[\s\S]*?<\/Pressable>/, '');

    for (const interdit of [/<Button/, /accessibilityRole="button"/, /api\.\w*(?:nvit|ontact|essage)/]) {
      expect({ interdit: String(interdit), present: interdit.test(lisibles) }).toEqual({
        interdit: String(interdit),
        present: false,
      });
    }

    // Le contrôle de pagination existe, et il **lit** : sans cette assertion,
    // le retrait ci-dessus ouvrirait un trou où n'importe quoi passerait sous
    // ce nom.
    expect(source).toMatch(/testID="voir-plus"/);
    expect(source).toMatch(/annuaireDesCreateurs\(/);

    // **Chaque `onPress` restant est l'un des deux gestes permis**, et la garde
    // le vérifie en les comptant. Sans ce compte, tout ce qui précède
    // laisserait passer n'importe quelle action tant qu'elle évite le mot
    // « bouton ».
    const combien = (motif: RegExp) => (lisibles.match(motif) ?? []).length;
    // Sortir du produit : `LienExterne` s'en charge, et il ne prend pas
    // d'`onPress` — il prend une `url`. Ouvrir une fiche : un `onPress` qui
    // appelle la fonction que l'écran reçoit pour ça, et rien d'autre.
    expect({
      onPress: combien(/onPress=/g),
      ouvertures: combien(/onOuvrir\(createur\.creator_id\)/g),
    }).toEqual({ onPress: 1, ouvertures: 1 });

    // **Et ce que cette ouverture reçoit est un identifiant, pas un pouvoir.**
    // La fonction vient de la navigation ; l'écran ne peut rien en faire
    // d'autre que demander une fiche. Un `onPress` qui appellerait `api.`
    // quelque chose serait une action, et c'est ce que la ligne suivante
    // refuse.
    expect(lisibles).not.toMatch(/onPress=\{[^}]*\bapi\./);
  });

  it('la fiche d’une créatrice n’agit pas sur elle non plus', () => {
    // **La règle suit l'écran qu'on vient d'ouvrir.** Déplacer la lecture vers
    // une fiche sans y déplacer la garde reviendrait à la lever : c'est
    // désormais là que le salon regarde une créatrice, donc là qu'un bouton
    // « contacter » aurait le plus de sens à écrire.
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const source = readFileSync(
      join(__dirname, '..', 'src', 'screens', 'CreatriceScreen.tsx'),
      'utf-8',
    );

    for (const interdit of [/<Button/, /accessibilityRole="button"/, /onPress=/, /api\.\w*(?:nvit|ontact|essage)/]) {
      expect({ interdit: String(interdit), present: interdit.test(source) }).toEqual({
        interdit: String(interdit),
        present: false,
      });
    }

    // **Le lien sortant y est, et c'est pour ça que la fiche existe.** Sans
    // cette ligne, une fiche qui ne mènerait plus nulle part passerait les
    // interdits ci-dessus en ayant perdu le geste qu'on lui a confié.
    expect(source).toMatch(/<LienExterne/);
    expect(source).toMatch(/url=\{compte\.profil_url\}/);
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

  it('sépare ce qui attend une décision, ce qui arrive, et ce qui est fini', async () => {
    // **Trois natures, du plus urgent au plus froid.** Un statut ne devient une
    // section que s'il change ce que la vendeuse doit faire.
    //
    // **Servi et clos n'en font plus qu'un depuis la v3.** Ils étaient séparés
    // parce qu'une contrepartie court encore dans un cas et plus dans l'autre :
    // vrai, mais c'est une différence pour la créatrice, pas pour le comptoir —
    // des deux côtés il n'y a plus rien à faire aujourd'hui. La nuance reste
    // écrite sur la ligne, et le test du dessous la vérifie encore.
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

    // **Le clos a quitté l'écran à la cinquième reprise**, et il n'y est plus
    // replié : c'est un compte dans l'en-tête, qui ouvre la liste quand on la
    // cherche. Replier gardait trois natures à lire ; retirer en laisse deux,
    // qui se comparent d'un regard.
    expect(screen.queryByTestId('finies')).toBeNull();
    await fireEvent.press(screen.getByTestId('compte-des-finies'));
    await waitFor(() => expect(screen.getByTestId('finies')).toBeTruthy());
    // Les deux anciennes sections ont disparu, et non pas seulement changé de
    // nom : sans cette moitié, un écran qui rendrait les quatre passerait.
    expect(screen.queryByTestId('servies')).toBeNull();
    expect(screen.queryByTestId('closes')).toBeNull();

    // Et chaque ligne est dans la bonne : c'est le rangement qui est le test,
    // pas la présence des titres.
    expect(screen.getByTestId('planning')).toContainElement(screen.getByTestId('ligne-b-attendue'));
    const finies = screen.getByTestId('finies');
    expect(finies).toContainElement(screen.getByTestId('ligne-b-servie'));
    expect(finies).toContainElement(screen.getByTestId('ligne-b-close'));
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

describe('le score de fiabilité vit sur l’annuaire admin, et nulle part ailleurs', () => {
  const reseau = (handle: string) => [
    {
      platform: 'instagram',
      handle,
      followers: 12_400,
      avatar_key: null,
      profil_url: `https://instagram.com/${handle}`,
    },
  ];

  it('écrit le score de celle qui en a un, et « aucun relevé » pour l’autre', async () => {
    /**
     * **Deux créatrices qui divergent sur le seul champ éprouvé.**
     *
     * Avec une seule, un écran qui écrirait toujours « No record » et un écran
     * qui écrirait toujours un nombre rendraient le même verdict. Le couple est
     * exactement celui que la règle distingue : `null` signifie **neutre**,
     * jamais zéro — la condition de score est ignorée, pas échouée.
     *
     * Écrire « 0 » classerait la créatrice la plus récente au dernier rang
     * d'une colonne de notes, et c'est un arbitre qui la lirait.
     */
    await monter(
      <CreateursAdminScreen />,
      clientDe({
        '/admin/creators': {
          items: [
            { creator_id: 'c1', city: 'Miami', reseaux: reseau('notee'), audience_totale: 12_400, reliability_score: '86.00' },
            { creator_id: 'c2', city: 'Miami', reseaux: reseau('neuve'), audience_totale: 12_400, reliability_score: null },
          ],
          total: 2,
          arrivees_cette_semaine: 1,
          // La médiane porte sur **un** score : l'autre créatrice n'en a pas,
          // et la compter comme zéro l'écraserait — c'est la règle du produit.
          fiabilite_mediane: '86.00',
          createurs_avec_score: 1,
          peut_reserver: 0,
        },
      }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    expect(screen.getByTestId('createur-c1')).toHaveTextContent(/86/);
    expect(screen.getByTestId('createur-c2')).toHaveTextContent(
      new RegExp(en.admin.createursSansScore),
    );
    // Et surtout pas un zéro, qui se lirait comme la pire note de la liste.
    expect(screen.getByTestId('createur-c2')).not.toHaveTextContent(/\b0\b/);
  });

  it('dit pourquoi le chiffre vit ici, parce que c’est une promesse', async () => {
    // Une colonne de notes sur des personnes appelle immédiatement « qui
    // d'autre la voit ». La réponse est personne, et elle se dit à l'écran.
    await monter(
      <CreateursAdminScreen />,
      clientDe({
        '/admin/creators': {
          items: [
            { creator_id: 'c1', city: 'Miami', reseaux: reseau('notee'), audience_totale: 12_400, reliability_score: '86.00' },
          ],
          total: 1,
          arrivees_cette_semaine: 0,
          fiabilite_mediane: '86.00',
          createurs_avec_score: 1,
          peut_reserver: 0,
        },
      }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('fiabilite-vit-ici')).toBeTruthy());
    expect(screen.getByTestId('fiabilite-vit-ici')).toHaveTextContent(/never sees this number/);
  });

  it('rend le palier en badge, et « none yet » pour qui n’en ouvre aucun', async () => {
    /**
     * **Deux créatrices qui divergent sur le seul champ éprouvé, encore.**
     *
     * L'une ouvre un palier — `tier` non nul — l'autre aucun. Une
     * implémentation qui écrirait toujours le badge, ou toujours « none yet »,
     * rendrait le même verdict sur une seule créatrice ; il en faut deux qui
     * divergent pour que l'assertion prouve quelque chose.
     */
    await monter(
      <CreateursAdminScreen />,
      clientDe({
        '/admin/creators': {
          items: [
            {
              creator_id: 'c1',
              city: 'Miami',
              reseaux: reseau('ouvre'),
              audience_totale: 12_400,
              reliability_score: '86.00',
              tier: { tier_id: 't1', platform: 'instagram', content_format: 'reel' },
            },
            {
              creator_id: 'c2',
              city: 'Miami',
              reseaux: reseau('ferme'),
              audience_totale: 100,
              reliability_score: null,
              tier: null,
            },
          ],
          total: 2,
          arrivees_cette_semaine: 0,
          fiabilite_mediane: '86.00',
          createurs_avec_score: 1,
          peut_reserver: 1,
        },
      }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('createur-c1')).toBeTruthy());

    expect(screen.getByTestId('tier-c1')).toHaveTextContent('REEL');
    expect(screen.getByTestId('tier-c2')).toHaveTextContent(en.admin.createursSansPalier);
    expect(screen.getByTestId('tier-c2')).not.toHaveTextContent('REEL');
  });

  it('écrit les cinq nombres de tête sur la population, pas sur la page', async () => {
    /**
     * **Le total dépasse ce que la liste rend, et c'est le décor qui compte.**
     *
     * Avec `total === items.length`, un écran qui lirait `items.length` et un
     * écran qui lit `annuaire.total` rendraient le même chiffre. Il faut que
     * la recherche ait trouvé plus que ce que le plafond laisse passer pour
     * que les deux se séparent — c'est exactement l'arbitrage déjà rendu sur
     * l'annuaire des salons, repris ici.
     */
    await monter(
      <CreateursAdminScreen />,
      clientDe({
        '/admin/creators': {
          items: [
            {
              creator_id: 'c1',
              city: 'Miami',
              reseaux: reseau('une_seule_ligne'),
              audience_totale: 12_400,
              reliability_score: '86.00',
              tier: { tier_id: 't1', platform: 'instagram', content_format: 'post' },
            },
          ],
          total: 128,
          arrivees_cette_semaine: 3,
          fiabilite_mediane: '86.00',
          createurs_avec_score: 90,
          peut_reserver: 41,
        },
      }),
      'admin',
    );
    await waitFor(() => expect(screen.getByTestId('chiffres-createurs')).toBeTruthy());

    expect(screen.getByTestId('chiffre-total')).toHaveTextContent(/128/);
    expect(screen.getByTestId('chiffre-peut-reserver')).toHaveTextContent(/41/);
    expect(screen.getByTestId('chiffre-arrivees')).toHaveTextContent(/3/);
    expect(screen.getByTestId('chiffre-fiabilite-mediane')).toHaveTextContent(/86/);

    // Le plafond a un remède, comme sur Salons : narrow, pas scroll.
    expect(screen.getByTestId('plafond-createurs')).toHaveTextContent(/1/);
  });
});

describe('la tournée se lit en table, et ses gestes vivent dans le panneau', () => {
  /**
   * **Deux fiches qui divergent sur tout ce que la table sert à comparer.**
   *
   * Une seule fiche ne prouverait rien : une implémentation qui écrirait la
   * même voie, le même état et la même attente sur toutes les lignes rendrait
   * exactement le même verdict. Il faut donc une fiche remise en main et
   * activée, et une fiche envoyée par lien et jamais ouverte — c'est le couple
   * dont l'écart est la seule raison d'être de cet écran.
   */
  const ACTIVEE = {
    ...FICHE_PREPAREE,
    business_id: 'p1',
    name: 'Studio Lume',
    status: 'active' as const,
    prepared_at: '2026-08-10T12:00:00Z',
    issued_at: '2026-08-10T12:00:00Z',
    used_at: '2026-08-10T16:00:00Z',
    channel: 'qr' as const,
    etat: 'claimed' as const,
    prepared_by: 'amelie@bind.agency',
    remis_par: 'amelie@bind.agency',
  };
  const JAMAIS_OUVERTE = {
    ...FICHE_PREPAREE,
    business_id: 'p2',
    name: 'Aurora Brow Bar',
    prepared_at: '2026-08-09T12:00:00Z',
    issued_at: '2026-08-09T12:00:00Z',
    used_at: null,
    channel: 'email' as const,
    etat: 'never_opened' as const,
    prepared_by: 'amelie@bind.agency',
    remis_par: 'theo@bind.agency',
  };

  it('donne à chaque fiche sa voie, son état et son attente, et elles diffèrent', async () => {
    await monter(
      <TerrainScreen />,
      clientDe({ '/admin/prospects': [ACTIVEE, JAMAIS_OUVERTE] }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('fiche-p1')).toBeTruthy());

    // La voie de remise sépare les deux, et c'est l'écart que l'écran mesure.
    expect(screen.getByTestId('fiche-p1')).toHaveTextContent(/In person/);
    expect(screen.getByTestId('fiche-p2')).toHaveTextContent(/By email/);

    // **L'état est un cartouche, pas un mot dans une cellule.** Le testID est
    // celui que `TableRow` compose pour une colonne déclarée `etat`.
    expect(screen.getByTestId('fiche-p1-etat')).toHaveTextContent('Taken over');
    expect(screen.getByTestId('fiche-p2-etat')).toHaveTextContent('Link never opened');

    // L'attente d'une fiche activée est une durée close ; celle d'une fiche
    // qui court se dit autrement. Les confondre ferait lire « 4 h » sur une
    // fiche que personne n'a jamais ouverte.
    expect(screen.getByTestId('fiche-p1')).toHaveTextContent(/4 h/);
    expect(screen.getByTestId('fiche-p2')).toHaveTextContent(/so far/);
  });

  it('n’expose aucun geste dans la rangée, et les rend tous en l’ouvrant', async () => {
    await monter(
      <TerrainScreen />,
      clientDe({ '/admin/prospects': [JAMAIS_OUVERTE] }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('fiche-p2')).toBeTruthy());

    // **Fermée, la table ne porte que des faits.** Trois boutons par ligne
    // feraient d'une table de comparaison une table de décision.
    expect(screen.queryByTestId('emettre-p2')).toBeNull();
    expect(screen.queryByTestId('revoquer-p2')).toBeNull();

    await fireEvent.press(screen.getByTestId('fiche-p2'));

    // Ouverte, elle porte les mêmes gestes qu'avant la table — aucun n'a été
    // perdu au passage, ce qui est la seule chose qu'une recomposition doit
    // garantir.
    expect(screen.getByTestId('panneau-p2')).toBeTruthy();
    expect(screen.getByTestId('emettre-p2')).toBeTruthy();
    expect(screen.getByTestId('revoquer-p2')).toBeTruthy();
    // La seconde main paraît, parce que c'en est une autre.
    expect(screen.getByTestId('remise-par-p2')).toBeTruthy();
  });

  it('ne propose aucune reprise de compte : ce n’est pas la place de ce mécanisme', async () => {
    // **Ce test éprouvait l'inverse, et il avait raison à ce moment-là.** La
    // reprise était offerte ici sur les fiches déjà assumées — donc l'accès de
    // support, le même qu'à l'écran des salons. Mais posée au milieu du
    // démarchage, elle se lisait comme une capacité du démarchage : « on prend
    // le contrôle des salons qu'on visite ». Relevé en campagne, et c'est une
    // lecture juste de ce que l'écran montrait.
    //
    // Elle reste sur l'écran des salons ; ici elle n'a plus rien à faire, et
    // une fiche assumée ne propose donc plus aucune action : la remise a eu
    // lieu, le gérant a son compte.
    await monter(
      <TerrainScreen />,
      clientDe({ '/admin/prospects': [ACTIVEE] }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('fiche-p1')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('fiche-p1'));

    expect(screen.queryByTestId('reprendre-p1')).toBeNull();
    // Et on ne lui réémet pas non plus un lien d'accueil : le compte existe.
    expect(screen.queryByTestId('emettre-p1')).toBeNull();
  });

  it('dit pourquoi cet écran existe, même une fois des fiches préparées', async () => {
    // **La phrase n'existait que dans l'état vide.** Dès qu'une fiche était
    // préparée, la seule explication du mécanisme s'en allait pour ne jamais
    // revenir — quelqu'un qui arrive sur un écran déjà rempli n'avait donc
    // aucun moyen de la lire.
    await monter(
      <TerrainScreen />,
      clientDe({ '/admin/prospects': [ACTIVEE] }),
      'merchant',
    );

    await waitFor(() => expect(screen.getByTestId('terrain-contexte')).toBeTruthy());
  });

});

describe('un dossier qu’un arbitre a en main', () => {
  it('ne se décide plus au comptoir, et le dit', async () => {
    // **Deux décisions pouvaient partir sur le même dossier** : celle du salon
    // et celle de l'arbitrage. Le champ était rendu par le serveur et lu nulle
    // part — la troisième fois de la journée dans cette famille.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [{ ...LIGNE_DE_FILE, needs_human_review: true }] }),
    );
    await waitFor(() => expect(screen.getByTestId('en-arbitrage-k1')).toBeTruthy());

    // Aucune des trois issues : ni approuver, ni redemander, ni refuser.
    expect(screen.queryByTestId('motif-obligatoire')).toBeNull();
  });
});

/**
 * Nommer la créatrice, partout de la même façon.
 *
 * Trois replis coexistaient — chaîne vide, tiret, chaîne vide — pour une seule
 * question. La fonction est éprouvée seule : c'est une règle, et une règle ne
 * demande pas qu'on monte trois écrans pour savoir ce qu'elle dit.
 */
describe('le nom d’une créatrice partie', () => {
  const t = ((cle: string) => (cle === 'commerce.creatricePartie' ? 'PARTIE' : cle)) as never;

  it('dit qu’elle est partie plutôt que de laisser un trou', () => {
    expect(
      nomDuCreateur(
        { creator_partie: true, creator_handle: null },
        t,
        '—',
      ),
    ).toBe('PARTIE');
  });

  it('ne confond pas « partie » avec « pas de nom »', () => {
    // La divergence qui fait le test : un compte sans pseudonyme **existe
    // encore**, et le tiret y est juste. Sans ce cas, une implémentation qui
    // rendrait « partie » dès qu'un nom manque passerait le test ci-dessus.
    expect(
      nomDuCreateur(
        { creator_partie: false, creator_handle: null },
        t,
        '—',
      ),
    ).toBe('—');

    // Et un départ l'emporte sur un nom qui traînerait encore : c'est le
    // serveur qui décide qu'elle est partie, pas la présence d'un pseudonyme.
    expect(
      nomDuCreateur(
        { creator_partie: true, creator_handle: 'rebecca.miami' },
        t,
        '—',
      ),
    ).toBe('PARTIE');
  });

  it('rend le pseudonyme quand il y en a un', () => {
    expect(
      nomDuCreateur(
        { creator_partie: false, creator_handle: 'rebecca.miami' },
        t,
        '—',
      ),
    ).toBe('rebecca.miami');
  });
});


/**
 * La composition de la file, sur le système Ambre.
 *
 * La revue reprochait de ne pas comprendre l'écran. Le rendu y était pour
 * beaucoup : une pile plate où le pseudonyme, la preuve, les quatre motifs de
 * refus et les deux boutons se présentaient au même poids, sans surface ni
 * séparation entre deux dossiers.
 */
describe('la file des publications, composée', () => {
  const dossier = (id: string, extra: Record<string, unknown> = {}) => ({
    ...LIGNE_DE_FILE,
    collaboration_id: id,
    ...extra,
  });

  it('n’ouvre qu’une décision à la fois, donc un seul orange', async () => {
    // **Le bloc de marque est un signe de ponctuation.** Trois boutons pleins
    // dans une colonne n'en sont plus un — et trois formulaires ouverts
    // demandent de choisir lequel on remplit avant de choisir quoi répondre.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [dossier('k1'), dossier('k2'), dossier('k3')] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());

    // Les trois dossiers sont là — ce n'est pas une liste tronquée.
    expect(screen.getByTestId('controle-k2')).toBeTruthy();
    expect(screen.getByTestId('controle-k3')).toBeTruthy();

    // Un seul porte la décision. `getAllBy` lèverait s'il y en avait zéro, donc
    // le compte à un est bien une mesure et non une absence.
    expect(screen.getAllByTestId('approuver')).toHaveLength(1);
    expect(screen.getAllByTestId('motif-obligatoire')).toHaveLength(1);
  });

  it('ouvre le premier dossier d’emblée, sans demander un clic', async () => {
    // Le défaut relevé sur l'arbitrage en campagne 2 : un écran qui n'ouvre
    // rien ne sert qu'à ceux qui savent déjà qu'il y a quelque chose à ouvrir.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [dossier('k1'), dossier('k2')] }),
    );
    await waitFor(() => expect(screen.getByTestId('approuver')).toBeTruthy());

    // Et c'est le premier, pas un autre : le second annonce qu'il attend.
    expect(screen.getByTestId('a-trancher-k2')).toBeTruthy();
    expect(screen.queryByTestId('a-trancher-k1')).toBeNull();
  });

  it('déplace la décision sur le dossier qu’on ouvre', async () => {
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [dossier('k1'), dossier('k2')] }),
    );
    await waitFor(() => expect(screen.getByTestId('a-trancher-k2')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('controle-k2'));

    await waitFor(() => expect(screen.getByTestId('a-trancher-k1')).toBeTruthy());
    expect(screen.queryByTestId('a-trancher-k2')).toBeNull();
    // Toujours une seule décision ouverte après le déplacement.
    expect(screen.getAllByTestId('approuver')).toHaveLength(1);
  });

  it('montre la preuve de tous les dossiers, pas seulement de l’ouvert', async () => {
    // **La preuve n'est pas derrière le geste.** C'est ce qu'on vient lire, et
    // la cacher ferait payer un clic pour voir avant de décider. Seule la
    // décision se déplace.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [dossier('k1'), dossier('k2')] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k2')).toBeTruthy());

    expect(screen.getAllByTestId('preuve-soumise')).toHaveLength(2);
  });

  it('ne propose rien à trancher sur un dossier qu’un arbitre a en main', async () => {
    // La divergence qui donne sa valeur au test : le même décor, au même
    // statut, et seul `needs_human_review` change. Un écran qui n'ouvrirait
    // jamais rien passerait sans cette paire.
    await monter(
      <PublicationsScreen businessId="b1" />,
      clientDe({ '/collaborations': [dossier('k1', { needs_human_review: true })] }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-k1')).toBeTruthy());

    expect(screen.queryByTestId('approuver')).toBeNull();
    expect(screen.queryByTestId('a-trancher-k1')).toBeNull();
    expect(screen.getByTestId('en-arbitrage-k1')).toBeTruthy();
  });
});

/**
 * La grille v3, et ce qu'elle ne recalcule pas.
 *
 * Trois champs sont arrivés avec le contrat commerce-scopé — `peut_reserver_ici`,
 * `palier_accessible`, `distance_metres` — plus le tri et la pagination. Ce qui
 * s'éprouve ici est surtout ce que l'écran **s'interdit** : rejouer un tri qu'il
 * ne peut pas faire juste, et inventer une distance qu'on ne connaît pas.
 */
/** Les testID cherchés, dans l'ordre où l'arbre les rend. */
function ordreDesTestID(cherches: string[]): string[] {
  const vus: string[] = [];
  const parcourir = (noeud: unknown) => {
    if (Array.isArray(noeud)) return noeud.forEach(parcourir);
    if (!noeud || typeof noeud !== 'object') return;
    const n = noeud as { props?: Record<string, unknown>; children?: unknown };
    const id = n.props?.testID;
    if (typeof id === 'string' && cherches.includes(id) && !vus.includes(id)) vus.push(id);
    parcourir(n.children);
  };
  parcourir(screen.toJSON());
  return vus;
}

describe('la grille de l’annuaire', () => {
  const creatrice = (id: string, extra: Record<string, unknown> = {}) => ({
    ...CREATEUR_DE_L_ANNUAIRE,
    creator_id: id,
    comptes: [{ ...CREATEUR_DE_L_ANNUAIRE.comptes[0], handle: id }],
    ...extra,
  });

  it('garde l’ordre du serveur, sans le rejouer', async () => {
    // **La divergence qui fait le test.** Le serveur rend « accès d'abord,
    // proximité ensuite ». Ce décor viole les deux règles à la fois : la
    // première ne peut pas réserver, et les distances décroissent. Un écran qui
    // retrierait — sur l'accès ou sur la distance — produirait un autre ordre.
    // Une liste paginée triée dans le client se réordonne à chaque page,
    // puisque chaque page n'a que ses propres lignes à comparer.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([
          creatrice('loin', { peut_reserver_ici: false, palier_accessible: null, distance_metres: 9000 }),
          creatrice('proche', { distance_metres: 300 }),
        ]),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-loin')).toBeTruthy());

    expect(ordreDesTestID(['createur-loin', 'createur-proche'])).toEqual([
      'createur-loin',
      'createur-proche',
    ]);
  });

  it('dit la distance, et se tait quand on ne la connaît pas', async () => {
    // **Nulle veut dire « on ne sait pas », jamais « loin ».** Un tiret se
    // lirait comme une absence de proximité — le contraire de ce que le serveur
    // dit en la laissant nulle.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([
          creatrice('situee', { distance_metres: 320 }),
          creatrice('inconnue', { distance_metres: null }),
        ]),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-situee')).toBeTruthy());

    // La distance a rejoint la ville dans une seule situation : « Wynwood,
    // 320 m ». Nulle, elle se tait — un tiret se lirait comme « loin ».
    expect(screen.getByTestId('ville-situee')).toHaveTextContent(/320\s*m/);
    // Et la divergence : sans distance, la ligne ne porte que la ville. Un
    // tiret ou un vide s'y liraient comme « loin », ce qu'on ne sait pas.
    expect(screen.getByTestId('ville-inconnue')).not.toHaveTextContent(/\d/);
  });

  it('situe la créatrice : la ville avec la distance', async () => {
    // **La ville manquait de ma première grille**, et c'est la garde des champs
    // servis qui l'a dit — un champ que le serveur rend et que l'écran cesse de
    // lire est un défaut, pas une simplification. « Wynwood · 320 m » situe ;
    // la distance seule ne dit pas de quel côté.
    //
    // Éprouvé au rendu et non sur la source : la garde des champs servis se
    // contente d'une mention du nom dans le fichier, donc elle reste verte si
    // la ligne est rendue sous une condition toujours fausse.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([
          creatrice('situee', { city: 'Wynwood', distance_metres: 320 }),
          creatrice('apatride', { city: null, distance_metres: null }),
        ]),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-situee')).toBeTruthy());

    expect(screen.getByTestId('ville-situee')).toHaveTextContent(/Wynwood/);
    // La divergence : sans ville, la situation tombe sur la distance seule.
    // Elle ne se tait que si les deux manquent — un vide décalerait la ligne
    // d'à côté, et une ville inconnue n'est pas une distance inconnue.
    // La divergence : sans ville **ni** distance, la ligne se tait. Un vide
    // décalerait la ligne d'à côté, et « on ne sait pas » n'est pas « loin ».
    expect(screen.queryByTestId('ville-apatride')).toBeNull();
  });

  it('marque d’encre celles qui peuvent réserver ici, et elles seules', async () => {
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({
        '/creators': annuaireDe([
          creatrice('ouverte'),
          creatrice('fermee', { peut_reserver_ici: false, palier_accessible: null }),
        ]),
      }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('createur-ouverte')).toBeTruthy());

    const style = (id: string) => {
      const brut = screen.getByTestId(id).props.style;
      return Object.assign({}, ...(Array.isArray(brut) ? brut.flat(Infinity) : [brut]).filter(Boolean));
    };
    // **L'anneau de l'avatar porte l'encre depuis la v13**, la carte ayant
    // laissé la place à une ligne. Ce qu'il marque n'a pas changé : celle qui
    // peut réserver ici, et elle seule.
    expect(style('portrait-ouverte').borderWidth).toBeGreaterThan(0);
    expect(style('portrait-ouverte').borderColor).toBe(couleurs['line.solo']);
    expect(style('portrait-fermee').borderWidth).toBe(0);
  });

  it('dit combien sont affichées sur combien, et propose la suite', async () => {
    // Une page pleine ne dit pas s'il en reste : sans le total, une grille qui
    // s'arrête se lit comme la fin de l'annuaire.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': { ...annuaireDe([creatrice('a'), creatrice('b')]), total: 128 } }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('compte-affiche')).toBeTruthy());

    expect(screen.getByTestId('compte-affiche')).toHaveTextContent('2 of 128');
    expect(screen.getByTestId('voir-plus')).toBeTruthy();
  });

  it('ne propose pas la suite quand tout est là', async () => {
    // La divergence : même écran, même grille, et seul le total change.
    await monter(
      <AnnuaireScreen businessId="b1" />,
      clientDe({ '/creators': { ...annuaireDe([creatrice('a'), creatrice('b')]), total: 2 } }),
      'merchant',
    );
    await waitFor(() => expect(screen.getByTestId('compte-affiche')).toBeTruthy());

    expect(screen.queryByTestId('voir-plus')).toBeNull();
  });
});

describe('le titre de la galerie suit ce qu’elle contient', () => {
  /**
   * **Le titre décrivait la capacité, le lecteur y lit le contenu.**
   * « Photos of the place » au-dessus d'une seule image se lit comme un
   * défaut — et le résumé posé juste en dessous disait déjà « One photo »,
   * si bien que les deux lignes se contredisaient à un mot près.
   */
  function lieuAvec(photos: unknown[]) {
    return clientDe({
      '/photos': photos,
      '/menu': [],
      '/catalog-items': [{ ...ITEM, leaves_choice: false }],
      '/capacity-rules': [REGLE],
      '/capacity-exceptions': [],
      '/business/b1': { cover_photo_key: null, menu_url: null },
    });
  }

  const PHOTO = (id: string) => ({ id, storage_key: `photos/b1/${id}.jpg`, position: 0 });

  it('dit une photo quand il n’y en a qu’une', async () => {
    await monter(<LieuScreen businessId="b1" />, lieuAvec([PHOTO('p1')]), 'merchant');

    await waitFor(() => expect(screen.getByTestId('section-photos-entete')).toBeTruthy());
    // **Un fragment, pas le texte entier.** L'en-tête porte le titre *et* son
    // résumé : `toHaveTextContent` avec une chaîne compare tout, et l'assertion
    // échouerait sur « Photo of the placeOne photo » alors que le mot cherché y
    // est. Le piège se paie deux fois — à l'écrire, puis à croire que l'écran ne
    // rend rien.
    expect(screen.getByTestId('section-photos-entete')).toHaveTextContent(
      /Photo of the place/,
    );
  });

  it('et le pluriel dès la seconde', async () => {
    // **Le cas qui fait diverger les deux implémentations.** Un titre figé au
    // singulier passerait le test du dessus tout aussi bien ; c'est ici qu'il
    // écrirait « Photo of the place » sur une section qui en porte douze.
    await monter(
      <LieuScreen businessId="b1" />,
      lieuAvec([PHOTO('p1'), PHOTO('p2')]),
      'merchant',
    );

    await waitFor(() => expect(screen.getByTestId('section-photos-entete')).toBeTruthy());
    expect(screen.getByTestId('section-photos-entete')).toHaveTextContent(/Photos of the place/);
  });

  it('et le pluriel aussi quand la section est vide', async () => {
    // Zéro n'est pas un : la section vide annonce ce qu'on peut y mettre.
    await monter(<LieuScreen businessId="b1" />, lieuAvec([]), 'merchant');

    await waitFor(() => expect(screen.getByTestId('section-photos-entete')).toBeTruthy());
    expect(screen.getByTestId('section-photos-entete')).toHaveTextContent(/Photos of the place/);
  });
});
