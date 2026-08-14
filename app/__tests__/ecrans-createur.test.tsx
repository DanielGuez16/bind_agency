/**
 * Les écrans créateur, et leurs quatre états.
 *
 * **Le test qui compte est celui des quatre états**, et il est mécanique : il
 * parcourt tous les écrans du registre et, pour chacun, force le nominal, le
 * chargement, le vide et l'erreur. Un écran ajouté sans son état d'erreur ne
 * passe pas — et c'est précisément l'état qu'on oublie, parce qu'en
 * développant, le serveur répond.
 *
 * Le reste vérifie les règles produit que la mise en page ne montre pas :
 * l'écart chiffré seulement à 60 % du seuil, aucune promesse de délai sur la
 * vérification, « pas encore mesuré » qui n'est pas « zéro », les obstacles de
 * la fiche identiques à ceux des paliers.
 */
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { AudienceScreen } from '../src/screens/AudienceScreen';
import { CreneauxScreen } from '../src/screens/CreneauxScreen';
import { FicheScreen } from '../src/screens/FicheScreen';
import { FilScreen } from '../src/screens/FilScreen';
import { HistoriqueScreen } from '../src/screens/HistoriqueScreen';
import { PaliersScreen } from '../src/screens/PaliersScreen';
import { ReglesScreen } from '../src/screens/ReglesScreen';
import { PreuveScreen } from '../src/screens/PreuveScreen';
import { PART_POUR_CHIFFRER, formeDe } from '../src/screens/obstacle';
import { ECRANS_CREATEUR } from '../test-support/registre-ecrans';

// --------------------------------------------------------------------------
// plomberie
// --------------------------------------------------------------------------

const coffre = { lire: async () => null, ecrire: async () => {} };

function clientQui(reponse: (chemin: string) => Promise<unknown> | never): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async (url) => {
      const corps = await reponse(String(url));
      return { ok: true, status: 200, json: async () => corps } as Response;
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
  // Le délai réel est de quinze secondes ; l'attendre laisserait des minuteurs
  // vivants après la fin des tests. Deux secondes suffisent, et **pas
  // cinquante millisecondes** : l'assertion d'état de chargement suit
  // immédiatement le rendu, mais sous charge — une suite d'API tournant en
  // parallèle — cinquante millisecondes s'écoulaient parfois avant elle, et
  // l'écran était déjà passé en erreur. Un échec sur trente exécutions, du
  // genre qu'on met une semaine à relier à sa cause.
  //
  // Rien ne reste vivant après le test : le démontage annule le contrôleur,
  // la requête est rejetée, et le minuteur est libéré dans le `finally`.
  delaiMs: 2_000,
  fetchImpl: (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }),
});

