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
import { SessionProvider } from '../src/session';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { AudienceScreen } from '../src/screens/AudienceScreen';
import { FavorisScreen } from '../src/screens/FavorisScreen';
import { FiabiliteScreen } from '../src/screens/FiabiliteScreen';
import { CreneauxScreen } from '../src/screens/CreneauxScreen';
import { FicheScreen } from '../src/screens/FicheScreen';
import { FilScreen } from '../src/screens/FilScreen';
import { HistoriqueScreen } from '../src/screens/HistoriqueScreen';
import { MesPublicationsScreen } from '../src/screens/MesPublicationsScreen';
import { ProfilScreen } from '../src/screens/ProfilScreen';
import { PaliersScreen } from '../src/screens/PaliersScreen';
import { PrestationsDuPalierScreen } from '../src/screens/PrestationsDuPalierScreen';
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
          {/* **La session, pour les écrans qui portent un réglage.** La liste
              des favoris porte le seul interrupteur de notification du produit,
              et sa valeur vit sur `/me` — un écran qui la garderait pour lui se
              contredirait avec la coquille au premier rechargement. */}
          <SessionProvider
            baseUrl="https://api.test"
            coffre={{ lire: async () => null, ecrire: async () => {} }}
            fetchImpl={(() =>
              Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({}),
              })) as unknown as typeof fetch}
          >
            <ApiProvider client={client}>{children}</ApiProvider>
          </SessionProvider>
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
  offres_disponibles: 12,
  offres_dans_le_rayon: 9,
  commerces_dans_le_rayon: 4,
};

const OFFRE_DU_PALIER = {
  tier_offer_id: 'o1',
  catalog_item_id: 'i1',
  business_id: 'b1',
  nom: 'Gel manicure',
  nom_du_commerce: 'Vela Nail Studio',
  neighborhood: 'wynwood',
  price_cents: 4500,
  currency: 'USD',
  duration_minutes: 45,
  photo_key: null,
  distance_metres: 320,
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

/**
 * Le jour du montage, **calculé et non figé**.
 *
 * La bande de quatorze jours commence aujourd'hui chez le commerce : une date
 * en dur en sortirait au fil des semaines, et le créneau du montage
 * deviendrait invisible sans que rien ne le dise.
 */
const JOUR_DE_LA_BANDE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  dateStyle: 'short',
}).format(new Date());

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
/** Un favori réservable : l'état qui ne dit rien, parce qu'il n'y a rien à dire. */
const FAVORI = {
  catalog_item_id: 'i1',
  business_id: 'b1',
  business_name: 'Vela Nail Studio',
  name: 'Gel manicure',
  description: null,
  duration_minutes: 45,
  price_cents: 4000,
  currency: 'USD',
  photo_key: 'photos/vela.jpg',
  etat: 'reservable',
};

/** Une réservation dont la contrepartie a été acceptée : une publication. */
const RESERVATION_PUBLIEE = {
  booking_id: 'b-pub',
  status: 'redeemed',
  starts_at: '2026-08-02T14:00:00Z',
  ends_at: null,
  valid_until: '2027-01-01T00:00:00Z',
  approval_expires_at: null,
  annulation_sans_frais_jusqu_a: null,
  created_at: '2026-08-01T00:00:00Z',
  business_id: 'biz-1',
  business_name: 'Vela Nail Studio',
  business_category: 'beauty',
  business_address: null,
  business_timezone: 'America/New_York',
  business_cover_photo_key: null,
  item_name: 'Gel manicure',
  item_photo_key: 'photos/vela.jpg',
  duration_minutes: 45,
  platform: 'instagram',
  content_format: 'post',
  // **`approved`, et c'est tout le décor.** Une preuve soumise et en cours de
  // contrôle n'est pas une publication : la compter ferait dire à quelqu'un
  // qu'il a tenu un engagement que le salon peut encore refuser.
  contrepartie: {
    collaboration_id: 'c1',
    status: 'approved',
    deadline_at: '2026-08-05T00:00:00Z',
    attempts_count: 1,
    max_attempts: 3,
    needs_human_review: false,
  },
};

