/**
 * Où l'on atterrit après avoir pris une réservation.
 *
 * **Sur la liste, jamais sur le code.** La confirmation ouvrait directement
 * l'écran de code de retrait. Deux raisons de ne pas le faire, et la seconde
 * est une panne :
 *
 * — La prestation est souvent dans plusieurs jours. Un code qui tourne toutes
 *   les trente secondes ne sert à rien avant d'être debout au comptoir, et le
 *   montrer là fait croire qu'il faut en faire quelque chose maintenant.
 *
 * — La validation par le commerce est le comportement par défaut
 *   (`SPEC.md` §4.1) : la réservation qu'on vient de confirmer est en
 *   `awaiting_business`, et **le code naît à l'arrivée dans `confirmed`**. Il
 *   n'existe donc pas. L'écran s'ouvrait sur un refus du serveur, juste après
 *   le geste le plus engageant du parcours.
 *
 * Le parcours est joué en entier, depuis le fil : c'est le câblage de la
 * navigation qui était en cause, et le vérifier sur un écran monté seul ne
 * prouverait rien.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { Navigation } from '../src/shell/Navigation';
import { ThemeProvider } from '../src/theme';

/**
 * La position est fournie : le fil ne s'ouvre pas sans elle, et l'autorisation
 * système n'a rien à voir avec ce qu'on éprouve ici.
 */
jest.mock('../src/shell/usePosition', () => ({
  usePosition: () => ({
    position: { longitude: -80.13, latitude: 25.79 },
    etat: { etat: 'accordee', position: { longitude: -80.13, latitude: 25.79 } },
    demander: () => {},
  }),
}));

const IPHONE = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
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
  menu_pages: [],
  menu_url: null,
  offres: [OFFRE],
};

const COMMERCE_DU_FIL = {
  business_id: 'b1',
  name: 'Salón Ocean',
  category: 'beauty',
  address: '1234 Ocean Dr',
  // **Le quartier n'est plus décoratif depuis la v3 : il range le mur.** Un
  // montage qui l'omet, avec `quartiers: []`, rend un mur vide — et le test
  // n'aurait alors rien à appuyer. C'est le cas de tous les montages de fil
  // écrits avant, qui déclaraient la clé sans jamais la peupler.
  neighborhood: 'south_beach',
  cover_photo_key: null,
  cover_portrait_key: null,
  distance_metres: 320,
  // Servi, et compté par article distinct : un compte posé à `items.length`
  // referait ici la faute que la route a corrigée.
  prestations_ouvertes: 1,
  items: [{ ...OFFRE }],
};

/** La réservation vient d'être confirmée : le commerce doit encore l'accepter. */
const RESERVATION_EN_ATTENTE = {
  booking_id: 'r1',
  status: 'awaiting_business',
  starts_at: '2026-08-08T14:00:00Z',
  ends_at: '2026-08-08T14:45:00Z',
  valid_until: '2026-08-08T18:00:00Z',
  created_at: '2026-08-07T09:00:00Z',
  business_id: 'b1',
  business_name: 'Salón Ocean',
  business_category: 'beauty',
  business_address: '1234 Ocean Dr',
  business_timezone: 'America/New_York',
  business_cover_photo_key: null,
  item_name: 'Gel nails',
  item_photo_key: null,
  duration_minutes: 45,
  platform: 'instagram',
  content_format: 'story',
  contrepartie: null,
};

