/**
 * Les paliers ne sont plus un onglet : ils sont une ligne du fil.
 *
 * **Ce que l'onglet faisait de travers.** Un onglet répond à une question qu'on
 * se pose en ouvrant l'application. « Quel est mon palier » n'en est pas une :
 * ce que la créatrice veut savoir, c'est **ce qu'elle peut réserver**, et c'est
 * le fil qui répond. Les paliers sont la raison, pas la réponse — rangés dans
 * un onglet, ils étaient offerts à qui n'avait pas posé la question.
 *
 * La ligne dit donc le nombre d'abord, et l'explication s'ouvre depuis elle.
 * L'information reste, elle arrive au moment où elle sert.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type Fil } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { FilScreen } from '../src/screens/FilScreen';
import { PaliersScreen } from '../src/screens/PaliersScreen';
import { ThemeProvider } from '../src/theme';

const COMMERCE = {
  business_id: 'b1',
  name: 'Salon Ocean',
  category: 'beauty',
  address: '100 Ocean Dr',
  cover_photo_key: null,
  distance_metres: 420,
  items: [
    {
      tier_offer_id: 'o1',
      catalog_item_id: 'i1',
      tier_id: 't1',
      social_account_id: 's1',
      name: 'Gel manicure',
      description: null,
      price_cents: 4500,
      currency: 'USD',
      duration_minutes: 45,
      requires_booking: true,
      photo_key: null,
      platform: 'instagram',
      content_format: 'story',
      value_ratio: null,
    },
  ],
};

function filAvec(total: number, commerces = 1): Partial<Fil> {
  return {
    commerces: Array.from({ length: commerces }, () => COMMERCE) as Fil['commerces'],
    obstacles: [],
    total_prestations: total,
    // Le type les déclare obligatoires et le serveur les rend toujours : un
    // montage qui les omet fabrique une réponse qui n'existe pas, et rendrait
    // le composant défensif contre un cas qu'aucun appel n'atteint.
    rayons: [],
    quartiers: [],
    categories: [],
  };
}

async function monter(fil: Partial<Fil>, onVoirMesPaliers?: () => void) {
  const api = new ApiClient({
    baseUrl: 'https://api.test',
    coffre: { lire: async () => null, ecrire: async () => {} },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => fil }) as Response,
  });

  return render(
    <I18nProvider initialLocale="en">
      <ThemeProvider role="creator">
        <ApiProvider client={api}>
          <FilScreen
            position={{ longitude: -80.19, latitude: 25.76 }}
            onDemanderLaPosition={() => {}}
            onOuvrirLeCommerce={() => {}}
            onVoirMesPaliers={onVoirMesPaliers}
          />
        </ApiProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('la porte du cadre 11c', () => {
  it('la navigation passe enfin « voir les prestations »', async () => {
    // **Elle ouvrait dans le vide.** `onVoirLesPrestations` existait sur
    // l'écran des paliers et `porteOuverte` en dépendait ; personne ne le
    // passait, délibérément — une porte qui annonce trente-quatre prestations
    // et ouvre sur autre chose ment plus qu'elle ne rend service. Il manquait
    // une lecture non bornée par la distance, qui n'existait pas.
    //
    // Lu sur la source : monter la pile entière pour éprouver un câblage
    // reviendrait à monter six écrans pour vérifier une ligne.
    const source = readFileSync(
      join(__dirname, '..', 'src', 'shell', 'Navigation.tsx'),
      'utf-8',
    );

    expect(source).toMatch(/onVoirLesPrestations=\{/);
    expect(source).toMatch(/navigate\('PrestationsDuPalier'/);
  });
});

/**
 * **La ligne a quitté le fil, et cinq tests sont partis avec elle.**
 *
 * Ils éprouvaient « douze prestations vous sont ouvertes » : le nombre, le
 * singulier du premier jour, l'appui qui ouvre les paliers, la phrase sans
 * issue, et l'effacement devant l'état vide. La revue v3 déplace ce sujet vers
 * Audience, où vivent déjà les abonnés et le score de fiabilité.
 *
 * **Trois d'entre eux n'ont plus d'objet, et un seul a déménagé.** Le compte
 * n'est pas reconduit sur Audience : celui du fil était borné au rayon, et un
 * écran qui ne connaît pas la position en aurait donné un autre pour la même
 * phrase — deux nombres pour une question. Ce qui déménage est le **chemin**,
 * et il est éprouvé dans `paliers-depuis-audience`.
 *
 * Ce qui reste ici concerne le fil vide, qui n'a pas bougé.
 */
describe('les issues du fil vide portent leur nombre', () => {
  it('les élargissements portent leur nombre, et aucun n’en promet zéro', async () => {
    // **Une issue à zéro est un cul-de-sac chiffré**, pire qu'une issue
    // absente : elle promet un geste dont on revient bredouille. Le fil vide
    // est le seul endroit où ces boutons se montrent, donc le seul où
    // l'éprouver.
    await monter({
      ...filAvec(0),
      commerces: [],
      rayons: [
        { rayon_metres: 30000, commerces: 9, prestations: 12 },
        { rayon_metres: 50000, commerces: 0, prestations: 0 },
      ],
    } as never);
    await waitFor(() => expect(screen.getByTestId('fil-vide')).toBeTruthy());

    const elargir = screen.getByTestId('elargir');
    // Celui qui ouvre quelque chose dit combien.
    expect(elargir).toHaveTextContent(/30/);
    expect(elargir).toHaveTextContent(/\b9\b/);
    // Celui qui n'ouvre rien n'est pas là.
    expect(elargir).not.toHaveTextContent(/50/);
  });
});

describe('les comptes de proximité sont réellement demandés', () => {
  it('l’écran des paliers envoie la position et le rayon', async () => {
    // **Ils étaient nuls partout.** Le serveur rend `offres_dans_le_rayon` et
    // `commerces_dans_le_rayon`, l'écran des prestations les lit, et personne
    // n'envoyait de coordonnées : « neuf prestations chez six salons » ne
    // pouvait jamais s'écrire. Le champ existait, il était lu, et rien ne
    // l'alimentait — la garde des champs ne pouvait pas le voir, puisqu'il
    // *était* lu.
    const appels: string[] = [];
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async (url: RequestInfo | URL) => {
        appels.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            creator_id: 'u1',
            is_new_creator: false,
            fiabilite: { reliability_score: '92', completed_collabs_count: 12 },
            paliers: [],
          }),
        } as Response;
      },
    });

    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={api}>
            <PaliersScreen position={{ longitude: -80.19, latitude: 25.76 }} />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(appels.some((u) => u.includes('/me/tiers'))).toBe(true));
    const url = appels.find((u) => u.includes('/me/tiers'))!;
    expect(url).toContain('longitude=');
    expect(url).toContain('latitude=');
    expect(url).toContain('rayon_metres=');
  });

  it('et n’envoie rien du tout sans position', async () => {
    // Le sens inverse : une seule coordonnée est refusée en 422, et un rayon
    // sans point ne veut rien dire.
    const appels: string[] = [];
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: async (url: RequestInfo | URL) => {
        appels.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            creator_id: 'u1',
            is_new_creator: false,
            fiabilite: { reliability_score: null, completed_collabs_count: 0 },
            paliers: [],
          }),
        } as Response;
      },
    });

    await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="creator">
          <ApiProvider client={api}>
            <PaliersScreen position={null} />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(appels.some((u) => u.includes('/me/tiers'))).toBe(true));
    const url = appels.find((u) => u.includes('/me/tiers'))!;
    expect(url).not.toContain('longitude=');
    expect(url).not.toContain('rayon_metres=');
  });
});