const ECRANS = [
  {
    // Le profil, racine de l'onglet depuis la fusion. Il lit l'audience pour
    // son visage et son pseudonyme, et rien d'autre : les destinations qu'il
    // offre ne demandent aucun chiffre pour s'afficher.
    nom: 'profil',
    noeud: (
      <ProfilScreen
        onReglages={() => {}}
        onMesPublications={() => {}}
        onFavoris={() => {}}
        onMonAudience={() => {}}
      />
    ),
    plein: { '/me/audience': [COMPTE] },
    // **Pas d'état vide, et c'est une décision.** Une créatrice sans réseau
    // rattaché a quand même un profil : ses favoris et ses réglages vivent ici.
    // Rendre le vide fermerait la porte des réglages à qui n'a pas encore
    // branché de compte.
    vide: null,
  },
  {
    nom: 'mes publications',
    noeud: <MesPublicationsScreen onRetour={() => {}} />,
    plein: { '/me/bookings': { items: [RESERVATION_PUBLIEE], compteurs: {} } },
    vide: { '/me/bookings': { items: [], compteurs: {} } },
  },
  {
    nom: 'audience',
    noeud: <AudienceScreen />,
    // `/me/tiers` accompagne toujours : l'écran y lit les collaborations et le
    // score, qui comptent pour les paliers autant que les abonnés.
    plein: { '/me/audience': [COMPTE], '/me/verification': [], '/me/tiers': VUE },
    vide: { '/me/audience': [], '/me/verification': [], '/me/tiers': VUE },
  },
  {
    // Le score en détail, ouvert depuis l'audience. Il ne lit que
    // `/me/tiers` : sa matière est la fiabilité, et le reste de la vue lui
    // est inutile.
    nom: 'fiabilite',
    noeud: <FiabiliteScreen />,
    plein: { '/me/tiers': VUE },
    // Jamais vide, et le registre le dit plutôt que de forcer un cas faux : un
    // score absent n'est pas un écran vide, c'est un tiret et la phrase qui dit
    // que cela ne coûte rien.
    vide: null,
  },
  {
    // Ce que le cœur ouvre. Une seule route, sans coordonnées : un favori posé
    // à Wynwood doit se relire depuis Kendall.
    nom: 'favoris',
    noeud: <FavorisScreen onRetour={() => {}} onOuvrirLeCommerce={() => {}} onVoirMesPaliers={() => {}} />,
    plein: { '/me/favorites': [FAVORI] },
    vide: { '/me/favorites': [] },
  },
  {
    nom: 'paliers',
    noeud: <PaliersScreen />,
    plein: { '/me/tiers': VUE },
    vide: { '/me/tiers': { ...VUE, is_new_creator: true, paliers: [] } },
  },
  {
    nom: 'prestations du palier',
    noeud: (
      <PrestationsDuPalierScreen
        palier={PALIER as never}
        position={{ longitude: -80.19, latitude: 25.76 }}
        rayonKm={15}
          onOuvrir={() => {}}
        onRetour={() => {}}
      />
    ),
    plein: { '/offres': [OFFRE_DU_PALIER] },
    // Un palier sans une seule prestation : l'état existe, c'est celui d'un
    // palier ouvert dans une ville où personne n'a encore composé.
    vide: { '/offres': [] },
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
        onVoirMesFavoris={() => {}}
        onOuvrirLeCommerce={jest.fn()}
      />
    ),
    // Le fil rend toujours ces quatre listes : les omettre fabriquerait une
    // réponse que le serveur ne produit pas, et rendrait le mur défensif contre
    // un cas qu'aucun appel n'atteint.
    plein: {
      '/businesses': {
        commerces: [COMMERCE_DU_FIL],
        obstacles: [],
        rayons: [],
        quartiers: [],
        categories: [],
        prochain_palier: null,
      },
    },
    vide: {
      '/businesses': {
        commerces: [],
        obstacles: [],
        rayons: [],
        quartiers: [],
        categories: [],
        prochain_palier: null,
      },
    },
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
    // **Les deux routes, distinctes.** Le résumé rend les journées et leur
    // état, la disponibilité rend les heures : répondre la même chose aux deux
    // donnait une bande dont les jours n'avaient pas de date.
    plein: {
      '/availability/summary': [
        { jour: JOUR_DE_LA_BANDE, ouvert: true, revolu: false, creneaux_libres: 1 },
      ],
      '/availability': [
        {
          starts_at: `${JOUR_DE_LA_BANDE}T14:00:00Z`,
          ends_at: `${JOUR_DE_LA_BANDE}T14:45:00Z`,
          places_restantes: 2,
        },
      ],
    },
    // Vide veut dire « l'item ne se propose plus », et c'est la bande qui le
    // dit : une bande peuplée de jours fermés n'est pas un écran vide.
    vide: { '/availability/summary': [], '/availability': [] },
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
  profil: 'ProfilScreen.tsx',
  'mes publications': 'MesPublicationsScreen.tsx',
  audience: 'AudienceScreen.tsx',
  fiabilite: 'FiabiliteScreen.tsx',
  favoris: 'FavorisScreen.tsx',
  paliers: 'PaliersScreen.tsx',
  'prestations du palier': 'PrestationsDuPalierScreen.tsx',
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
    await monter(
      <AudienceScreen />,
      clientDe({ '/me/audience': [COMPTE], '/me/verification': [], '/me/tiers': VUE }),
    );
    // La date ferme désormais la phrase qui dit à quoi servent l'engagement
    // et les vues, au lieu d'avoir une ligne à elle.
    await waitFor(() => expect(screen.getByTestId('ce-que-voit-un-salon')).toBeTruthy());
    // « 24000 » se compte à la main, chiffre par chiffre, sur le nombre qui
    // est la raison d'être de l'écran.
    expect(screen.getByText('24,000')).toBeTruthy();
    expect(screen.queryByText('24000')).toBeNull();
  });

  it('écrit un tiret cadratin plutôt que zéro, et dit ce qu’il veut dire', async () => {
    // **Afficher zéro à quelqu'un qui a douze mille abonnés est la pire chose
    // que cet écran puisse faire.** Le tiret ne se lit pas comme une quantité,
    // ce qui est sa fonction — mais un tiret seul se lit aussi comme une
    // panne, d'où la phrase qui l'accompagne.
    await monter(
      <AudienceScreen />,
      clientDe({
        '/me/audience': [{ ...COMPTE, followers_count: null, media_count: null, captured_at: null }],
        '/me/verification': [],
        '/me/tiers': VUE,
      }),
    );
    await waitFor(() => expect(screen.getByTestId('aucun-releve')).toBeTruthy());

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByTestId('aucun-releve')).toHaveTextContent(en.parcours.audienceAucunReleve);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('ne promet aucun délai pendant le contrôle', async () => {
    await monter(
      <AudienceScreen />,
      clientDe({
        '/me/tiers': VUE,
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

    // **Le jour écoulé s'affiche, l'objectif jamais.** La liste interdisait
    // auparavant le mot « day » tout court, ce qui était un raccourci : ce
    // n'est pas le mot qui promet, c'est la forme. « Jour 3 » dit ce qui s'est
    // passé, « sous 3 jours » dit ce qui va se passer, et seule la seconde se
    // brise le premier jour de charge, auprès de gens qui n'ont rien fait de
    // mal. Bannir le mot aurait interdit le compteur que la planche demande.
    // Le compteur vit dans le bloc du contrôle, où il a un sujet. La
    // pastille d'en haut dit l'état de la lecture, qui est une autre
    // question — un compte peut être lu et en contrôle en même temps.
    expect(screen.getByTestId('jour-du-controle')).toHaveTextContent(/day \d+/i);

    for (const promesse of [/72\s*h/i, /within/i, /soon/i, /in \d+ days?/i, /under \d+/i]) {
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

  it("dit jusqu'à quand le salon peut répondre", async () => {
    /**
     * **« En attente » sans terme se lit comme une file sans fin.** On ne sait
     * pas s'il faut relancer, réserver ailleurs, ou ne rien faire. L'heure est
     * celle que le salon voit de son côté — la même donnée, rendue aux deux —
     * et s'affiche dans le fuseau du salon comme le reste de l'écran.
     */
    await monter(
      <HistoriqueScreen onOuvrir={jest.fn()} />,
      clientDe({
        '/me/bookings': {
          items: [
            {
              ...RESERVATION,
              status: 'awaiting_business',
              approval_expires_at: '2026-08-07T13:00:00Z',
            },
          ],
          compteurs: { ...COMPTEURS_VIDES, awaiting_business: 1 },
        },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('en-attente-r1')).toBeTruthy());

    const message = screen.getByTestId('en-attente-r1');
    // 13 h UTC, soit 9 h à New York : le fuseau du salon, pas celui d'ici.
    // Une chaîne nue serait comparée au texte entier ; l'expression régulière
    // cherche bien l'heure convertie à l'intérieur du message.
    expect(message).toHaveTextContent(/9:00\s*AM/);
    // `toHaveTextContent` compare une **chaîne** au texte entier : passer la
    // phrase telle quelle échouerait alors même qu'elle est bien là, puisque
    // l'échéance s'y ajoute. En expression régulière, c'est une recherche.
    expect(message).toHaveTextContent(
      new RegExp(en.parcours.enAttenteDuSalon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it("n'invente pas d'échéance quand le serveur n'en donne pas", async () => {
    /**
     * **L'autre sens.** Une ligne d'avant la migration n'a pas d'échéance.
     * Afficher « ils ont jusqu'au » suivi d'un vide, ou pire d'une date
     * calculée ici, vaudrait moins que ne rien promettre.
     */
    await monter(
      <HistoriqueScreen onOuvrir={jest.fn()} />,
      clientDe({
        '/me/bookings': {
          items: [{ ...RESERVATION, status: 'awaiting_business', approval_expires_at: null }],
          compteurs: { ...COMPTEURS_VIDES, awaiting_business: 1 },
        },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('en-attente-r1')).toBeTruthy());

    expect(screen.getByTestId('en-attente-r1')).toHaveTextContent(en.parcours.enAttenteDuSalon);
    // La phrase à trous ne part pas telle quelle vers l'écran.
    expect(screen.queryByText(/\{\{quand\}\}/)).toBeNull();
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