function serveur() {
  return (async (url: RequestInfo | URL, options?: RequestInit) => {
    const chemin = String(url);
    const rendre = (corps: unknown) =>
      ({ ok: true, status: 200, json: async () => corps }) as Response;

    // L'ordre compte deux fois : « /availability/summary » contient
    // « /availability », qui contient lui-même « /businesses/b1 ».
    if (chemin.includes('/availability/summary')) {
      return rendre([{ jour: JOUR_DE_LA_BANDE, ouvert: true, revolu: false, creneaux_libres: 1 }]);
    }
    if (chemin.includes('/availability')) {
      return rendre([
        {
          starts_at: `${JOUR_DE_LA_BANDE}T14:00:00Z`,
          ends_at: `${JOUR_DE_LA_BANDE}T14:45:00Z`,
          places_restantes: 2,
        },
      ]);
    }
    if (chemin.includes('/businesses/b1')) return rendre(FICHE);
    if (chemin.includes('/businesses')) {
      return rendre({
        commerces: [COMMERCE_DU_FIL],
        obstacles: [],
        rayon_metres: 15_000,
        total_prestations: 1,
        // Toujours rendues par le serveur : les omettre fabriquerait une
        // réponse qui n'existe pas.
        rayons: [],
        quartiers: [
          { quartier: 'south_beach', commerces: 1, prestations: 1, distance_metres: 320 },
        ],
        prochain_palier: null,
        categories: [{ categorie: 'beauty', commerces: 1, prestations: 1 }],
      });
    }
    if (chemin.includes('/me/bookings')) {
      // **Le filtre est honoré, et c'est ce qui donne sa valeur au test.**
      // Rendre la réservation quel que soit l'onglet demandé ferait un décor
      // qu'une implémentation fautive produirait aussi bien : la ligne serait
      // là sur « en cours » comme sur « à venir », et l'assertion passerait
      // sans rien éprouver. Le vrai serveur filtre ; le montage aussi.
      const demandes = new URL(chemin, 'https://api.test').searchParams.getAll('status');
      const porte = demandes.includes(RESERVATION_EN_ATTENTE.status);
      return rendre({
        items: porte ? [RESERVATION_EN_ATTENTE] : [],
        // Les compteurs portent sur tout l'historique, quel que soit l'onglet
        // lu : ils ne suivent pas le filtre.
        compteurs: { awaiting_business: 1 },
      });
    }
    if (chemin.includes('/bookings') && options?.method === 'POST') {
      return rendre({ id: 'r1', status: 'held' });
    }
    // Le code : il ne devrait jamais être demandé sur ce parcours. Un refus,
    // comme le vrai serveur en rend sur une réservation sans code.
    if (chemin.includes('/code')) {
      return { ok: false, status: 409, json: async () => ({ detail: 'booking_not_confirmed' }) } as Response;
    }
    if (chemin.endsWith('/me')) {
      return rendre({ id: 'u1', email: 'r@bind.example', role: 'creator', status: 'active', locale: 'en' });
    }
    return rendre({});
  }) as unknown as typeof fetch;
}

