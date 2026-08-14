/**
 * L'accès à la carte, sur la fiche publique.
 *
 * **Ce que ça sert.** Un restaurant peut proposer « un menu contre une story ».
 * Le créateur ne sait pas ce qu'il va manger, donc il ne vient pas. La carte est
 * ce qui lui dit quoi — et elle doit avoir son propre accès, pas se perdre dans
 * la galerie : on fait défiler des photos de salle, on *consulte* une carte.
 *
 * **Les trois états, et le troisième est celui qu'on oublie.** Des pages, un
 * lien, ou rien du tout — un salon de beauté n'a pas de carte, et un bouton vide
 * serait un cul-de-sac de plus.
 *
 * **Et l'avertissement de sortie.** Quand le lien est la seule forme, ouvrir la
 * carte sort de l'application. Un lien qui s'ouvre sans prévenir, au milieu d'un
 * parcours de réservation, fait perdre le fil à qui revient.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ApiClient, ApiProvider } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ThemeProvider } from '../src/theme';
import { FicheScreen } from '../src/screens/FicheScreen';

const coffre = { lire: async () => null, ecrire: async () => {} };

/** Une offre, parce que la fiche sans offre rend son état vide et non son corps. */
const OFFRE = {
  tier_offer_id: 'o1',
  catalog_item_id: 'i1',
  tier_id: 'p1',
  name: 'Menu du jour',
  description: null,
  price_cents: 2500,
  currency: 'USD',
  duration_minutes: 45,
  requires_booking: true,
  photo_key: null,
  leaves_choice: true,
  platform: 'instagram',
  content_format: 'story',
  required_mention: '@lecomptoir',
  required_geotag: true,
  value_ratio: '1.0',
  accessible: true,
  social_account_id: 'c1',
  obstacles: [],
  prochains_creneaux: ['2026-08-08T14:00:00Z'],
};

const FICHE = {
  business_id: 'b1',
  name: 'Le Comptoir',
  category: 'restaurant',
  address: '120 Ocean Dr',
  timezone: 'America/New_York',
  phone: null,
  cover_photo_key: null,
  photos: [],
  menu_pages: [] as string[],
  menu_url: null as string | null,
  offres: [OFFRE],
};

function clientDe(fiche: Record<string, unknown>): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.test',
    coffre,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => fiche }) as Response,
  });
}

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

const ecran = <FicheScreen businessId="b1" onReserver={jest.fn()} />;

it('ne montre aucun accès quand il n’y a ni pages ni lien', async () => {
  // Le cas ordinaire du lancement : un salon de beauté n'a pas de carte.
  await monter(ecran, clientDe(FICHE));

  await waitFor(() => expect(screen.getByText('Le Comptoir')).toBeTruthy());
  expect(screen.queryByTestId('acces-a-la-carte')).toBeNull();
});

it('déplie les pages sur place, en pleine résolution', async () => {
  await monter(ecran, clientDe({ ...FICHE, menu_pages: ['photos/cartes/b1/a', 'photos/cartes/b1/b'] }));

  await waitFor(() => expect(screen.getByTestId('voir-la-carte')).toBeTruthy());
  // Repliée d'abord : une carte occupe la hauteur de l'écran, et l'ouvrir
  // d'office repousserait les offres hors de vue.
  expect(screen.queryByTestId('page-de-carte-0')).toBeNull();

  await fireEvent.press(screen.getByTestId('voir-la-carte'));

  expect(screen.getByTestId('page-de-carte-0')).toBeTruthy();
  expect(screen.getByTestId('page-de-carte-1')).toBeTruthy();
  // **L'original, pas la vignette.** Une carte se lit ; une vignette de 480
  // points ne se lit pas, et c'est exactement le genre d'économie qui rend une
  // fonctionnalité inutile en la rendant moins chère.
  expect(screen.getByTestId('page-de-carte-0').props.source.uri).not.toContain('@vignette');
});

it('annonce la sortie de l’application quand le lien est seul', async () => {
  await monter(ecran, clientDe({ ...FICHE, menu_url: 'https://le-comptoir.example/carte' }));

  await waitFor(() => expect(screen.getByTestId('ouvrir-la-carte-en-ligne')).toBeTruthy());
  expect(screen.getByText(en.parcours.ficheCarteHorsApp)).toBeTruthy();
});

it('ne l’annonce pas quand des pages sont déjà là', async () => {
  // Le sens inverse : avec des pages au-dessus, le créateur a déjà lu la carte
  // sans sortir. Avertir à tous les coups ferait du message un décor qu'on
  // cesse de lire — y compris le jour où il compte.
  await monter(
    ecran,
    clientDe({
      ...FICHE,
      menu_pages: ['photos/cartes/b1/a'],
      menu_url: 'https://le-comptoir.example/carte',
    }),
  );

  await waitFor(() => expect(screen.getByTestId('voir-la-carte')).toBeTruthy());
  expect(screen.getByTestId('ouvrir-la-carte-en-ligne')).toBeTruthy();
  expect(screen.queryByTestId('carte-hors-application')).toBeNull();
});
