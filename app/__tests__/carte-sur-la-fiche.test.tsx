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

it('ouvre la carte en plein écran, en pleine résolution', async () => {
  // **Dépliée dans le flux, elle rendait la fiche interminable** et forçait à
  // faire défiler une carte au milieu d'une liste d'offres. Une carte se lit en
  // s'arrêtant : il lui faut l'écran.
  await monter(ecran, clientDe({ ...FICHE, menu_pages: ['photos/cartes/b1/a', 'photos/cartes/b1/b'] }));

  await waitFor(() => expect(screen.getByTestId('acces-carte')).toBeTruthy());
  // Fermée d'abord : on n'ouvre pas une carte à la place de la fiche.
  expect(screen.queryByTestId('visionneuse-de-carte')).toBeNull();

  await fireEvent.press(screen.getByTestId('acces-carte'));

  expect(screen.getByTestId('visionneuse-de-carte')).toBeTruthy();
  expect(screen.getByTestId('page-de-carte-0')).toBeTruthy();
  expect(screen.getByTestId('page-de-carte-1')).toBeTruthy();
  // **L'original, pas la vignette.** Une carte se lit ; une vignette de 480
  // points ne se lit pas, et c'est exactement le genre d'économie qui rend une
  // fonctionnalité inutile en la rendant moins chère.
  expect(screen.getByTestId('page-de-carte-0').props.source.uri).not.toContain('@vignette');
});

it('annonce la sortie de l’application quand le lien est seul', async () => {
  // La feuille dit trois choses dans cet ordre : où l'on va, ce qu'on y
  // trouvera, et ce qui ne se perd pas. La dernière est celle qui décide.
  await monter(ecran, clientDe({ ...FICHE, menu_url: 'https://le-comptoir.example/fr/carte?src=bind' }));

  await waitFor(() => expect(screen.getByTestId('acces-carte')).toBeTruthy());
  expect(screen.queryByTestId('feuille-de-sortie')).toBeNull();

  await fireEvent.press(screen.getByTestId('acces-carte'));

  expect(screen.getByTestId('feuille-de-sortie')).toBeTruthy();
  expect(screen.getByText(en.parcours.sortieRassure)).toBeTruthy();
  // **Le domaine, pas l'adresse entière** : c'est lui qui dit où l'on va.
  expect(screen.getByTestId('domaine-de-sortie')).toHaveTextContent('le-comptoir.example');
});

it('sépare les deux accès, et n’en montre que ceux qui existent', async () => {
  // **Une galerie et une carte ne sont pas la même chose.** Les fondre dans un
  // seul bouton « Photos » est la faute que le lot corrige : on fait défiler
  // des photos de salle, on s'arrête sur une carte. Deux lignes de la même
  // hauteur, et chacune n'existe que si son contenu existe — sinon le créateur
  // appuie sur une porte fermée, ce qui est pire que pas de porte.
  await monter(
    ecran,
    clientDe({
      ...FICHE,
      photos: ['photos/b1/salle'],
      menu_pages: ['photos/cartes/b1/a'],
    }),
  );

  await waitFor(() => expect(screen.getByTestId('acces-a-la-carte')).toBeTruthy());
  expect(screen.getByTestId('acces-galerie')).toBeTruthy();
  expect(screen.getByTestId('acces-carte')).toBeTruthy();

  // Et la galerie ouvre bien la galerie : deux lignes qui ouvriraient la même
  // chose passeraient toute garde qui se contente de les compter.
  await fireEvent.press(screen.getByTestId('acces-galerie'));
  expect(screen.getByTestId('visionneuse-de-galerie')).toBeTruthy();
  expect(screen.queryByTestId('visionneuse-de-carte')).toBeNull();
});

it('ne montre que la galerie quand le commerce n’a pas de carte', async () => {
  // Le sens inverse. Un salon de beauté a des photos et pas de carte ; la ligne
  // de carte doit disparaître, pas se griser.
  await monter(ecran, clientDe({ ...FICHE, photos: ['photos/b1/salle'] }));

  await waitFor(() => expect(screen.getByTestId('acces-galerie')).toBeTruthy());
  expect(screen.queryByTestId('acces-carte')).toBeNull();
});

it('dit sur l’offre qu’elle laisse un choix, et c’est ce qui fait ouvrir la carte', async () => {
  // **La raison d'ouvrir la carte se lit sur l'offre, pas ailleurs.** Sans
  // cette ligne, « Menu du jour » est un nom, et la carte reste un bouton dont
  // on ne voit pas l'intérêt avant d'être assis à table.
  await monter(ecran, clientDe({ ...FICHE, menu_pages: ['photos/cartes/b1/a'] }));

  await waitFor(() => expect(screen.getByTestId('offre-o1')).toBeTruthy());
  expect(screen.getByTestId('laisse-un-choix')).toBeTruthy();
});

it('ne le dit pas quand la prestation est fixe', async () => {
  // Une coupe est une coupe. La ligne apparaîtrait partout et cesserait d'être lue.
  await monter(
    ecran,
    clientDe({ ...FICHE, offres: [{ ...OFFRE, leaves_choice: false }] }),
  );

  await waitFor(() => expect(screen.getByTestId('offre-o1')).toBeTruthy());
  expect(screen.queryByTestId('laisse-un-choix')).toBeNull();
});

it('ouvre la visionneuse et non la feuille dès qu’il y a des pages', async () => {
  // Le sens inverse : avec des pages, la créatrice lit la carte sans sortir, et
  // il n'y a rien à annoncer. Avertir à tous les coups ferait du message un
  // décor qu'on cesse de lire — y compris le jour où il compte.
  await monter(
    ecran,
    clientDe({
      ...FICHE,
      menu_pages: ['photos/cartes/b1/a'],
      menu_url: 'https://le-comptoir.example/carte',
    }),
  );

  await waitFor(() => expect(screen.getByTestId('acces-carte')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('acces-carte'));

  expect(screen.getByTestId('visionneuse-de-carte')).toBeTruthy();
  expect(screen.queryByTestId('feuille-de-sortie')).toBeNull();
});
