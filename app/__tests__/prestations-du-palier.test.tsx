/**
 * 11c · Les prestations d'un palier, et la bascule entre le proche et le total.
 *
 * **Le compte était une porte qui ouvrait dans le vide.** « Voir les 34
 * prestations » existait sur l'écran des paliers, `porteOuverte` en dépendait,
 * et la navigation ne le passait pas — délibérément : une porte qui annonce
 * trente-quatre prestations et ouvre sur autre chose ment plus qu'elle ne rend
 * service. Il manquait une lecture des offres d'un palier **non bornée par la
 * distance**, que `/businesses` ne pouvait pas rendre par construction.
 *
 * **Deux nombres dans la même phrase, et ils comptent la même chose.** Douze au
 * total, neuf à moins de quinze kilomètres : ce ne sont pas les mêmes salons
 * mais ce sont bien des prestations des deux côtés. Le champ du proche a failli
 * compter des salons — deux grandeurs plausibles dans une phrase où personne ne
 * l'aurait jamais remarqué.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type PalierAccessible } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { PrestationsDuPalierScreen } from '../src/screens/PrestationsDuPalierScreen';
import { ThemeProvider } from '../src/theme';

function palier(extra: Partial<PalierAccessible> = {}): PalierAccessible {
  return {
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
    ...extra,
  } as unknown as PalierAccessible;
}

/** Trois près, une loin : la distance nulle est « on ne sait pas d'où ». */
const OFFRES = [
  { tier_offer_id: 'o1', nom: 'Gel manicure', nom_du_commerce: 'Vela Nail Studio', neighborhood: 'wynwood', distance_metres: 320 },
  { tier_offer_id: 'o2', nom: 'Balayage', nom_du_commerce: 'Rótulo Hair', neighborhood: 'wynwood', distance_metres: 540 },
  { tier_offer_id: 'o3', nom: 'Signature facial', nom_du_commerce: 'Casa Bruma', neighborhood: 'brickell', distance_metres: 4200 },
  { tier_offer_id: 'o4', nom: 'Massage', nom_du_commerce: 'Sable', neighborhood: null, distance_metres: null },
].map((o) => ({
  catalog_item_id: `i${o.tier_offer_id}`,
  business_id: `b${o.tier_offer_id}`,
  price_cents: 4500,
  currency: 'USD',
  duration_minutes: 45,
  photo_key: null,
  ...o,
}));

async function monter(
  {
    position = { longitude: -80.19, latitude: 25.76 },
    onOuvrir = () => {},
    ...extra
  }: Record<string, unknown> = {},
) {
  const appels: string[] = [];
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async (url: RequestInfo | URL) => {
      appels.push(String(url));
      return { ok: true, status: 200, json: async () => OFFRES } as Response;
    },
  });
  await render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <PrestationsDuPalierScreen
            palier={palier(extra as never)}
            position={position as never}
            rayonKm={15}
            onOuvrir={onOuvrir as (id: string) => void}
            onRetour={() => {}}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { appels };
}

describe('la phrase compte deux fois des prestations', () => {
  it('le total, puis combien sont près et chez combien de salons', async () => {
    // **Neuf prestations chez un seul salon et neuf chez six sont deux offres
    // très différentes**, et le compte de prestations seul ne le dit pas. Les
    // deux grandeurs sont dans la même phrase, chacune nommée : elles ne se
    // comparent pas, elles se complètent.
    await monter();
    await waitFor(() => expect(screen.getByTestId('compte-ouvert')).toBeTruthy());

    expect(screen.getByTestId('compte-ouvert')).toHaveTextContent(/\b12\b/);
    const ou = screen.getByTestId('ou-elles-sont');
    expect(ou).toHaveTextContent(/\b9\b/);
    expect(ou).toHaveTextContent(/\b15\b/);
    expect(ou).toHaveTextContent(/\b4\b/);
  });

  it('sans position, la moitié de la phrase se tait plutôt que d’écrire zéro', async () => {
    // **`null` n'est pas zéro.** « Aucune à moins de quinze kilomètres » serait
    // faux et décourageant à quelqu'un dont on ignore simplement où il est.
    await monter({ position: null, offres_dans_le_rayon: null, commerces_dans_le_rayon: null });
    await waitFor(() => expect(screen.getByTestId('ou-elles-sont')).toBeTruthy());

    expect(screen.getByTestId('ou-elles-sont')).toHaveTextContent(en.tiers.prestationsPartout);
    expect(screen.getByTestId('ou-elles-sont')).not.toHaveTextContent(/\b0\b/);
  });
});