async function monter(noeud: ReactElement, client: ApiClient) {
  function Cadre({ children }: { children: ReactNode }) {
    return (
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
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

const OBSTACLE_LOIN = {
  raison: 'not_enough_followers',
  requis: 10000,
  constate: 1200,
  ecart: 8800,
  depuis: null,
};

const OBSTACLE_PROCHE = {
  raison: 'not_enough_followers',
  requis: 10000,
  constate: 8600,
  ecart: 1400,
  depuis: null,
};

const PALIER = {
  tier_id: 'p1',
  platform: 'instagram',
  content_format: 'story',
  min_followers: 1000,
  min_completed_collabs: 0,
  min_reliability_score: null,
  value_ratio_hint: '1.0',
  display_order: 1,
  accessible: true,
  social_account_id: 'c1',
  obstacles: [],
};

const FIABILITE = { reliability_score: '92.00', completed_collabs_count: 12 };

const VUE = {
  creator_id: 'u1',
  is_new_creator: false,
  fiabilite: FIABILITE,
  paliers: [PALIER],
};

const COMPTE = {
  social_account_id: 'c1',
  platform: 'instagram',
  handle: 'rebecca.miami',
  status: 'active',
  verification_status: 'verified',
  followers_count: 24000,
  following_count: 300,
  media_count: 208,
  avg_views: null,
  engagement_rate: '0.0412',
  captured_at: '2026-08-05T10:00:00Z',
};

const OFFRE = {
  tier_offer_id: 'o1',
  catalog_item_id: 'i1',
  tier_id: 'p1',
  name: 'Gel nails',
  description: null,
  price_cents: 8000,
  currency: 'USD',
  duration_minutes: 45,
  requires_booking: true,
  photo_key: null,
  platform: 'instagram',
  content_format: 'story',
  required_mention: '@salon',
  required_geotag: true,
  value_ratio: '1.0',
  accessible: true,
  social_account_id: 'c1',
  obstacles: [],
  prochains_creneaux: ['2026-08-08T14:00:00Z'],
};

const FICHE = {
  business_id: 'b1',
  name: 'Salón Ocean',
  category: 'beauty',
  address: '1234 Ocean Dr',
  timezone: 'America/New_York',
  phone: null,
  cover_photo_key: null,
  photos: [],
  // Sans carte par défaut : le salon de beauté est le cas ordinaire, et
  // l'accès ne doit alors rien montrer du tout.
  menu_pages: [],
  menu_url: null,
  offres: [OFFRE],
};

const COMMERCE_DU_FIL = {
  business_id: 'b1',
  name: 'Salón Ocean',
  category: 'beauty',
  address: '1234 Ocean Dr',
  cover_photo_key: null,
  distance_metres: 320,
  items: [
    {
      tier_offer_id: 'o1',
      catalog_item_id: 'i1',
      tier_id: 'p1',
      social_account_id: 'c1',
      name: 'Gel nails',
      description: null,
      price_cents: 8000,
      currency: 'USD',
      duration_minutes: 45,
      requires_booking: true,
      photo_key: null,
      platform: 'instagram',
      content_format: 'story',
      value_ratio: '1.0',
    },
  ],
};

const RESERVATION = {
  booking_id: 'r1',
  status: 'confirmed',
  starts_at: '2026-08-08T14:00:00Z',
  ends_at: '2026-08-08T14:45:00Z',
  valid_until: '2026-08-09T14:00:00Z',
  created_at: '2026-08-06T09:00:00Z',
  business_id: 'b1',
  business_name: 'Salón Ocean',
  business_category: 'beauty',
  business_address: null,
  business_timezone: 'America/New_York',
  business_cover_photo_key: null,
  item_name: 'Gel nails',
  item_photo_key: null,
  duration_minutes: 45,
  platform: 'instagram',
  content_format: 'story',
  contrepartie: null,
};

const CONTREPARTIE = {
  id: 'k1',
  booking_id: 'r1',
  tier_id: 'p1',
  required_format: 'story',
  required_mention: '@salon',
  required_geotag: true,
  deadline_at: '2026-08-09T14:00:00Z',
  status: 'pending',
  attempts_count: 0,
  needs_human_review: false,
  approved_at: null,
  proofs: [],
};

const COMPTEURS_VIDES = {
  held: 0,
  confirmed: 0,
  consumed: 0,
  cancelled: 0,
  no_show: 0,
  expired: 0,
};

/**
 * Le registre. Chaque écran donne de quoi produire ses quatre états.
 *
 * Ajouter un écran ici est le seul geste demandé : le test des quatre états
 * s'applique tout seul, et un écran oublié dans le registre se voit au compte.
 */
const ECRANS = [
  {
    nom: 'audience',
    noeud: <AudienceScreen />,
    plein: { '/me/audience': [COMPTE], '/me/verification': [] },
    vide: { '/me/audience': [], '/me/verification': [] },
  },
  {
    nom: 'paliers',
    noeud: <PaliersScreen />,
    plein: { '/me/tiers': VUE },
    vide: { '/me/tiers': { ...VUE, is_new_creator: true, paliers: [] } },
  },
  {
    nom: 'regles',
    noeud: <ReglesScreen />,
    // Les règles n'ont pas d'état vide : elles existent même sans un seul
    // palier configuré, et c'est justement alors qu'on vient les lire.
    plein: { '/me/tiers': VUE },
    vide: null,
  },
  {
    nom: 'fil',
    noeud: (
      <FilScreen
        position={{ longitude: -80.13, latitude: 25.79 }}
        onDemanderLaPosition={jest.fn()}
        onOuvrirLeCommerce={jest.fn()}
      />
    ),
    plein: { '/businesses': { commerces: [COMMERCE_DU_FIL], obstacles: [] } },
    vide: { '/businesses': { commerces: [], obstacles: [] } },
  },
  {
    nom: 'fiche',
    noeud: <FicheScreen businessId="b1" onReserver={jest.fn()} />,
    plein: { '/businesses/b1': FICHE },
    vide: { '/businesses/b1': { ...FICHE, offres: [] } },
  },
  {
    nom: 'creneaux',
    noeud: (
      <CreneauxScreen
        fiche={FICHE as never}
        offre={OFFRE as never}
        onReserve={jest.fn()}
      />
    ),
    plein: {
      '/availability': [
        { starts_at: '2026-08-08T14:00:00Z', ends_at: '2026-08-08T14:45:00Z', places_restantes: 2 },
      ],
    },
    vide: { '/availability': [] },
  },
  {
    nom: 'preuve',
    noeud: <PreuveScreen collaborationId="k1" />,
    plein: { '/collaborations/k1': CONTREPARTIE },
    // Une contrepartie n'est jamais « vide » : elle existe ou elle n'existe
    // pas. Le registre le dit explicitement plutôt que de forcer un cas faux.
    vide: null,
  },
  {
    nom: 'historique',
    noeud: <HistoriqueScreen onOuvrir={jest.fn()} />,
    plein: { '/me/bookings': { items: [RESERVATION], compteurs: { ...COMPTEURS_VIDES, confirmed: 1 } } },
    vide: { '/me/bookings': { items: [], compteurs: COMPTEURS_VIDES } },
  },
] as const;

function clientDe(table: Record<string, unknown>): ApiClient {
  return clientQui(async (url) => {
    const trouve = Object.entries(table).find(([fragment]) => url.includes(fragment));
    if (!trouve) throw new Error(`route non simulée : ${url}`);
    return trouve[1];
  });
}

// --------------------------------------------------------------------------
// les quatre états, sur tous les écrans
// --------------------------------------------------------------------------

describe('quatre états', () => {
  it.each(ECRANS.map((e) => [e.nom, e] as const))('%s · nominal', async (_nom, ecran) => {
    await monter(ecran.noeud, clientDe(ecran.plein));
    await waitFor(() => expect(screen.getByTestId('etat-nominal')).toBeTruthy());
  });

  it.each(ECRANS.map((e) => [e.nom, e] as const))('%s · chargement', async (_nom, ecran) => {
    await monter(ecran.noeud, clientQuiNeRepondJamais);
    expect(screen.getByTestId('etat-chargement')).toBeTruthy();
  });

  it.each(ECRANS.map((e) => [e.nom, e] as const))('%s · erreur', async (_nom, ecran) => {
    // Celui-là est l'important. En développant, le serveur répond : personne ne
    // voit jamais cet écran avant qu'un utilisateur le voie.
    await monter(ecran.noeud, clientQuiEchoue);
    await waitFor(() => expect(screen.getByTestId('etat-erreur')).toBeTruthy());
    // Ce qui s'est passé, puis quoi faire. Jamais un code technique.
    expect(screen.getByText(en.common.retry)).toBeTruthy();
    expect(screen.queryByText('internal_error')).toBeNull();
  });

  it.each(ECRANS.filter((e) => e.vide !== null).map((e) => [e.nom, e] as const))(
    '%s · vide',
    async (_nom, ecran) => {
      await monter(ecran.noeud, clientDe(ecran.vide as Record<string, unknown>));
      await waitFor(() => expect(screen.getByTestId('etat-vide')).toBeTruthy());
    },
  );

  it('couvre exactement les écrans créateur déclarés', () => {
    // Le croisement avec `registre-ecrans.ts` : un écran ajouté au dossier
    // sans entrée ici tombe sur le test de couverture, un écran ajouté ici
    // sans entrée au registre tombe sur celui-ci.
    expect(ECRANS.map((e) => FICHIERS[e.nom]).sort()).toEqual([...ECRANS_CREATEUR].sort());
  });
});

/** Le fichier de chaque entrée du registre. */
const FICHIERS: Record<string, string> = {
  audience: 'AudienceScreen.tsx',
  paliers: 'PaliersScreen.tsx',
  regles: 'ReglesScreen.tsx',
  fil: 'FilScreen.tsx',
  fiche: 'FicheScreen.tsx',
  creneaux: 'CreneauxScreen.tsx',
  preuve: 'PreuveScreen.tsx',
  historique: 'HistoriqueScreen.tsx',
};

// --------------------------------------------------------------------------
// règles produit
// --------------------------------------------------------------------------

describe('obstacles', () => {
  it('chiffre l’écart à partir de 60 % du seuil', () => {
    expect(formeDe(OBSTACLE_PROCHE as never)).toEqual({
      forme: 'ecart',
      manque: 1400,
      requis: 10000,
    });
  });

  it('reste un horizon en dessous', () => {
    // « Il te manque 8 800 abonnés » n'aide pas à agir : cela apprend seulement
    // que ce n'est pas pour soi.
    expect(formeDe(OBSTACLE_LOIN as never)).toEqual({ forme: 'horizon', requis: 10000 });
  });

  it('bascule exactement au seuil', () => {
    const auSeuil = { ...OBSTACLE_LOIN, constate: 10000 * PART_POUR_CHIFFRER };
    expect(formeDe(auSeuil as never).forme).toBe('ecart');
    const justeEnDessous = { ...OBSTACLE_LOIN, constate: 10000 * PART_POUR_CHIFFRER - 1 };
    expect(formeDe(justeEnDessous as never).forme).toBe('horizon');
  });

  it('rend une date plutôt qu’un écart en secondes', () => {
    // « Il vous manque 431 200 secondes » ne veut rien dire.
    const perime = {
      raison: 'metrics_stale',
      requis: 604800,
      constate: 1036000,
      ecart: 431200,
      depuis: '2026-07-28T09:00:00Z',
    };
    expect(formeDe(perime as never)).toEqual({ forme: 'date', depuis: '2026-07-28T09:00:00Z' });
  });

  it('n’invente pas d’écart quand rien n’a été mesuré', () => {
    // Annoncer « il te manque 10 000 » à quelqu'un qu'on n'a pas mesuré serait
    // une invention.
    const sansMesure = { raison: 'no_metrics', requis: 10000, constate: null, ecart: null, depuis: null };
    expect(formeDe(sansMesure as never)).toEqual({ forme: 'horizon', requis: 10000 });
  });

  it('affiche l’obstacle sur l’écran des paliers', async () => {
    await monter(
      <PaliersScreen />,
      clientDe({
        '/me/tiers': {
          creator_id: 'u1',
          is_new_creator: false,
          paliers: [{ ...PALIER, accessible: false, obstacles: [OBSTACLE_PROCHE] }],
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('obstacle-not_enough_followers')).toBeTruthy(),
    );
  });

  it('affiche le même obstacle sur la fiche du commerce', async () => {
    // La condition posée pour garder la divergence avec le fil : une offre
    // fermée est visible, mais elle dit pourquoi, dans les mêmes termes.
    await monter(
      <FicheScreen businessId="b1" onReserver={jest.fn()} />,
      clientDe({
        '/businesses/b1': {
          ...FICHE,
          offres: [
            { ...OFFRE, accessible: false, social_account_id: null, prochains_creneaux: [], obstacles: [OBSTACLE_PROCHE] },
          ],
        },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('offre-fermee')).toBeTruthy());
    expect(screen.getByTestId('obstacle-not_enough_followers')).toBeTruthy();
    // Le bouton est **retiré**, pas grisé.
    expect(screen.queryByText(en.parcours.reserver)).toBeNull();
  });

  it('propose la réservation sur une offre ouverte', async () => {
    // Le pendant : sans lui, une fiche qui ne rendrait jamais de bouton
    // passerait le test précédent.
    await monter(<FicheScreen businessId="b1" onReserver={jest.fn()} />, clientDe({ '/businesses/b1': FICHE }));
    await waitFor(() => expect(screen.getByText(en.parcours.reserver)).toBeTruthy());
  });
});

describe('audience et vérification', () => {
  it('date le chiffre d’abonnés, et le sépare par milliers', async () => {
    await monter(<AudienceScreen />, clientDe({ '/me/audience': [COMPTE], '/me/verification': [] }));
    await waitFor(() => expect(screen.getByTestId('date-du-releve')).toBeTruthy());
    // « 24000 » se compte à la main, chiffre par chiffre, sur le nombre qui
    // est la raison d'être de l'écran.
    expect(screen.getByText('24,000')).toBeTruthy();
    expect(screen.queryByText('24000')).toBeNull();
  });

  it('écrit « pas encore mesuré » plutôt que zéro', async () => {
    // Afficher zéro à quelqu'un qui a douze mille abonnés est un défaut qu'il
    // signalera avant nous.
    await monter(
      <AudienceScreen />,
      clientDe({
        '/me/audience': [{ ...COMPTE, followers_count: null, media_count: null, captured_at: null }],
        '/me/verification': [],
      }),
    );
    await waitFor(() => expect(screen.getAllByText(en.parcours.jamaisMesure).length).toBeGreaterThan(0));
    expect(screen.queryByText('0')).toBeNull();
  });

  it('ne promet aucun délai pendant le contrôle', async () => {
    await monter(
      <AudienceScreen />,
      clientDe({
        '/me/audience': [{ ...COMPTE, verification_status: 'needs_review' }],
        '/me/verification': [
          {
            social_account_id: 'c1',
            platform: 'instagram',
            handle: 'rebecca.miami',
            verification_status: 'needs_review',
            started_at: '2026-08-05T10:00:00Z',
            reviewed_at: null,
            signaux: [{ signal: 'anciennete', verdict: 'tenu', constate: null, requis: null }],
          },
        ],
      }),
    );
    await waitFor(() => expect(screen.getByTestId('controle-en-cours')).toBeTruthy());

    // Aucune durée annoncée nulle part sur cet écran.
    for (const promesse of [/72\s*h/i, /\bdays?\b/i, /within/i, /soon/i]) {
      expect(screen.queryByText(promesse)).toBeNull();
    }
  });
});

describe('historique', () => {
  it('compte les onglets sur tout l’historique, pas sur la page', async () => {
    await monter(
      <HistoriqueScreen onOuvrir={jest.fn()} />,
      clientDe({
        '/me/bookings': {
          items: [RESERVATION],
          compteurs: { ...COMPTEURS_VIDES, confirmed: 1, held: 2, cancelled: 4 },
        },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('onglets')).toBeTruthy());
    // « À venir » couvre held + confirmed : 3, et non 1 comme le dirait la page.
    expect(screen.getByText(`${en.parcours.ongletAVenir} · 3`)).toBeTruthy();
    expect(screen.getByText(`${en.parcours.ongletTerminees} · 4`)).toBeTruthy();
  });

  it('garde les onglets visibles quand un onglet est vide', async () => {
    // Un historique dont seul « à venir » est vide n'est pas un historique
    // vide : masquer les onglets empêcherait d'aller voir les autres.
    await monter(
      <HistoriqueScreen onOuvrir={jest.fn()} />,
      clientDe({ '/me/bookings': { items: [], compteurs: { ...COMPTEURS_VIDES, cancelled: 4 } } }),
    );
    await waitFor(() => expect(screen.getByTestId('onglet-vide')).toBeTruthy());
    expect(screen.getByTestId('onglets')).toBeTruthy();
  });
});
