/**
 * Les rapports v3 : à zéro donnée, ce n'est plus un écran de rapports.
 *
 * **C'est la décision de fond de la planche, et elle est structurelle.** Un
 * salon qui vient de s'inscrire n'a pas besoin d'un rapport vide, ni de zéros,
 * ni d'un graphique plat : il a besoin de savoir pourquoi rien ne s'est passé
 * et quoi faire. L'écran change de nature au lieu de changer de contenu.
 *
 * **Ce que ces tests éprouvent d'abord est le calcul des quatre points**, parce
 * que c'est la seule chose ici qui puisse être fausse plutôt que laide. Une
 * liste figée — quatre manques toujours affichés — rendrait exactement le même
 * écran que la planche sur un salon neuf, et un décor recopié de la maquette ne
 * les distinguerait pas. Chaque cas ci-dessous est choisi pour **diverger**.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { ApiClient, ApiProvider, type ContentFormat } from '../src/api';
import { I18nProvider } from '../src/i18n';
import { en } from '../src/i18n/en';
import { premiersPas } from '../src/screens/rapports/pointsDePremierPas';
import { PremiersPas } from '../src/screens/rapports/PremiersPas';
import { ThemeProvider } from '../src/theme';

const ITEM = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  business_id: 'b1',
  parent_item_id: null,
  name: `Prestation ${id}`,
  description: null,
  price_cents: 4000,
  duration_minutes: 45,
  requires_booking: true,
  photo_key: 'photo.jpg',
  leaves_choice: false,
  source: 'manual' as const,
  is_available: true,
  is_effectively_available: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...extra,
});

const OFFRE = (format: ContentFormat, extra: Record<string, unknown> = {}) => ({
  id: `o-${format}`,
  business_id: 'b1',
  tier_id: `t-${format}`,
  catalog_item_id: 'i1',
  platform: 'instagram' as const,
  content_format: format,
  item_name: 'Gel manicure',
  is_active: true,
  is_effectively_offered: true,
  created_at: '2026-08-01T00:00:00Z',
  ...extra,
});

const REGLE = (weekday: number) => ({
  id: `r${weekday}`,
  business_id: 'b1',
  weekday,
  start_time: '09:00',
  end_time: '19:00',
  concurrent_slots: 1,
});

const cle = (points: ReturnType<typeof premiersPas>, nom: string) =>
  points.find((point) => point.cle === nom);

describe('les quatre points se calculent, ils ne se récitent pas', () => {
  it('un salon complet n’a plus rien à faire', () => {
    const points = premiersPas({
      items: [ITEM('i1'), ITEM('i2')],
      offres: [OFFRE('story'), OFFRE('post')],
      regles: [0, 1, 2, 3, 4, 5, 6].map(REGLE),
    });
    expect(points.every((point) => point.fait)).toBe(true);
  });

  it('ne compte que ce qu’une créatrice peut réellement réserver', () => {
    // **Le cas qui diverge de « compte les lignes du catalogue ».**
    // `is_effectively_available` porte la composition : un item dont le parent
    // est fermé existe en base et n'ouvre rien. Le compter dirait « votre
    // catalogue est en ligne » à un salon que personne ne peut réserver.
    const points = premiersPas({
      items: [ITEM('i1', { is_effectively_available: false })],
      offres: [],
      regles: [],
    });
    expect(cle(points, 'catalogue')).toMatchObject({ fait: false, compte: 0 });
  });

  it('et sans prestation ouverte, la photo n’est pas un manque', () => {
    // **Le cas qui diverge de « compte les items sans photo ».** Reprocher zéro
    // photo à un catalogue vide dirait deux fois la même chose, et la seconde
    // fois à tort : ce qui manque est la prestation, pas son image.
    const points = premiersPas({ items: [], offres: [], regles: [] });
    expect(cle(points, 'photos')?.fait).toBe(true);
  });

  it('trois offres sur le même format ne font pas trois paliers', () => {
    // **Le cas qui diverge de « compte les offres ».** Un salon qui offre trois
    // prestations au palier story n'a qu'un palier ouvert, et lui dire le
    // contraire lui ferait croire qu'il touche déjà toutes les créatrices.
    const points = premiersPas({
      items: [ITEM('i1')],
      offres: [OFFRE('story'), OFFRE('story', { id: 'o2' }), OFFRE('story', { id: 'o3' })],
      regles: [],
    });
    expect(cle(points, 'paliers')).toMatchObject({ fait: false, compte: 1 });
  });

  it('une offre inactive n’ouvre pas son palier', () => {
    const points = premiersPas({
      items: [ITEM('i1')],
      offres: [OFFRE('story'), OFFRE('post', { is_effectively_offered: false })],
      regles: [],
    });
    expect(cle(points, 'paliers')).toMatchObject({ fait: false, compte: 1 });
  });

  it('les jours fermés sont ceux qu’aucune règle ne couvre', () => {
    // Deux règles le même jour ne font pas deux jours ouverts : c'est le cas
    // d'un salon qui ferme entre midi et deux, et il est courant.
    const points = premiersPas({
      items: [ITEM('i1')],
      offres: [],
      regles: [REGLE(1), { ...REGLE(1), id: 'r1b', start_time: '14:00' }, REGLE(2)],
    });
    expect(cle(points, 'horaires')).toMatchObject({ fait: false, compte: 5 });
  });

  it('ce qui est fait passe devant ce qui manque', () => {
    // **L'ordre n'est pas cosmétique.** Une liste qui ouvre sur quatre manques
    // se lit comme un reproche adressé à quelqu'un qui vient d'arriver, et
    // c'est le moment du produit où il est le plus facile de partir.
    //
    // **Le décor est choisi pour que l'ordre naturel soit le mauvais.** Un
    // catalogue vide met `catalogue` à faire et `photos` fait — dans l'ordre
    // d'écriture, un manque arrive donc en tête. Mon premier décor avait
    // `catalogue` déjà fait, c'est-à-dire déjà trié : la mutation qui retire le
    // tri y survivait sans rien changer.
    const points = premiersPas({ items: [], offres: [], regles: [] });
    expect(points[0]).toMatchObject({ cle: 'photos', fait: true });

    const faits = points.map((point) => point.fait);
    expect(faits).toEqual([...faits].sort((a, b) => Number(b) - Number(a)));
  });

  it('et le tri est stable : deux manques gardent leur ordre', () => {
    // La liste ne se réorganise pas sous les yeux du gérant quand il vient d'en
    // régler un ; elle remonte seulement celui qu'il vient de faire.
    const points = premiersPas({
      items: [ITEM('i1'), ITEM('i2', { photo_key: null })],
      offres: [OFFRE('story')],
      regles: [0, 1, 2, 3, 4].map(REGLE),
    });
    expect(points.map((point) => point.cle)).toEqual([
      'catalogue',
      'photos',
      'paliers',
      'horaires',
    ]);
  });
});

describe('l’écran, quand il n’y a rien à rapporter', () => {
  async function monter(reponses: Record<string, unknown>, onOuvrir?: () => void) {
    const api = new ApiClient({
      baseUrl: 'https://api.test',
      coffre: { lire: async () => null, ecrire: async () => {} },
      fetchImpl: (async (url: RequestInfo | URL) => {
        const chemin = String(url);
        const trouve = Object.entries(reponses).find(([f]) => chemin.includes(f));
        if (!trouve) throw new Error(`route non simulée : ${chemin}`);
        return { ok: true, status: 200, json: async () => trouve[1] } as Response;
      }) as unknown as typeof fetch,
    });
    return await render(
      <I18nProvider initialLocale="en">
        <ThemeProvider role="merchant">
          <ApiProvider client={api}>
            <PremiersPas businessId="b1" onOuvrir={onOuvrir} />
          </ApiProvider>
        </ThemeProvider>
      </I18nProvider>,
    );
  }

  const COMPOSITION = {
    '/catalog-items': [ITEM('i1'), ITEM('i2', { photo_key: null })],
    '/tier-offers': [OFFRE('story')],
    '/capacity-rules': [0, 1, 2, 3, 4].map(REGLE),
  };

  it('cite le nombre, pas un encouragement', async () => {
    // « 1 service has no photo » se décide ; « améliorez votre visibilité » ne
    // se décide pas.
    await monter(COMPOSITION);
    await waitFor(() => expect(screen.getByTestId('pas-photos')).toBeTruthy());

    expect(screen.getByTestId('pas-photos')).toHaveTextContent(/1/);
    expect(screen.getByTestId('pas-horaires')).toHaveTextContent(/2/);
  });

  it('un seul ambre, sur le premier manque', async () => {
    // Quatre aplats de marque à la suite ne désignent plus rien.
    await monter(COMPOSITION, () => {});
    await waitFor(() => expect(screen.getByTestId('geste-photos')).toBeTruthy());

    const aplati = (style: unknown): Record<string, unknown> =>
      Array.isArray(style)
        ? Object.assign({}, ...style.map(aplati))
        : ((style ?? {}) as Record<string, unknown>);

    const fond = (id: string) => aplati(screen.getByTestId(id).props.style).backgroundColor;
    // Le premier manque de la liste et les suivants ne portent pas le même
    // aplat. Sans cette moitié, un écran qui donnerait l'ambre aux trois
    // passerait.
    expect(fond('geste-photos')).not.toBe(fond('geste-paliers'));
    expect(fond('geste-paliers')).toBe(fond('geste-horaires'));
  });

  it('sans passage vers la composition, aucun bouton', async () => {
    // Un bouton qui ne mène nulle part vaut moins que pas de bouton.
    await monter(COMPOSITION);
    await waitFor(() => expect(screen.getByTestId('pas-photos')).toBeTruthy());

    expect(screen.queryByTestId('geste-photos')).toBeNull();
  });

  it('et une composition illisible se dit, au lieu de laisser une page blanche', async () => {
    // **Une première version rendait `null`.** Le salon voyait alors un écran
    // entièrement vide, sans titre ni explication — pire que l'état vide qu'on
    // vient de remplacer.
    await monter({ '/catalog-items': [ITEM('i1')] });
    await waitFor(() => expect(screen.getByTestId('premiers-pas-indisponible')).toBeTruthy());

    // La phrase d'accueil reste : elle ne dépend d'aucune des trois requêtes.
    expect(screen.getByText(en.reporting.videTitre)).toBeTruthy();
  });
});