describe('la bascule n’existe que si les deux états diffèrent', () => {
  it('elle bascule du proche au total', async () => {
    await monter();
    await waitFor(() => expect(screen.getByTestId('bascule-proche-tout')).toBeTruthy());

    // Le proche d'abord : c'est ce qu'on réserve. La prestation sans distance
    // n'y est pas — on ne sait pas d'où elle est, pas qu'elle est loin.
    expect(screen.queryByTestId('prestation-o4')).toBeNull();
    expect(screen.getByTestId('prestation-o1')).toBeTruthy();

    // `SegmentedTabs` compose le libellé et son compte : « All · 12 ».
    await fireEvent.press(screen.getByText(new RegExp('^' + en.tiers.prestationsToutes)));
    await waitFor(() => expect(screen.getByTestId('prestation-o4')).toBeTruthy());
  });

  it('sans position, il n’y a rien à basculer', async () => {
    await monter({ position: null, offres_dans_le_rayon: null, commerces_dans_le_rayon: null });
    await waitFor(() => expect(screen.getByTestId('compte-ouvert')).toBeTruthy());

    expect(screen.queryByTestId('bascule-proche-tout')).toBeNull();
    // Et tout est montré : une liste amputée sans moyen de la déplier serait
    // pire que pas de bascule du tout.
    expect(screen.getByTestId('prestation-o4')).toBeTruthy();
  });

  it('et quand tout est dans le rayon non plus', async () => {
    // Les deux états montreraient la même liste : un interrupteur qui ne
    // commande rien, la faute que le produit a déjà retirée deux fois.
    await monter({ offres_dans_le_rayon: 12 });
    await waitFor(() => expect(screen.getByTestId('compte-ouvert')).toBeTruthy());

    expect(screen.queryByTestId('bascule-proche-tout')).toBeNull();
  });
});

describe('ce que l’écran demande au serveur', () => {
  it('les deux coordonnées ensemble, jamais une seule', async () => {
    // Le serveur refuse une moitié en 422, et c'est mieux qu'un silence.
    const { appels } = await monter();
    await waitFor(() => expect(screen.getByTestId('compte-ouvert')).toBeTruthy());

    const url = appels[appels.length - 1];
    expect(url).toContain('longitude=');
    expect(url).toContain('latitude=');
    expect(url).toContain('/me/tiers/p1/offres');
  });

  it('et aucune coordonnée quand il n’y en a pas', async () => {
    const { appels } = await monter({ position: null, offres_dans_le_rayon: null });
    await waitFor(() => expect(screen.getByTestId('compte-ouvert')).toBeTruthy());

    const url = appels[appels.length - 1];
    expect(url).not.toContain('longitude=');
    expect(url).not.toContain('latitude=');
  });

  it('l’ordre du serveur n’est pas rejoué ici', async () => {
    // Par quartier puis par nom : c'est le seul axe qui ne classe personne, et
    // le retrier ici donnerait deux vérités.
    await monter();
    await waitFor(() => expect(screen.getByTestId('prestation-o1')).toBeTruthy());

    const rendus = screen
      .getAllByTestId(/^prestation-/)
      .map((n) => String(n.props.testID));
    expect(rendus).toEqual(['prestation-o1', 'prestation-o2', 'prestation-o3']);
  });
});

/**
 * La liste mène au salon, et elle n'y menait pas.
 *
 * **Un écran qui dit « voici ce qui vous est ouvert » doit ouvrir.** Il nommait
 * des prestations réservables et laissait retenir le nom du salon, revenir au
 * fil, l'y chercher — pour arriver à la fiche qui vit dans la même pile.
 */
it('un appui sur une prestation ouvre la fiche de son salon', async () => {
  const ouverts: string[] = [];
  await monter({ onOuvrir: (id: string) => ouverts.push(id) });
  await waitFor(() => expect(screen.getByTestId('liste-des-prestations')).toBeTruthy());

  await fireEvent.press(screen.getAllByTestId(/^prestation-/)[0]);

  expect(ouverts).toHaveLength(1);
  expect(ouverts[0]).toBe(OFFRES[0].business_id);
});