async function monterLeParcours() {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => ({ access_token: 'a', refresh_token: 'r' }), ecrire: async () => {} },
    fetchImpl: serveur(),
  });

  return render(
    <SafeAreaProvider initialMetrics={IPHONE}>
      <ThemeProvider role="creator">
        <I18nProvider initialLocale="en">
          <ApiProvider client={api}>
            <Navigation role="creator" />
          </ApiProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

/** Le parcours, du fil au geste de confirmation. */
async function reserverDepuisLeFil() {
  await waitFor(() => expect(screen.getAllByTestId(/-apercu-/)[0]).toBeTruthy());
  await fireEvent.press(screen.getAllByTestId(/-apercu-/)[0]);

  await waitFor(() => expect(screen.getByTestId('offre-o1')).toBeTruthy());
  await fireEvent.press(screen.getByText(en.parcours.reserver));

  await waitFor(() => expect(screen.getByTestId('ecran-creneaux')).toBeTruthy());
  const groupe = screen.getByTestId('matin');
  await fireEvent.press(within(groupe).getAllByRole('button')[0]);
  await waitFor(() => expect(screen.getByTestId('confirmer')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('confirmer'));
}

/** L'onglet retenu, par son libellé — compteur compris. */
function ongletRetenu(): string {
  const onglets = within(screen.getByTestId('onglets')).getAllByRole('tab');
  const choisis = onglets.filter(
    (onglet) =>
      onglet.props['aria-selected'] === true ||
      onglet.props.accessibilityState?.selected === true,
  );
  expect(choisis).toHaveLength(1);
  return String(choisis[0].props.accessibilityLabel);
}

it('atterrit sur la liste des réservations, pas sur le code', async () => {
  await monterLeParcours();

  // `salon-…` et identifiant du commerce : le fil rend une carte par salon
  // Le testID a changé cinq fois — `commerce-b1`, `salon-b1`, `apercu-o1`,
  // `salon-b1`, et maintenant `apercu-<article>` : le fil v5 rend une carte par
  // prestation, en rangées de catégorie. Le parcours qu'il ouvre, lui, n'a
  // jamais bougé, et c'est bien ce que ce test vérifie.
  await waitFor(() => expect(screen.getAllByTestId(/-apercu-/)[0]).toBeTruthy());
  await fireEvent.press(screen.getAllByTestId(/-apercu-/)[0]);

  await waitFor(() => expect(screen.getByTestId('offre-o1')).toBeTruthy());
  await fireEvent.press(screen.getByText(en.parcours.reserver));

  await waitFor(() => expect(screen.getByTestId('ecran-creneaux')).toBeTruthy());
  // Un créneau d'abord : la barre de confirmation est retirée tant qu'on n'a
  // rien choisi, elle n'est pas grisée.
  const groupe = screen.getByTestId('matin');
  await fireEvent.press(within(groupe).getAllByRole('button')[0]);
  await waitFor(() => expect(screen.getByTestId('confirmer')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('confirmer'));

  // La liste : elle confirme que la place est prise, elle porte la date, et
  // c'est de là qu'on rouvrira le code le jour venu.
  await waitFor(() => expect(screen.getByTestId('ecran-historique')).toBeTruthy());
  expect(screen.queryByTestId('ecran-code')).toBeNull();

  // **Et sur l'onglet qui la contient.** La liste s'ouvre sur « en cours » par
  // défaut, où une réservation neuve n'est jamais : elle est en `held` ou
  // `awaiting_business`. On atterrissait donc sur un onglet vide juste après
  // le geste le plus engageant du parcours.
  await waitFor(() => expect(screen.getByText('Gel nails')).toBeTruthy());
  expect(screen.queryByTestId('onglet-vide')).toBeNull();

  // L'onglet retenu se lit sur son état accessible, les deux formes : `aria-`
  // sur le web, `accessibilityState` en natif. C'est ce que pose
  // `etatAccessible`, et c'est la seule marque de sélection qui traverse.
  // Le libellé porte le compteur — « Upcoming · 1 ».
  expect(ongletRetenu()).toContain(en.parcours.ongletAVenir);
});

it('y atterrit aussi quand la liste a déjà été ouverte', async () => {
  // **Le cas courant, et celui qu'un état initial seul ne couvre pas.** Les
  // onglets du bas gardent leurs écrans montés : qui a consulté ses
  // réservations une fois y revient sur un composant vivant, dont l'état
  // initial a été calculé à la première visite. Une implémentation qui ne
  // ferait que choisir l'onglet au montage passerait le test d'à côté — c'est
  // par ici qu'elle tombe.
  await monterLeParcours();

  // On passe par les réservations d'abord : l'écran se monte, sur « en cours ».
  await fireEvent.press(screen.getByText(en.onglets.reservations));
  await waitFor(() => expect(screen.getByTestId('ecran-historique')).toBeTruthy());
  expect(ongletRetenu()).toContain(en.parcours.ongletEnCours);

  await fireEvent.press(screen.getByText(en.onglets.fil));
  await reserverDepuisLeFil();

  await waitFor(() => expect(screen.getByTestId('ecran-historique')).toBeTruthy());
  await waitFor(() => expect(ongletRetenu()).toContain(en.parcours.ongletAVenir));
  expect(screen.getByText('Gel nails')).toBeTruthy();
});
